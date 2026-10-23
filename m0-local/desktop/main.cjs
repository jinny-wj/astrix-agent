'use strict';

// This entry point runs only our local shell. It never imports the recovered main
// process, preload, updater, or the bundled OpenCode executable.
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { OriginalEditorManager, registerOriginalEditorSchemes } = require('./original-editor.cjs');
const { navigateAndWait } = require('./local-navigation.cjs');
const { FigmaHostManager, isTrustedLocalMainFrame } = require('./figma-host.cjs');

const projectRoot = path.resolve(__dirname, '..');
const smokeTest = process.argv.includes('--smoke-test');
const baseURL = new URL(process.env.M0_LOCAL_URL || `http://127.0.0.1:${process.env.M0_LOCAL_PORT || 4317}`);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
if (baseURL.protocol !== 'http:' || !loopbackHosts.has(baseURL.hostname) || baseURL.username || baseURL.password) {
  throw new Error('M0_LOCAL_URL must be an HTTP loopback URL without credentials.');
}
baseURL.pathname = '/';
baseURL.search = '';
baseURL.hash = '';

app.setName('M0 Local');
const profile = process.env.M0_LOCAL_PROFILE || 'electron';
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profile)) throw new Error('M0_LOCAL_PROFILE must be a simple local profile name');
app.setPath('userData', path.join(projectRoot, '.data', profile));
app.commandLine.appendSwitch('disable-background-networking');
registerOriginalEditorSchemes();

let mainWindow;
const canvasWindows = new Set();
let childServer;
let originalEditor;
let figmaHost;
let activeSurface = 'none';
let surfaceRequest = 0;
let startupFailure;
let smokeResultWritten = false;
let quitPrepared = false;
let preparingQuit = false;
let navigationPrepared = false;
let navigationTail = Promise.resolve();
const pendingNavigations = new Map();
const diagnostics = { url: baseURL.href, mode: 'local-reconstruction', errors: [], console: [] };
function navigationTrace(step, extra={}) { diagnostics.navigation ||= [];if(diagnostics.navigation.length<80)diagnostics.navigation.push({step,time:Date.now(),...extra}); }

function isLocalURL(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'ws:') && url.hostname === baseURL.hostname && url.port === baseURL.port;
  } catch {
    return false;
  }
}

function verifySender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || !isLocalURL(event.senderFrame?.url || '')) {
    throw new Error('Desktop bridge accepts only the local main window.');
  }
}

function verifyFigmaSender(event) {
  verifySender(event);
  if (!isTrustedLocalMainFrame(event,mainWindow,baseURL)) throw new Error('Figma bridge accepts only the local main frame.');
}

