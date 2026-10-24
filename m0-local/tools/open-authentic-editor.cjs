'use strict';

if (!process.argv.includes('--run')) {
  console.log('Not started. Isolated original editor experiment:');
  console.log('./node_modules/.bin/electron tools/open-authentic-editor.cjs --run --smoke-test');
  console.log('Use --run --interactive to keep the isolated original editor window open.');
  process.exit(0);
}
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const root = path.resolve(__dirname, '..');
const editor = fs.realpathSync(path.resolve(root, '../M0-AI-recovered/extracted/resources/editor'));
const sandbox = path.join(root, '.local-data', 'authentic-editor-window');
const workspace = path.join(sandbox, 'workspace');
const readme = path.join(workspace, 'README.md');
const reportPath = path.join(root, 'diagnostics', 'authentic-editor-window.json');
const report = { editor, sandbox, workspace, originalEntry: 'workbench.kscode.html', blocked: [], console: [], failures: [] };
const interactive = process.argv.includes('--interactive');
const smoke = !interactive || process.argv.includes('--smoke-test');
const locale = process.argv.includes('--locale=zh-cn') ? 'zh-cn' : 'en';
report.locale = locale;
let win;
let finished = false;
fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
if (!fs.existsSync(readme)) fs.writeFileSync(readme, '# Authentic KSCode probe\n\nThis README belongs only to the isolated local editor test.\n', { mode: 0o600 });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
app.setName('Astrix Editor');
app.setPath('userData', path.join(sandbox, 'electron'));
app.commandLine.appendSwitch('disable-background-networking');
protocol.registerSchemesAsPrivileged([
  { scheme: 'kscode-fetch', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'vscode-remote', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'vscode-webview', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const config = {
  sandbox, editor, agent: path.join(sandbox, 'agent'),
  socket: path.join(sandbox, 'editor.sock'), extensionSocket: path.join(sandbox, 'extension.sock'),
};
process.env.KSCODE_SOCKET_IPC_HANDLE = config.socket;
process.env.KSCODE_EXTENSION_IPC_HANDLE = config.extensionSocket;
process.env.VSCODE_AGENT_FOLDER = config.agent;
process.env.VSCODE_PARENT_PID = String(process.pid);
delete process.env.VSCODE_DEV;
delete process.env.VSCODE_INJECT_NODE_MODULE_LOOKUP_PATH;
const settings = path.join(config.agent, 'data', 'User', 'settings.json');
fs.mkdirSync(path.dirname(settings), { recursive: true });
if (!fs.existsSync(settings)) fs.writeFileSync(settings, JSON.stringify({
  'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false, 'extensions.ignoreRecommendations': true,
  'update.mode': 'none', 'workbench.startupEditor': 'none', 'git.enabled': false,
}, null, 2));
require('./authentic-editor-guard.cjs')({ sandbox, editor, record: operation => report.blocked.push({ process: 'main', operation }) });

const under = (candidate, base) => {
  const resolved = path.resolve(candidate);
  return resolved === base || resolved.startsWith(base + path.sep);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, label, ms = 15_000) => Promise.race([promise, delay(ms).then(() => { throw new Error(`${label} timed out`); })]);

async function finish(ok, error) {
  if (finished) return;
  finished = true;
  report.ok = ok;
  if (error) report.error = { message: error.message, stack: String(error.stack).slice(0, 5000) };
  if (win && !win.isDestroyed()) {
    try {
      report.dom = await bounded(win.webContents.executeJavaScript(`({ title: document.title, text: document.body.innerText.slice(0, 15000), editors: document.querySelectorAll('.monaco-editor').length, lines: [...document.querySelectorAll('.monaco-editor .view-lines')].map(e=>e.innerText) })`), 'DOM snapshot', 3000);
      await fsp.writeFile(path.join(root, 'diagnostics', 'authentic-editor-window.png'), (await win.webContents.capturePage()).toPNG());
    } catch (captureError) { report.failures.push(captureError.message); }
  }
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok, reportPath, error: report.error?.message }));
  if (smoke || !ok) app.exit(ok ? 0 : 1);
}

