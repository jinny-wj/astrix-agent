'use strict';

// Integration test for the new local server and recovered browser UI, using a
// clean Electron profile. Never imports or starts the original application.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const url = process.env.M0_LOCAL_URL || 'http://127.0.0.1:4317/home';
const stage = process.env.M0_UI_STAGE || 'full';
const parsedURL = new URL(url);
if (parsedURL.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedURL.hostname) || parsedURL.username || parsedURL.password) {
  throw new Error('UI check accepts only an HTTP loopback URL without credentials.');
}
const origin = parsedURL.origin;
const result = { startedAt: new Date().toISOString(), url, stage, events: [], console: [], network: [] };
let win;
app.setName('Astrix UI Check');
app.setPath('userData', path.join(root, '.local-data', 'ui-check-electron'));
app.commandLine.appendSwitch('disable-background-networking');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function snapshot(label) {
  const value = await win.webContents.executeJavaScript(`(() => ({
    url: location.href, title: document.title,
    text: document.body.innerText.slice(0, 22000),
    frames: [...document.querySelectorAll('iframe')].map(e => ({src:e.src,html:e.outerHTML,parent:e.parentElement.outerHTML.slice(0,1800)})),
    loadingRegions: [...document.querySelectorAll('[class*="loading"],[class*="figma"],[class*="editor"]')].filter(e=>e.offsetWidth&&e.offsetHeight).slice(-30).map(e=>({tag:e.tagName,class:e.className,html:e.outerHTML.slice(0,1400)})),
    controls: [...document.querySelectorAll('button,input,textarea,[role="tab"],[role="button"],[contenteditable="true"]')].map((e,i)=>({
      i, tag:e.tagName, text:(e.innerText||e.textContent||'').trim().slice(0,150),
      placeholder:e.getAttribute('placeholder'), role:e.getAttribute('role'),
      editable:e.getAttribute('contenteditable'), value:e.value,
      classes:e.className, visible: !!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)
    }))
  }))()`, true);
  result.events.push({ label, ...value });
  return value;
}

async function write(label) {
  const directory = path.join(root, 'diagnostics');
  await fs.mkdir(directory, { recursive: true });
  if (win && !win.isDestroyed()) {
    const image = await win.webContents.capturePage();
    await fs.writeFile(path.join(directory, `ui-check${label ? '-' + label : ''}.png`), image.toPNG());
  }
  await fs.writeFile(path.join(directory, 'ui-check-result.json'), JSON.stringify(result, null, 2));
}

app.whenReady().then(async () => {
  const health = await fetch(new URL('/__local/health', origin)).then(response => response.json());
  if (health.m0Local !== true || health.mode !== 'demo') throw new Error('UI check requires this local app in demo mode.');
  const profile = session.fromPartition('persist:m0-ui-check');
  profile.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  profile.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(origin + '/') || details.url.startsWith(origin.replace(/^http/, 'ws') + '/') || /^(blob:|data:|devtools:)/.test(details.url);
    if (!allowed) result.network.push({ blocked: true, url: details.url });
    callback({ cancel: !allowed });
  });
  profile.webRequest.onCompleted(details => {
    if (!details.url.includes('/vendor/') && result.network.length < 300) result.network.push({ status: details.statusCode, url: details.url, method: details.method });
  });
  win = new BrowserWindow({ width: 1520, height: 1000, show: true, webPreferences: { session: profile, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', event => { if (result.console.length < 100) result.console.push({ level: event.level, message: event.message, source: event.sourceId, line: event.lineNumber }); });
  await win.loadURL(url);
  await delay(4000);
  await snapshot('home');
  await write('home');
  if (stage !== 'inspect') {
    await win.webContents.executeJavaScript(`(() => {
      const control = [...document.querySelectorAll('button')].find(e => e.innerText.trim() === 'Code' && e.offsetWidth);
      if (!control) throw new Error('Visible Code tab not found');
      control.click();
    })()`, true);
    await delay(1200);
    await snapshot('code');
    await write('code');
  }
  if (stage === 'quick' || stage === 'full') {
    await win.webContents.executeJavaScript(`(() => {
      const control = [...document.querySelectorAll('button')].find(e => e.innerText.trim().startsWith('快速出码') && e.offsetWidth);
      if (!control) throw new Error('Visible quick code action not found');
      control.click();
    })()`, true);
    await delay(4000);
    const quick = await snapshot('quick');
    const projectId = new URL(quick.url).searchParams.get('id');
    const state = JSON.parse(await fs.readFile(path.join(root, '.local-data', 'state.json'), 'utf8'));
    const project = state.projects.find(item => String(item.id) === projectId);
    if (!project || !path.resolve(project.projectPath).startsWith(path.join(root, '.local-data') + path.sep)) {
      throw new Error('Quick code must create a test project inside this app’s .local-data directory.');
    }
    await fs.access(project.projectPath);
    result.testProject = { id: project.id, path: project.projectPath };
    await write('quick');
  }
  if (stage === 'full') {
    await win.webContents.executeJavaScript(`(() => {
      const input = [...document.querySelectorAll('[contenteditable="true"]')].find(e => e.offsetWidth);
      if (!input) throw new Error('Visible chat input not found');
      input.focus();
    })()`, true);
    win.webContents.insertText('本地界面测试');
    await delay(400);
    await snapshot('chat-draft');
    await win.webContents.executeJavaScript(`(() => {
      const send = [...document.querySelectorAll('[role="button"]')].find(e => e.offsetWidth && String(e.className).includes('bg-[#4080ff]'));
      if (!send || String(send.className).includes('cursor-not-allowed')) throw new Error('Chat send button is disabled');
      send.click();
    })()`, true);
    await delay(6000);
    const conversation = await snapshot('chat-reply');
    await write('conversation');
    if (!conversation.text.includes('本地界面测试')) throw new Error('Sent test message not visible');
    if (!conversation.text.includes('【本地界面演示】')) throw new Error('Local demo reply not visible');
    await win.webContents.reload();
    await delay(5000);
    const history = await snapshot('history-after-reload');
    await write('history');
    if (!history.text.includes('本地界面测试') || !history.text.includes('【本地界面演示】')) throw new Error('Saved conversation not visible after reload');
    result.assertions = { originalCodeTab: true, localProjectCreated: true, messageSent: true, demoReplyVisible: true, historyAfterReload: true };
  }
  result.ok = true;
  await write('');
  app.exit(0);
}).catch(async error => {
  result.ok = false; result.error = { message: error.message, stack: error.stack };
  await write('failure').catch(() => {});
  console.error(error);
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