async function localRPC(namespace, method, args = []) {
  const response = await fetch(new URL('/__local/rpc', baseURL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseURL.origin },
    body: JSON.stringify({ namespace, method, args }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Local API returned HTTP ${response.status}.`);
  return body;
}

function getInfo() {
  return {
    name: 'M0 Local', version: require('../package.json').version, originalVersion: '3.9.5', isPackaged: app.isPackaged,
    platform: process.platform, arch: process.arch,
    runtime: { node: process.versions.node, electron: process.versions.electron, chrome: process.versions.chrome, v8: process.versions.v8 },
  };
}

function openLocalPage(url) {
  if (!isLocalURL(url)) throw new Error('Only local application pages may open');
  if (pendingNavigations.has(url)) return pendingNavigations.get(url);
  const operation = navigationTail.catch(() => {}).then(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Local application window is closed');
    if (mainWindow.webContents.getURL() === url && !mainWindow.webContents.isLoadingMainFrame()) return;
    navigationTrace('local-page-request', { url });
    activeSurface = 'none';surfaceRequest++;figmaHost?.hide();
    await originalEditor?.flush();
    navigationTrace('files-flushed', { url });
    navigationPrepared = true;
    if (originalEditor) originalEditor.allowNavigate = true;
    originalEditor?.hide();
    try {
      await navigateAndWait(mainWindow.webContents, url, { trace: navigationTrace });
      navigationTrace('local-page-loaded', { url, actual: mainWindow.webContents.getURL() });
    } catch (error) {
      navigationTrace('local-page-failed', { url, error: error.message });
      throw error;
    } finally {
      navigationPrepared = false;
      if (originalEditor) originalEditor.allowNavigate = false;
    }
  });
  pendingNavigations.set(url, operation);
  navigationTail = operation;
  operation.then(() => pendingNavigations.delete(url), () => pendingNavigations.delete(url));
  return operation;
}

function installBridge() {
  ipcMain.handle('m0-local:open-canvas-window', async (event, value) => {
    verifySender(event);
    await openCanvasWindow(value?.invite);
    return { opened: true };
  });
  ipcMain.handle('m0-local:window', async (event, method) => {
    verifySender(event);
    switch (method) {
      case 'getInfo': return getInfo();
      case 'getBaseURL': return baseURL.origin;
      case 'getBounds': return mainWindow.getBounds();
      case 'minimize': mainWindow.minimize(); return true;
      case 'toggleMaximize':
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
        return mainWindow.isMaximized();
      case 'close': mainWindow.close(); return true;
      case 'quit': app.quit(); return true;
      case 'relaunch': app.relaunch(); app.quit(); return true;
      default: throw new Error(`Unknown local window operation: ${method}`);
    }
  });
  ipcMain.handle('m0-local:choose-workspace', async (event, initialPath) => {
    verifySender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地项目文件夹',
      ...(typeof initialPath === 'string' && initialPath ? { defaultPath: initialPath } : {}),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { success: true, path: null };
    return localRPC('workspace', 'selectPath', [result.filePaths[0]]);
  });
  ipcMain.handle('m0-local:native-editor', async (event, method, value) => {
    verifySender(event);
    if (method === 'available') return Boolean(originalEditor?.available);
    if (!originalEditor) throw new Error('Original editor is not initialized');
    if (method === 'show') {
      const request = ++surfaceRequest;activeSurface = 'editor';figmaHost?.hide();
      const result = await originalEditor.show({ bounds: value?.bounds });
      if (request !== surfaceRequest || activeSurface !== 'editor') { if(activeSurface!=='editor')originalEditor.hide();return originalEditor.status(); }
      return result;
    }
    if (method === 'hide') { if(activeSurface==='editor'){activeSurface='none';surfaceRequest++;}return originalEditor.hide(); }
    if (method === 'updateBounds') return originalEditor.setBounds(value);
    if (method === 'getStatus') return originalEditor.status();
    if (method === 'marketplaceStatus') return originalEditor.marketplaceStatus();
    if (method === 'openTerminal') return originalEditor.openTerminal();
    if (method === 'showExtensions') return originalEditor.showExtensions();
    if (method === 'installVSIX') {
      const picked = await dialog.showOpenDialog(mainWindow, { title: '安装本地 VSIX 扩展', properties: ['openFile'], filters: [{ name: 'VS Code Extension', extensions: ['vsix'] }] });
      if (picked.canceled || !picked.filePaths[0]) return { success: true, canceled: true };
      return originalEditor.installVSIX(picked.filePaths[0]);
    }
    throw new Error('Unsupported original editor operation');
  });
  ipcMain.handle('m0-local:figma-host', async (event, method, value) => {
    verifyFigmaSender(event);
    if(method==='available')return Boolean(figmaHost&&!figmaHost.disposed);
    if(!figmaHost)throw new Error('Figma host is not initialized');
    if(method==='show'){
      const request=++surfaceRequest;activeSurface='figma';await originalEditor?.flush();
      if(request!==surfaceRequest||activeSurface!=='figma')return figmaHost.status();
      originalEditor?.hide();return figmaHost.show(value);
    }
    if(method==='hide'){if(activeSurface==='figma'){activeSurface='none';surfaceRequest++;}return figmaHost.hide();}
    if(method==='updateBounds')return figmaHost.updateBounds(value);
    if(method==='getStatus')return figmaHost.status();
    if(method==='openExternal')return figmaHost.openExternal(typeof value==='string'?value:value?.url);
    if(method==='revealBridgePlugin')return figmaHost.revealBridgePlugin(value||{});
    throw new Error('Unsupported Figma host operation');
  });
  ipcMain.on('authentic-editor:blocked', (event, value) => originalEditor?.recordRendererBlock(event, value));
}

async function serverIsReady() {
  try {
    const response = await fetch(new URL('/__local/health', baseURL), { signal: AbortSignal.timeout(700) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return false;
    const status = await response.json();
    return status.ok === true && status.m0Local === true;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverIsReady()) return;
  if (process.env.M0_LOCAL_URL) throw new Error(`No local project server responds at ${baseURL.origin}. Start npm start first.`);
  const entry = path.join(projectRoot, 'server', 'index.mjs');
  await fs.access(entry);
  childServer = spawn(process.execPath, [entry], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', M0_LOCAL_PORT: baseURL.port || '80', PORT: baseURL.port || '80' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  childServer.stdout.on('data', (data) => process.stdout.write(`[local server] ${data}`));
  childServer.stderr.on('data', (data) => process.stderr.write(`[local server] ${data}`));
  childServer.once('error', (error) => { startupFailure = error; });
  childServer.once('exit', (code) => {
    if (code && !startupFailure) startupFailure = new Error(`Local server exited with code ${code}.`);
  });
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (startupFailure) throw startupFailure;
    if (await serverIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local server did not become ready at ${baseURL.origin}.`);
}

async function writeSmokeResult(extra = {}) {
  if (smokeResultWritten) return;
  smokeResultWritten = true;
  const directory = path.join(projectRoot, 'diagnostics');
  await fs.mkdir(directory, { recursive: true });
  if (mainWindow && !mainWindow.isDestroyed()) {
    const screenshot = await mainWindow.webContents.capturePage();
    await fs.writeFile(path.join(directory, 'desktop-smoke.png'), screenshot.toPNG());
  }
  await fs.writeFile(path.join(directory, 'desktop-smoke.json'), JSON.stringify({ ...diagnostics, nativeEditor: originalEditor?.status(), ...extra }, null, 2));
}

function isCanvasInviteURL(value) {
  try {const url=new URL(value);return isLocalURL(value)&&url.pathname==='/local-canvas/index.html'&&/^[A-Za-z0-9_-]{24}$/.test(url.searchParams.get('invite')||'');}catch{return false;}
}

async function openCanvasWindow(invite) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(invite||'')) throw new Error('协作邀请格式无效');
  if (canvasWindows.size>=8) throw new Error('最多同时打开 8 个协作窗口');
  const isolatedSession=session.fromPartition('m0-local-canvas');
  isolatedSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  isolatedSession.setPermissionCheckHandler(()=>false);
  isolatedSession.webRequest.onBeforeRequest((details,callback)=>{
    let allowed=/^(data:|blob:|devtools:)/.test(details.url);
    if(isLocalURL(details.url)){const url=new URL(details.url);allowed=url.pathname.startsWith('/local-canvas/')||url.pathname.startsWith('/__local/collaboration/');}
    callback({cancel:!allowed});
  });
  const peer=new BrowserWindow({width:1440,height:940,minWidth:1000,minHeight:680,title:'M0 Local · 协作画布',backgroundColor:'#f7f8fb',show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,session:isolatedSession}});
  canvasWindows.add(peer);
  peer.once('closed',()=>canvasWindows.delete(peer));
  peer.once('ready-to-show',()=>peer.show());
  peer.webContents.setWindowOpenHandler(({url})=>{if(isCanvasInviteURL(url))openCanvasWindow(new URL(url).searchParams.get('invite')).catch(error=>dialog.showErrorBox('协作窗口未打开',error.message));return {action:'deny'};});
  peer.webContents.on('will-navigate',(event,url)=>{if(!isCanvasInviteURL(url))event.preventDefault();});
  peer.webContents.on('will-prevent-unload',()=>peer.show());
  const url=new URL('/local-canvas/index.html',baseURL);url.searchParams.set('invite',invite);
  try{await peer.loadURL(url.href);}catch(error){peer.destroy();throw error;}
  return peer;
}