const timeout = setTimeout(() => finish(false, new Error('Authentic editor experiment exceeded 45 seconds')), 45_000);
app.whenReady().then(async () => {
  const { startupMain } = require(path.join(editor, 'out/server-main.kscode.js'));
  const server = await bounded(startupMain(), 'Original editor server startup');
  report.serverReady = true;
  protocol.registerFileProtocol('vscode-remote', (request, callback) => {
    const file = decodeURIComponent(new URL(request.url).pathname);
    callback(under(file, workspace) || under(file, editor) || under(file, sandbox) ? { path: file } : { error: -10 });
  });
  protocol.registerFileProtocol('vscode-webview', (request, callback) => {
    const file = new URL(request.url).pathname;
    callback(['/index.html', '/fake.html', '/service-worker.js'].includes(file)
      ? { path: path.join(editor, 'out/vs/workbench/contrib/webview/browser/pre', file.slice(1)) } : { error: -10 });
  });
  // The recovered message bundle is a constant object followed by an export.
  // Its single-quoted strings require a restricted VM rather than JSON.parse;
  // that VM receives no Node globals and cannot compile code from strings.
  const nlsSource = fs.readFileSync(path.resolve(root, '../M0-AI-recovered/extracted/app/out/main/message-DyS0UpZG.js'), 'utf8');
  const declarationEnd = nlsSource.indexOf('\nexport ');
  if (declarationEnd < 0) throw new Error('Recovered translation export boundary not found');
  const nlsLiteral = nlsSource.slice(nlsSource.indexOf('{'), declarationEnd).trim().replace(/;$/, '');
  const messages = require('node:vm').runInNewContext('(' + nlsLiteral + ')', Object.create(null), {
    timeout: 1000, contextCodeGeneration: { strings: false, wasm: false },
  });
  if (!Object.values(messages).every(value => Array.isArray(value) && value.every(item => typeof item === 'string'))) {
    throw new Error('Recovered editor translations must be arrays of strings.');
  }
  protocol.registerBufferProtocol('kscode-fetch', (request, callback) => callback({
    mimeType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    data: Buffer.from(JSON.stringify(new URL(request.url).hostname === 'nlsmessage' ? messages : {})),
  }));
  ipcMain.on('authentic-editor:blocked', (_event, value) => report.blocked.push({ process: 'renderer', ...value }));
  win = new BrowserWindow({
    title: 'Astrix · KSCode', width: 1440, height: 940, show: true,
    webPreferences: {
      nodeIntegration: true, contextIsolation: false, sandbox: false,
      preload: path.join(__dirname, 'authentic-editor-preload.cjs'),
      additionalArguments: ['--m0-authentic-editor=' + Buffer.from(JSON.stringify(config)).toString('base64url')],
    },
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(blob:|data:|vscode-remote:|vscode-webview:|kscode-fetch:)/.test(details.url);
    if (details.url.startsWith('file:')) {
      try { const file = fileURLToPath(details.url); allowed = under(file, editor) || under(file, sandbox); } catch {}
    }
    if (!allowed) report.blocked.push({ process: 'browser-network', url: new URL(details.url).origin + new URL(details.url).pathname });
    callback({ cancel: !allowed });
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('console-message', event => {
    if (report.console.length < 200) report.console.push({ level: event.level, message: event.message, source: event.sourceId, line: event.lineNumber });
  });
  win.webContents.on('render-process-gone', (_event, details) => report.failures.push(JSON.stringify(details)));
  const originalEntry = path.join(editor, 'out/vs/code/browser/workbench/workbench.kscode.html');
  let entryHTML = fs.readFileSync(originalEntry, 'utf8')
    .replace('<head>', '<head>\n<base href="' + pathToFileURL(path.dirname(originalEntry) + path.sep).href + '">')
    .replace("const baseUrl = new URL('../../../../../', location.href).toString();", 'const baseUrl = ' + JSON.stringify(pathToFileURL(editor + path.sep).href) + ';');
  if (locale === 'en') entryHTML = entryHTML.replace(/availableLanguages:\s*\{\s*'\*':\s*'zh-cn'\s*\}/, 'availableLanguages: {}');
  const localEntry = path.join(sandbox, 'workbench.kscode.html');
  fs.writeFileSync(localEntry, entryHTML);
  report.loaderAdaptation = 'Derived HTML shell sets local asset base; English mode uses the bundled default NLS. Original workbench JS/CSS stay unchanged.';
  await win.loadFile(localEntry, {
    query: { remoteauthority: 'isolated-local-probe', folder: workspace },
  });
  await delay(3000);
  const service = server.getDevtoolsExports('isolated-local-probe');
  await bounded(service.openEditor({ filePath: readme, selection: { startLineNumber: 1, startColumn: 1 } }), 'Original openEditor');
  report.openEditorResolved = true;
  report.openFiles = await bounded(service.getOpeningFilesStat(), 'Original getOpeningFilesStat');
  await delay(1500);
  const content = await win.webContents.executeJavaScript(`document.body.innerText`);
  report.readmeVisible = content.replace(/\u00a0/g, ' ').includes('Authentic KSCode probe');
  clearTimeout(timeout);
  await finish(report.readmeVisible, report.readmeVisible ? undefined : new Error('Original editor opened but README text is not visible'));
}).catch(async error => {
  clearTimeout(timeout);
  await finish(false, error);
});
app.on('window-all-closed', () => app.quit());
