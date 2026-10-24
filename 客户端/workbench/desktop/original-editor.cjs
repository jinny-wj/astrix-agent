'use strict';
const { app, WebContentsView, protocol, session } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const marketplaceNetwork = require('./marketplace-network.cjs');
const {getLayout,getStatePaths}=require('../../../packages/astrix-workbench/layout.cjs');

function registerOriginalEditorSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'kscode-fetch', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    { scheme: 'vscode-remote', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    { scheme: 'vscode-webview', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}
const under = (candidate, base) => candidate === base || candidate.startsWith(base + path.sep);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class OriginalEditorManager {
  constructor({ window, root, baseURL,layout=getLayout(),statePaths }) {
    this.window = window;
    this.root = root;
    this.baseURL = new URL(baseURL);
    const profileKey = createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 8);
    this.statePaths=statePaths||getStatePaths({surface:'desktop',profile:process.env.ASTRIX_PROFILE||process.env.M0_LOCAL_PROFILE||'electron',packaged:app.isPackaged,userData:app.isPackaged?app.getPath('userData'):undefined,layout});
    this.sandbox = path.join(this.statePaths.dataDir, 'native-editor', profileKey);
    // sockaddr_un is byte-limited. Repository and Application Support paths
    // (especially their non-ASCII components) must never prefix IPC sockets.
    const temporary=path.join('/private/tmp',`m0-kscode-${profileKey}-${process.pid}`);
    this.config = {
      sandbox: this.sandbox,
      editor: path.join(layout.recoveryRoot,'extracted/resources/editor'),
      agent: path.join(this.sandbox, 'agent'),
      socket: path.join(temporary, 's.sock'),
      extensionSocket: path.join(temporary, 'e.sock'),
      // macOS sockaddr_un paths are short. Generated VS Code helper sockets
      // must not inherit the longer project directory as their temp prefix.
      temporary,
      marketplace: process.env.M0_LOCAL_MARKETPLACE !== 'off',
    };
    try { this.config.editor = fs.realpathSync(this.config.editor); } catch {}
    this.available = process.platform === 'darwin' && process.arch === 'arm64'
      && fs.existsSync(path.join(this.config.editor, 'out/server-main.kscode.js'));
    this.ready = false;
    this.visible = false;
    this.disposed = false;
    this.generation = 0;
    this.visibilityRequest = 0;
    this.pending = new Map();
    this.sequence = 0;
    this.marketplace = { provider:'Open VSX',enabled:this.config.marketplace,online:this.config.marketplace?null:false,lastError:this.config.marketplace?null:'Open VSX 已关闭；本地 VSIX 仍可使用',checkedAt:null };
    this.diagnostics = { mode: 'original-kscode', blocked: [], processes: [], console: [], errors: [], transitions: [] };
    this.window.on('resize', () => this.applyBounds());
    this.window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      // Vue updates sessionId with same-document history. The DOM host adapter
      // handles SPA visibility; hiding here would leave its shown flag stale.
      if (mainFrame && !inPlace) this.hide();
    });
    this.window.webContents.on('did-navigate', () => this.hide());
    this.poll = setInterval(() => {
      if (this.visible && !this.loading) this.refreshContext().catch(error => this.recordError(error));
    }, 1500);
    this.poll.unref();
  }

  status() {
    return {
      available: this.available, mode: 'original-kscode', ready: this.ready && !this.loading, visible: this.visible,
      workspace: this.context?.workspace || null, projectId: this.context?.project?.id ?? null,
      revision: this.context?.revision ?? null, error: this.lastError || null,
      bounds: this.view?.getBounds() || null,
      capabilities: { files: true, save: true, terminal: true, extensions: true, localVSIX: true, marketplace:this.config.marketplace },
      marketplace: {...this.marketplace},
      limitations: ['市场来源为 Open VSX；扩展自身需要的其他网络和二进制仍受限'],
    };
  }
  recordError(error) {
    this.lastError = error.message;
    this.diagnostics.errors.push(error.message);
    if (this.diagnostics.errors.length > 80) this.diagnostics.errors.shift();
    this.writeDiagnostics();
  }
  async writeDiagnostics() {
    const directory = this.statePaths.diagnosticsDir;
    await fsp.mkdir(directory, { recursive: true });
    await fsp.writeFile(path.join(directory, 'native-editor.json'), JSON.stringify({ ...this.status(), ...this.diagnostics }, null, 2));
  }
  async getContext() {
    const response = await fetch(new URL('/__local/editor-context', this.baseURL), { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Local editor context returned HTTP ${response.status}`);
    const context = await response.json();
    if (typeof context.workspace !== 'string' || !path.isAbsolute(context.workspace)) throw new Error('Local editor workspace is missing');
    context.workspace = await fsp.realpath(context.workspace);
    if (!(await fsp.stat(context.workspace)).isDirectory()) throw new Error('Local editor workspace is not a directory');
    return context;
  }

  async startServer() {
    if (this.serverReady) return this.serverReady;
    this.serverReady = (async () => {
      await fsp.mkdir(this.sandbox, { recursive: true, mode: 0o700 });
      // macOS aliases /var to /private/var, and custom state directories may
      // contain symlinks. Resource admission compares real paths, so its
      // sandbox roots and the worker configuration must use the same form.
      this.sandbox = await fsp.realpath(this.sandbox);
      this.config.sandbox = this.sandbox;
      this.config.agent = path.join(this.sandbox, 'agent');
      await fsp.mkdir(path.join(this.sandbox, 'tmp'), { recursive: true, mode: 0o700 });
      await fsp.mkdir(path.join(this.sandbox, 'shell'), { recursive: true, mode: 0o700 });
      await fsp.mkdir(this.config.temporary, { recursive: true, mode: 0o700 });
      await fsp.mkdir(path.join(this.config.agent, 'home'), { recursive: true, mode: 0o700 });
      const settings = path.join(this.config.agent, 'data/User/settings.json');
      await fsp.mkdir(path.dirname(settings), { recursive: true });
      let preferences = {};
      try { preferences = JSON.parse(await fsp.readFile(settings, 'utf8')); } catch {}
      await fsp.writeFile(settings, JSON.stringify({ ...preferences,
        'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
        'extensions.ignoreRecommendations': true, 'update.mode': 'none', 'workbench.startupEditor': 'none',
        'git.enabled': false, 'files.autoSave': 'afterDelay', 'files.autoSaveDelay': 500,
        'terminal.integrated.profiles.osx': { 'Local zsh': { path: '/bin/zsh', args: ['-f'], env: { ZDOTDIR: path.join(this.sandbox, 'shell'), HISTFILE: path.join(this.sandbox, 'shell/history') } } },
        'terminal.integrated.defaultProfile.osx': 'Local zsh',
        'terminal.integrated.shellIntegration.enabled': false,
        'terminal.integrated.inheritEnv': false,
        'json.schemaDownload.enable': false,
        'typescript.disableAutomaticTypeAcquisition': true,
      }, null, 2), { mode: 0o600 });
      this.editorSettings = JSON.parse(await fsp.readFile(settings, 'utf8'));
      // The web workbench reads remote user configuration from Machine,
      // whereas the native server's default-profile file lives under User.
      const remoteSettings = path.join(this.config.agent, 'data/Machine/settings.json');
      await fsp.mkdir(path.dirname(remoteSettings), { recursive: true });
      await fsp.writeFile(remoteSettings, JSON.stringify(this.editorSettings, null, 2), { mode: 0o600 });
      const env = { ELECTRON_RUN_AS_NODE: '1',
        M0_ORIGINAL_EDITOR_CONFIG: Buffer.from(JSON.stringify(this.config)).toString('base64url'),
      };
      for (const name of ['PATH', 'LANG', 'LC_ALL']) if (process.env[name]) env[name] = process.env[name];
      env.TMPDIR = this.config.temporary;
      env.SHELL = '/bin/zsh';
      env.ZDOTDIR = path.join(this.sandbox, 'shell');
      const child = this.worker = fork(path.join(__dirname, 'editor-server.cjs'), [], {
        execPath: process.execPath, execArgv: [], cwd: this.sandbox, env, silent: true,
      });
      const log = chunk => {
        if (!this.disposed && this.diagnostics.console.length < 100) this.diagnostics.console.push({ process: 'server', message: String(chunk).slice(0, 3000) });
      };
      child.stdout?.on('data', log);
      child.stderr?.on('data', log);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Original editor server startup timed out')), 15000);
        child.on('message', message => {
          if (message.type === 'ready') { clearTimeout(timer); resolve(); }
          else if (message.type === 'fatal') { clearTimeout(timer); reject(new Error(message.error)); }
          else if (message.type === 'blocked') {
            if (this.diagnostics.blocked.length < 150) this.diagnostics.blocked.push({ process: 'server', operation: message.operation });
          } else if (message.type === 'process') {
            this.diagnostics.processes.push(message.operation);
          } else if (message.type === 'marketplace') {
            this.recordMarketplace(message.operation);
          } else if (message.type === 'reply') {
            const pending = this.pending.get(message.id);
            if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
          }
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', (code, signal) => {
          clearTimeout(timer);
          if (!this.disposed && !this.stoppingServer) { this.serverReady = null; this.recordError(new Error(`Original editor server exited (${code ?? signal})`)); }
          for (const pending of this.pending.values()) pending.reject(new Error('Original editor server closed'));
          this.pending.clear();
          reject(new Error('Original editor server closed before ready'));
        });
      });
    })();
    return this.serverReady;
  }
  call(method, args = {}, authority = this.authority) {
    return new Promise((resolve, reject) => {
      if (!this.worker?.connected) return reject(new Error('Original editor server is unavailable'));
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Original editor ${method} timed out`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.send({ type: 'call', id, method, args, authority });
    });
  }
  async stopServer() {
    const worker = this.worker;
    if (!worker) return;
    this.stoppingServer = true;
    try {
      await new Promise(resolve => {
        if (worker.exitCode !== null || worker.signalCode !== null) return resolve();
        let timer;
        worker.once('exit', () => { clearTimeout(timer); resolve(); });
        worker.kill('SIGTERM');
        timer = setTimeout(() => { worker.kill('SIGKILL'); resolve(); }, 4000);
      });
    } finally { this.worker = null; this.serverReady = null; this.stoppingServer = false; }
  }

  async show({ bounds } = {}) {
    if (!this.available || this.disposed || this.allowNavigate) return this.status();
    const visibilityRequest = ++this.visibilityRequest;
    this.visible = true;
    this.setBounds(bounds);
    try { await this.refreshContext(); }
    catch (error) { this.recordError(error); throw error; }
    if (visibilityRequest === this.visibilityRequest && this.visible) this.applyBounds();
    else this.view?.setVisible(false);
    return this.status();
  }
  hide() {
    this.visibilityRequest++;
    this.visible = false;
    this.view?.setVisible(false);
    this.flush().catch(error => this.recordError(error));
    return this.status();
  }
  setBounds(bounds) {
    if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) throw new Error('Editor bounds must be finite CSS pixel values');
    this.bounds = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
    this.applyBounds();
    return this.status();
  }
  applyBounds() {
    if (!this.view || !this.bounds || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const x = Math.min(width, Math.max(0, this.bounds.x));
    const y = Math.min(height, Math.max(0, this.bounds.y));
    this.view.setBounds({ x, y, width: Math.max(1, Math.min(width - x, this.bounds.width)), height: Math.max(1, Math.min(height - y, this.bounds.height)) });
    this.view.setVisible(this.visible && this.bounds.width > 1 && this.bounds.height > 1);
  }

  async refreshContext() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const context = await this.getContext();
      const changed = !this.context || this.context.workspace !== context.workspace || String(this.context.project?.id) !== String(context.project?.id);
      if (!changed && this.view) return;
      if (this.view) {
        await this.flush();
        this.ready = false;
        this.destroyView();
        await this.stopServer();
      }
      await this.startServer();
      await this.loadWorkspace(context);
      this.context = context;
      await this.writeDiagnostics();
    })();
    try { await this.loading; } finally { this.loading = null; }
  }
  async loadWorkspace(context) {
    await this.flush();
    const generation = ++this.generation;
    this.ready = false;
    this.lastError = null;
    this.destroyView();
    this.authority = `m0-${context.project?.id ?? createHash('sha256').update(context.workspace).digest('hex').slice(0, 12)}`;
    const currentConfig = { ...this.config, workspace: context.workspace };
    const editorSession = session.fromPartition(`m0-original-editor-${process.pid}-${generation}`);
    const allowedFile = candidate => {
      try { const real = fs.realpathSync(candidate); return [this.config.editor, this.sandbox, context.workspace].some(base => under(real, base)); }
      catch { return false; }
    };
    editorSession.protocol.registerFileProtocol('vscode-remote', (request, callback) => {
      const file = decodeURIComponent(new URL(request.url).pathname);
      callback(allowedFile(file) ? { path: file } : { error: -10 });
    });
    editorSession.protocol.registerFileProtocol('vscode-webview', (request, callback) => {
      const entry = new URL(request.url).pathname;
      callback(['/index.html', '/fake.html', '/service-worker.js'].includes(entry)
        ? { path: path.join(this.config.editor, 'out/vs/workbench/contrib/webview/browser/pre', entry.slice(1)) } : { error: -10 });
    });
    editorSession.protocol.registerBufferProtocol('kscode-fetch', (_request, callback) => callback({ mimeType: 'application/json', data: Buffer.from('{}') }));
    editorSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    editorSession.setPermissionCheckHandler(() => false);
    editorSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = /^(blob:|data:|vscode-remote:|vscode-webview:|kscode-fetch:)/.test(details.url);
      if(this.config.marketplace && marketplaceNetwork.allows(details.url,details.method))allowed=true;
      if (details.url.startsWith('file:')) { try { allowed = allowedFile(fileURLToPath(details.url)); } catch {} }
      if (!allowed && this.diagnostics.blocked.length < 150) this.diagnostics.blocked.push({ process: 'renderer-network', url: new URL(details.url).origin + new URL(details.url).pathname });
      callback({ cancel: !allowed });
    });
    this.view = new WebContentsView({ webPreferences: {
      nodeIntegration: true, contextIsolation: false, sandbox: false, session: editorSession,
      preload: path.join(this.root, 'tools/authentic-editor-preload.cjs'),
      additionalArguments: ['--m0-authentic-editor=' + Buffer.from(JSON.stringify(currentConfig)).toString('base64url')],
    } });
    this.window.contentView.addChildView(this.view);
    this.applyBounds();
    const contents = this.view.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-prevent-unload', event => { if (this.allowClose || this.allowNavigate) event.preventDefault(); });
    contents.on('console-message', event => { if (this.diagnostics.console.length < 150) this.diagnostics.console.push({ process: 'renderer', level: event.level, message: event.message }); });
    contents.on('render-process-gone', (_event, details) => this.recordError(new Error(`Original renderer stopped: ${details.reason}`)));
    const originalEntry = path.join(this.config.editor, 'out/vs/code/browser/workbench/workbench.kscode.html');
    const launchFile=path.join(this.sandbox,'workbench-local.js');
    const originalLauncher=await fsp.readFile(path.join(path.dirname(originalEntry),'workbench.kscode.js'),'utf8');
    const launchConfiguration={embedderIdentifier:'m0-local',extensionsGallery:this.config.marketplace?marketplaceNetwork.gallery:{}};
    const localLauncher=originalLauncher.replace('productConfiguration:{embedderIdentifier:"server-distro"}',`productConfiguration:${JSON.stringify(launchConfiguration)}`);
    if(localLauncher===originalLauncher)throw new Error('Original editor launcher product configuration was not found');
    await fsp.writeFile(launchFile,localLauncher);
    const entryHTML = (await fsp.readFile(originalEntry, 'utf8'))
      .replace('<head>', '<head>\n<base href="' + pathToFileURL(path.dirname(originalEntry) + path.sep).href + '">')
      .replace("const baseUrl = new URL('../../../../../', location.href).toString();", 'const baseUrl = ' + JSON.stringify(pathToFileURL(this.config.editor + path.sep).href) + ';')
      .replace(/availableLanguages:\s*\{\s*'\*':\s*'zh-cn'\s*\}/, 'availableLanguages: {}')
      .replace('src="workbench.kscode.js"',`src="${pathToFileURL(launchFile).href}"`);
    const localEntry = path.join(this.sandbox, `entry-${process.pid}.html`);
    await fsp.writeFile(localEntry, entryHTML);
    await contents.loadFile(localEntry, { query: { remoteauthority: this.authority, folder: context.workspace } });
    // Original devtoolsExport becomes available only after the renderer has
    // connected over its local Unix management socket.
    const candidates = [...(Array.isArray(context.entryFiles) ? context.entryFiles : []), 'README.md', 'package.json'];
    const firstFile = candidates.map(file => path.resolve(context.workspace, file))
      .find(file => under(file, context.workspace) && fs.existsSync(file) && fs.statSync(file).isFile());
    await this.call('getOpeningFilesStat');
    // This is the original web workbench: its local configuration service is
    // separate from the server's User file. Apply our isolated profile settings
    // through that service, including the no-dotfiles shell profile.
    await contents.executeJavaScript(`(async()=>{const configuration=window.devtoolsExport.O,known=new Set(configuration.keys().default||[]);const settings=${JSON.stringify(this.editorSettings)};for(const [key,value] of Object.entries(settings))if(known.has(key))await configuration.updateValue(key,value);})()`);
    if (firstFile) await this.call('openEditor', { filePath: firstFile, workspace: context.workspace });
    if (generation !== this.generation || this.disposed) return;
    this.ready = true;
    this.diagnostics.transitions.push({ workspace: context.workspace, authority: this.authority, ready: true, opened: firstFile || null });
    await this.writeDiagnostics();
  }
  async flush() {
    if (!this.view || this.view.webContents.isDestroyed() || !this.ready) return;
    const saving = this.view.webContents.executeJavaScript(`(async () => {
      const d = window.devtoolsExport;
      const groups = d?.R?.groups || (d?.activeGroup ? [d.activeGroup] : []);
      for (const group of groups) {
        for (const input of group.editors) {
          if (input.isDirty?.() && typeof input.save === 'function') await input.save(group.id);
        }
      }
      return groups.reduce((count, group) => count + group.editors.filter(input => input.isDirty?.()).length, 0);
    })()`);
    let timer;
    const remaining = await Promise.race([saving, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Saving original editor files timed out')), 8000); })]).finally(() => clearTimeout(timer));
    if (remaining) throw new Error('Original editor still has unsaved files');
  }
  async openTerminal() {
    if (!this.ready || !this.view) throw new Error('请先打开 Code 项目');
    const config = { name: 'Local zsh', cwd: this.context.workspace, executable: '/bin/zsh', args: ['-f'],
      env: { ZDOTDIR: path.join(this.sandbox, 'shell'), HISTFILE: path.join(this.sandbox, 'shell/history') } };
    const terminal = await this.view.webContents.executeJavaScript(`(async()=>{const d=window.devtoolsExport,t=await d.gb.createTerminal({config:${JSON.stringify(config)},location:1});await t.processReady;await d.switchTerminal(t.instanceId);return {id:t.instanceId,name:t.title,processId:t.processId};})()`);
    return { success: true, terminal, workspace: this.context.workspace };
  }
  async showExtensions() {
    if (!this.ready || !this.view) throw new Error('请先打开 Code 项目');
    await this.view.webContents.executeJavaScript(`window.devtoolsExport.W.openPaneComposite('workbench.view.extensions',0,true).then(()=>undefined)`);
    const marketplace=await this.marketplaceStatus();
    if(marketplace.online===false)await this.view.webContents.executeJavaScript(`(()=>{let note=document.getElementById('m0-marketplace-offline');if(!note){note=document.createElement('div');note.id='m0-marketplace-offline';note.style.cssText='position:fixed;bottom:28px;right:20px;z-index:10000;background:#fff4ce;color:#533f03;border:1px solid #cda440;padding:12px;border-radius:6px;font:13px sans-serif;max-width:420px';document.body.appendChild(note);}note.textContent='Open VSX 暂不可用：已安装扩展和本地 VSIX 安装仍可使用。';setTimeout(()=>note.remove(),15000);})()`);
    return { success: true,marketplace };
  }
  recordMarketplace(operation){
    this.diagnostics.marketplace ||= [];
    if(this.diagnostics.marketplace.length<300)this.diagnostics.marketplace.push(operation);
    if(operation.startsWith('market:response:2')){this.marketplace.online=true;this.marketplace.lastError=null;this.marketplace.checkedAt=Date.now();}
    if(operation.startsWith('market:error:')){this.marketplace.online=false;this.marketplace.lastError=operation.slice(13);this.marketplace.checkedAt=Date.now();}
  }
  async marketplaceStatus(){
    if(!this.config.marketplace)return {...this.marketplace,online:false,lastError:'Open VSX 已关闭；本地 VSIX 仍可使用'};
    if(this.marketplace.checkedAt && Date.now()-this.marketplace.checkedAt<30000)return {...this.marketplace};
    try{const response=await fetch('https://open-vsx.org/api/-/search?query=dracula&size=1',{signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);await response.json();this.marketplace.online=true;this.marketplace.lastError=null;}
    catch(error){this.marketplace.online=false;this.marketplace.lastError=error.message;}
    this.marketplace.checkedAt=Date.now();return {...this.marketplace};
  }
  async installVSIX(file) {
    if (!this.ready || !this.view) throw new Error('请先打开 Code 项目');
    const resolved = await fsp.realpath(file);
    if (!resolved.toLowerCase().endsWith('.vsix') || !(await fsp.stat(resolved)).isFile()) throw new Error('请选择本地 .vsix 文件');
    const resource = { scheme: 'vscode-remote', authority: this.authority, path: resolved };
    await this.view.webContents.executeJavaScript(`new Promise((resolve,reject)=>require(['vs/base/common/uri'],m=>window.devtoolsExport.Y.install(m.URI.from(${JSON.stringify(resource)})).then(()=>resolve(true),reject),reject))`);
    return { success: true, file: path.basename(resolved), note: '扩展已安装到当前本地编辑器 profile；扩展自身的外部网络访问保持关闭。' };
  }
  recordRendererBlock(event, value) {
    if(event.sender===this.view?.webContents && String(value?.operation).startsWith('market:')){this.recordMarketplace(value.operation);return;}
    if (event.sender === this.view?.webContents && this.diagnostics.blocked.length < 150) this.diagnostics.blocked.push({ process: 'renderer', operation: String(value?.operation || '') });
  }
  destroyView() {
    if (!this.view) return;
    try { this.window.contentView.removeChildView(this.view); } catch {}
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close({ waitForBeforeUnload: false });
    this.view = null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.visible = false;
    this.ready = false;
    clearInterval(this.poll);
    this.destroyView();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Original editor disposed')); }
    this.pending.clear();
    if (this.worker && !this.worker.killed) this.worker.kill('SIGTERM');
    const removeTemporary = () => fsp.rm(this.config.temporary, { recursive: true, force: true }).catch(() => {});
    if (this.worker?.exitCode === null && this.worker?.signalCode === null) this.worker.once('exit', removeTemporary);
    else void removeTemporary();
    this.writeDiagnostics().catch(() => {});
  }
}

module.exports = { OriginalEditorManager, registerOriginalEditorSchemes };