async function createWindow() {
  const isolatedSession = session.fromPartition('persist:m0-local');
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isLocalURL(details.url) || /^(data:|blob:|devtools:)/.test(details.url);
    callback({ cancel: !allowed });
  });
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1000, minHeight: 680,
    title: 'M0 Local', backgroundColor: '#f7f7f7',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 17, y: 17 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      session: isolatedSession,
    },
  });
  originalEditor = new OriginalEditorManager({ window: mainWindow, root: projectRoot, baseURL: baseURL.href });
  figmaHost = new FigmaHostManager({window:mainWindow,root:projectRoot,baseURL:baseURL.href,onStatus:status=>{
    if(!mainWindow.isDestroyed()&&isLocalURL(mainWindow.webContents.getURL()))mainWindow.webContents.send('m0-local:figma-status',status);
  }});
  // A Node-only reference for the desktop integration test; never exposed to
  // the browser page or to its context bridge.
  mainWindow.originalEditor = originalEditor;
  mainWindow.figmaHost = figmaHost;
  mainWindow.localDiagnostics = diagnostics;
  let closePrepared = false;
  let preparingClose = false;
  mainWindow.on('close', event => {
    navigationTrace('close-request', { closePrepared, ready: originalEditor?.ready });
    if (closePrepared || !originalEditor?.ready && !figmaHost?.hasLivePage()) return;
    event.preventDefault();
    if (preparingClose) return;
    preparingClose = true;
    (async()=>{await originalEditor?.flush();return await figmaHost?.prepareClose()!==false;})().then(allowed => {
      if(!allowed){preparingClose=false;navigationTrace('figma-close-cancelled');return;}
      navigationTrace('close-files-flushed');
      closePrepared = true;
      originalEditor.allowClose = true;
      if (!mainWindow.isDestroyed()) mainWindow.close();
    }).catch(error => {
      navigationTrace('close-save-failed', { error: error.message });
      diagnostics.errors.push({ type: 'close-save', message: error.message });
      preparingClose = false;
      if(error.code==='FIGMA_CLOSE_FAILED')dialog.showErrorBox('Figma 页面尚未关闭',error.message);
      else dialog.showErrorBox('文件尚未保存', `原版编辑器未能保存文件，窗口已保留。\n${error.message}`);
    });
  });
  mainWindow.webContents.on('will-prevent-unload', event => {
    navigationTrace('main-will-prevent-unload',{closePrepared,quitPrepared,navigationPrepared});
    if (closePrepared || quitPrepared || navigationPrepared) event.preventDefault();
  });
  mainWindow.once('closed', () => { originalEditor?.dispose();figmaHost?.dispose(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    navigationTrace('window-open',{url});
    if (isCanvasInviteURL(url)) {
      openCanvasWindow(new URL(url).searchParams.get('invite')).catch(error => dialog.showErrorBox('协作窗口未打开',error.message));
      return { action: 'deny' };
    }
    // The local settings link uses target="_blank". Keep that usable inside the
    // one local application window without allowing remote popups.
    if (isLocalURL(url)) openLocalPage(url).catch((error) => {
      diagnostics.errors.push({ type: 'local-navigation', message: error.message });
      dialog.showErrorBox('页面尚未切换', error.message);
    });
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    navigationTrace('will-navigate',{url});
    event.preventDefault();
    if (isLocalURL(url)) openLocalPage(url).catch(error => {
      diagnostics.errors.push({ type: 'local-navigation', message: error.message });
      dialog.showErrorBox('页面尚未切换', error.message);
    });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => diagnostics.errors.push({ type: 'renderer', ...details }));
  mainWindow.webContents.on('console-message', (details) => {
    if (diagnostics.console.length < 200) diagnostics.console.push({
      level: details.level, message: details.message, line: details.lineNumber, sourceId: details.sourceId,
    });
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) diagnostics.errors.push({ type: 'load', code, description, url });
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(new URL('/home',baseURL).href);
  if (process.argv.includes('--devtools')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  if (smokeTest) {
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await writeSmokeResult({ loaded: true, title: mainWindow.getTitle() });
    app.quit();
  }
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!quitPrepared && (originalEditor?.ready || figmaHost?.hasLivePage())) {
    event.preventDefault();
    if (preparingQuit) return;
    preparingQuit = true;
    (async()=>{await originalEditor?.flush();return await figmaHost?.prepareClose()!==false;})().then(allowed => {if(!allowed){preparingQuit=false;return;}quitPrepared = true;if(originalEditor)originalEditor.allowClose = true;app.quit();}).catch(error => {
      preparingQuit = false;
      if(error.code==='FIGMA_CLOSE_FAILED')dialog.showErrorBox('Figma 页面尚未关闭',error.message);
      else dialog.showErrorBox('文件尚未保存', `原版编辑器未能保存文件，应用已保留。\n${error.message}`);
    });
    return;
  }
  originalEditor?.dispose();
  figmaHost?.dispose();
  if (childServer && !childServer.killed) childServer.kill('SIGTERM');
});
process.on('SIGTERM', () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window=mainWindow&&!mainWindow.isDestroyed()?mainWindow:[...canvasWindows][0];
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock) {
      try { app.dock.setIcon(path.join(__dirname, 'icon.icns')); } catch {}
    }
    installBridge();
    await ensureServer();
    await createWindow();
  }).catch(async (error) => {
    diagnostics.errors.push({ type: 'startup', message: error.message });
    if (smokeTest) await writeSmokeResult({ loaded: false });
    else dialog.showErrorBox('M0 Local 启动失败', error.message);
    console.error(error);
    originalEditor?.dispose();
    figmaHost?.dispose();
    if (childServer && !childServer.killed) childServer.kill('SIGTERM');
    app.exit(1);
  });
}
