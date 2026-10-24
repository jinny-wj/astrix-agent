'use strict';
// Exercise the actual desktop main + recovered Vue host + original KSCode.
// Both HTTP data and the Electron profile are separate from normal user data.
const { app, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.env.M0_LOCAL_PROFILE = process.env.M0_NATIVE_EDITOR_TEST_PROFILE || 'native-editor-integration';
process.env.M0_LOCAL_PORT = process.env.M0_NATIVE_EDITOR_TEST_PORT || '4347';
process.env.M0_LOCAL_DATA_DIR = path.join(root, '.local-data', process.env.M0_LOCAL_PROFILE + '-backend');
process.env.M0_LOCAL_WORKSPACE = path.join(process.env.M0_LOCAL_DATA_DIR, 'workspace');
delete process.env.M0_LOCAL_URL;
const diagnostics = path.join(root, 'diagnostics');
const report = { mode: 'desktop-native-editor-integration',profile:process.env.M0_LOCAL_PROFILE,port:process.env.M0_LOCAL_PORT, assertions: {}, steps: [] };
// Report a real desktop error without leaving an unattended native alert open.
dialog.showErrorBox = (title,message) => { report.dialogError = { title,message }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, duration = 30000) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(200);
  }
  throw new Error(`${label} timed out`);
}
let window;
let started = false;
let holdingQuit = false;
let finishing = false;
async function typeIntoOriginal(contents, file, text) {
  // The recovered chat pane also focuses its prompt after route initialization.
  // Wait for a real editor focus and retry the mouse/native input if that late
  // focus wins; never replace typing with a model-content mutation.
  await delay(400);
  for(let attempt=0;attempt<5;attempt++){
    window.focus(); app.focus({steal:true}); contents.focus();
    const point=await contents.executeJavaScript(`(()=>{const editor=window.devtoolsExport.$.listCodeEditors().find(e=>e.getModel()?.uri.path===${JSON.stringify(file)});if(!editor)throw new Error('Expected original editor model is missing');editor.focus();const r=editor.getDomNode().getBoundingClientRect();return {x:Math.round(r.x+100),y:Math.round(r.y+20)};})()`);
    contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await contents.executeJavaScript(`(()=>{const editor=window.devtoolsExport.$.listCodeEditors().find(e=>e.getModel()?.uri.path===${JSON.stringify(file)});editor.focus();const model=editor.getModel(),line=model.getLineCount();editor.setPosition({lineNumber:line,column:model.getLineMaxColumn(line)});})()`);
    await delay(50);
    if(await contents.executeJavaScript(`window.devtoolsExport.$.listCodeEditors().find(e=>e.getModel()?.uri.path===${JSON.stringify(file)}).hasTextFocus()`))await contents.insertText(text);
    await delay(40);
    const state=await contents.executeJavaScript(`(()=>{const e=window.devtoolsExport.$.listCodeEditors().find(e=>e.getModel()?.uri.path===${JSON.stringify(file)});return {hasFocus:document.hasFocus(),textFocus:e.hasTextFocus(),readOnly:e.getRawOptions().readOnly,value:e.getModel().getValue(),selection:e.getSelection()};})()`);
    report.steps.push({name:'input-focus-state',attempt,state});
    if(state.value.includes(text.trim()))return;
    await delay(150);
  }
  throw new Error('Actual native input did not reach the original Monaco editor');
}
app.on('before-quit', event => { if (holdingQuit) event.preventDefault(); });
const watchdog = setTimeout(() => finish(false, new Error('Native editor integration exceeded two minutes')), 120000);
async function finish(ok, error) {
  if (finishing) return;
  finishing = true;
  clearTimeout(watchdog);
  report.ok = ok;
  if (error) report.error = { message: error.message, stack: error.stack };
  const manager = window?.originalEditor;
  if (manager) report.status = manager.status();
  if (window && !window.isDestroyed()) report.hostURL = window.webContents.getURL();
  if(window?.localDiagnostics)report.desktopDiagnostics={errors:window.localDiagnostics.errors,navigation:window.localDiagnostics.navigation};
  try {
    await fs.mkdir(diagnostics, { recursive: true });
    if (window && !window.isDestroyed()) {
      await fs.writeFile(path.join(diagnostics, 'native-editor-integrated-window.png'), (await window.capturePage()).toPNG());
      if (manager?.view) await fs.writeFile(path.join(diagnostics, 'native-editor-integrated-content.png'), (await manager.view.webContents.capturePage()).toPNG());
    }
    if (manager) {
      const worker = manager.worker;
      manager.dispose();
      await until(() => worker?.exitCode !== null || worker?.signalCode !== null, 'Native editor worker cleanup', 4000);
      report.assertions.workerStopped = true;
      report.assertions.viewDestroyed = !manager.view;
    }
    await fs.writeFile(path.join(diagnostics, 'native-editor-integration.json'), JSON.stringify(report, null, 2));
  } catch (failure) { report.cleanupError = failure.message; await fs.writeFile(path.join(diagnostics, 'native-editor-integration.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ ok, error: report.error?.message, assertions: report.assertions }));
  holdingQuit = false;
  app.quit();
  setTimeout(() => app.exit(ok ? 0 : 1), 1500).unref();
}
async function makeProject() {
  await until(() => window.webContents.executeJavaScript(`!![...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Code'&&e.offsetWidth)`), 'Code tab');
  await window.webContents.executeJavaScript(` [...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Code'&&e.offsetWidth).click()`);
  await until(() => window.webContents.executeJavaScript(`!![...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('快速出码')&&e.offsetWidth)`), 'Quick code action');
  await window.webContents.executeJavaScript(` [...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('快速出码')&&e.offsetWidth).click()`);
  return until(() => {
    const state = window.originalEditor?.status();
    return state?.ready && state.visible && state.workspace.startsWith(process.env.M0_LOCAL_DATA_DIR + path.sep) ? state : null;
  }, 'Visible original KSCode', 45000);
}
app.on('browser-window-created', (_event, created) => {
  if (started) return;
  started = true;
  window = created;
  window.webContents.once('did-finish-load', async () => {
    try {
      const first = await makeProject();
      const manager = window.originalEditor;
      const firstView = manager.view;
      const firstContents = firstView.webContents;
      report.steps.push({ name: 'first-project-ready', status: first });
      report.assertions.originalViewAttached = window.contentView.children.includes(firstView);
      report.assertions.hostPresent = await window.webContents.executeJavaScript(`!!document.querySelector('[data-m0-native-editor-host]')`);
      const readme = path.join(first.workspace, 'README.md');
      const original = await fs.readFile(readme, 'utf8');
      const marker = '\nNative KSCode integration saved this text.\n';
      await until(() => firstContents.executeJavaScript(`!!document.querySelector('.monaco-editor textarea.inputarea')`), 'Original Monaco textarea');
      await typeIntoOriginal(firstContents,readme,marker);
      await manager.flush();
      await until(async () => (await fs.readFile(readme, 'utf8')).includes(marker.trim()), 'Original editor disk save');
      report.assertions.originalMonacoEdited = true;
      report.assertions.fileSavedOnDisk = true;
      const [width, height] = window.getSize();
      window.setSize(width - 120, height - 80);
      await delay(700);
      const resized = manager.status().bounds;
      report.assertions.boundsUpdated = resized && resized.width > 100 && resized.height > 100;
      await window.webContents.executeJavaScript(`document.querySelector('[data-m0-editor-action="preview"]').click()`);
      await until(() => !manager.visible, 'Native editor hidden for preview');
      report.assertions.previewHidesNativeEditor = await window.webContents.executeJavaScript(`!!document.querySelector('[data-m0-preview-frame][sandbox="allow-scripts"]')`);
      await window.webContents.executeJavaScript(`document.querySelector('[data-m0-editor-action="code"]').click()`);
      await until(() => manager.visible && manager.ready, 'Native editor restored after preview');
      report.assertions.codeRestoresNativeEditor = true;
      await window.webContents.executeJavaScript(`(() => { const modal=document.createElement('div');modal.id='native-editor-test-modal';modal.setAttribute('role','dialog');modal.style.cssText='position:fixed;left:100px;top:100px;width:120px;height:120px;background:white;z-index:99999';document.body.appendChild(modal); })()`);
      await until(() => !manager.visible, 'Native editor hidden under modal');
      report.assertions.modalHidesNativeEditor = true;
      await window.webContents.executeJavaScript(`document.getElementById('native-editor-test-modal').remove()`);
      await until(() => manager.visible, 'Native editor restored after modal');
      await window.webContents.executeJavaScript(`document.querySelector('a[href="/__local/settings"]').click()`,true);
      await until(() => window.webContents.getURL().includes('/__local/settings') && !manager.visible && !manager.view?.getVisible(), 'Local settings navigation hides editor');
      report.steps.push({ name: 'settings-page', url: window.webContents.getURL(), status: manager.status() });
      report.assertions.hiddenOnPageLeave = !manager.visible && !manager.view?.getVisible();
      await window.loadURL(`http://127.0.0.1:${process.env.M0_LOCAL_PORT}/home`);
      const previousProject = first.projectId;
      const second = await makeProject();
      report.steps.push({ name: 'second-project-ready', status: second });
      report.assertions.projectChanged = second.projectId !== previousProject && second.workspace !== first.workspace;
      report.assertions.previousViewDestroyed = firstContents.isDestroyed();
      report.assertions.previousFileRetained = (await fs.readFile(readme, 'utf8')).includes(marker.trim());
      report.assertions.newWorkspaceIsolated = !(await fs.readFile(path.join(second.workspace, 'README.md'), 'utf8')).includes(marker.trim());
      await fs.mkdir(diagnostics, { recursive: true });
      await fs.writeFile(path.join(diagnostics, 'native-editor-integrated-window.png'), (await window.capturePage()).toPNG());
      await fs.writeFile(path.join(diagnostics, 'native-editor-integrated-content.png'), (await manager.view.webContents.capturePage()).toPNG());
      const secondFile = path.join(second.workspace, 'README.md');
      const secondText = await fs.readFile(secondFile, 'utf8');
      const closingMarker = '\nSaved by the close lifecycle before the autosave delay.\n';
      const secondContents = manager.view.webContents;
      // Disable delay-based autosave in this isolated test: closing must flush
      // both an inactive dirty split and the active editor group.
      const initialGroup = await secondContents.executeJavaScript(`(async()=>{const d=window.devtoolsExport;await d.O.updateValue('files.autoSave','off');return d.R.activeGroup.id;})()`);
      const splitFile = path.join(second.workspace, 'split-save.txt');
      const splitMarker = '\nSaved from the inactive original split group.\n';
      await fs.writeFile(splitFile, 'Isolated split save fixture.\n');
      await secondContents.executeJavaScript(`(()=>{const s=window.devtoolsExport.R,g=s.addGroup(s.activeGroup,3);s.activateGroup(g);return g.id;})()`);
      await manager.call('openEditor',{filePath:splitFile,workspace:second.workspace});
      await until(()=>secondContents.executeJavaScript(`window.devtoolsExport.$.listCodeEditors().some(e=>e.getModel()?.uri.path===${JSON.stringify(splitFile)})`),'Split editor opened');
      await typeIntoOriginal(secondContents,splitFile,splitMarker);
      await secondContents.executeJavaScript(`(()=>{window.devtoolsExport.R.activateGroup(${JSON.stringify(initialGroup)});return true;})()`);
      await typeIntoOriginal(secondContents,secondFile,closingMarker);
      report.assertions.inactiveSplitDirtyBeforeClose = await secondContents.executeJavaScript(`(()=>{const s=window.devtoolsExport.R;return s.groups.some(g=>g.id!==s.activeGroup.id&&g.editors.some(i=>i.isDirty?.()));})()`);
      holdingQuit = true;
      const closed = new Promise(resolve => window.once('closed', resolve));
      window.close();
      await Promise.race([closed, until(()=>{if(report.dialogError)throw new Error(report.dialogError.message);return window.isDestroyed();},'Window close after saving all groups',15000)]);
      report.assertions.immediateCloseSaved = (await fs.readFile(secondFile, 'utf8')).includes(closingMarker.trim());
      report.assertions.inactiveSplitSaved = (await fs.readFile(splitFile,'utf8')).includes(splitMarker.trim());
      if (!Object.values(report.assertions).every(Boolean)) throw new Error('A native editor integration assertion failed');
      await finish(true);
    } catch (error) { await finish(false, error); }
  });
});
require('../desktop/main.cjs');
