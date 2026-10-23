'use strict';
// A real original workbench, pty host, and extension host; all test data is local.
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.env.M0_LOCAL_PROFILE = 'native-editor-terminal';
process.env.M0_LOCAL_PORT = '4348';
process.env.M0_LOCAL_DATA_DIR = path.join(root, '.local-data/native-editor-terminal-backend');
process.env.M0_LOCAL_WORKSPACE = path.join(process.env.M0_LOCAL_DATA_DIR, 'workspace');
delete process.env.M0_LOCAL_URL;
const diagnostics = path.join(root, 'diagnostics');
const report = { mode: 'original-kscode-terminal-extensions', assertions: {}, steps: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, duration = 30000) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await delay(200); }
  throw new Error(`${label} timed out`);
}
let window, finishing = false;
const watchdog = setTimeout(() => finish(false, new Error('Terminal/extension test exceeded 150 seconds')), 150000);
async function finish(ok, error) {
  if (finishing) return; finishing = true; clearTimeout(watchdog);
  report.ok = ok;
  if (error) report.error = { message: error.message, stack: error.stack };
  const manager = window?.originalEditor;
  if (manager) {
    report.status = manager.status(); report.runtime = manager.diagnostics;
    try { report.processAudit = (await fs.readFile(path.join(manager.sandbox, 'process-audit.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse); } catch {}
    if (manager.view && !manager.view.webContents.isDestroyed()) {
      report.dom = await manager.view.webContents.executeJavaScript('document.body.innerText.slice(-16000)');
      await fs.writeFile(path.join(diagnostics, 'native-editor-extensions-content.png'), (await manager.view.webContents.capturePage()).toPNG());
    }
    manager.dispose();
    const pids = [...new Set([manager.worker?.pid, report.terminal?.terminal?.processId, ...(report.processAudit || []).filter(e=>e.operation==='started').map(e=>e.pid)].filter(Boolean))];
    try {
      await until(()=>pids.every(pid=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}}),'Helper processes cleanup',10000);
      report.assertions.helperAndShellProcessesStopped=true;
    } catch (failure) { report.assertions.helperAndShellProcessesStopped=false; report.cleanupError=failure.message; report.ok=ok=false; }
  }
  await fs.mkdir(diagnostics, { recursive: true });
  await fs.writeFile(path.join(diagnostics, 'native-editor-terminal.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok, assertions: report.assertions, error: report.error?.message }));
  app.quit(); setTimeout(() => app.exit(ok ? 0 : 1), 1500).unref();
}
async function buildVSIX(sandbox) {
  const directory=path.join(sandbox,'vsix-fixture');
  await fs.mkdir(path.join(directory,'extension'),{recursive:true});
  const manifest={name:'vsix-probe',publisher:'m0-local',version:'0.0.1',displayName:'Local VSIX Probe',engines:{vscode:'^1.83.0'},main:'./extension.js',activationEvents:['*'],extensionKind:['workspace'],contributes:{languages:[{id:'m0-proof',extensions:['.m0proof'],aliases:['Local VSIX Proof']}]}};
  await fs.writeFile(path.join(directory,'extension/package.json'),JSON.stringify(manifest));
  await fs.writeFile(path.join(directory,'extension/extension.js'),`const v=require('vscode'),fs=require('fs'),path=require('path');exports.activate=c=>{fs.writeFileSync(path.join(v.workspace.workspaceFolders[0].uri.fsPath,'vsix-activated.txt'),JSON.stringify({pid:process.pid,extensionPath:c.extensionPath}));c.subscriptions.push(v.languages.registerCompletionItemProvider('m0-proof',{provideCompletionItems(){return [new v.CompletionItem('originalVSIXWorks',v.CompletionItemKind.Keyword)]}}));};`);
  await fs.writeFile(path.join(directory,'[Content_Types].xml'),'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>');
  await fs.writeFile(path.join(directory,'extension.vsixmanifest'),'<?xml version="1.0"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="vsix-probe" Version="0.0.1" Publisher="m0-local"/><DisplayName>Local VSIX Probe</DisplayName><Description xml:space="preserve">Isolated native editor integration test</Description><Tags></Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.83.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>');
  const vsix=path.join(sandbox,'m0-local.vsix-probe-0.0.1.vsix');
  await fs.rm(vsix,{force:true});
  execFileSync('/usr/bin/zip',['-q','-r',vsix,'.'],{cwd:directory});return vsix;
}
app.once('browser-window-created', (_event, created) => {
  window = created;
  window.webContents.once('did-finish-load', async () => {
    try {
      const manager = window.originalEditor;
      await fs.rm(manager.sandbox, { recursive: true, force: true });
      await until(() => window.webContents.executeJavaScript(`!![...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Code'&&e.offsetWidth)`), 'Code tab');
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Code'&&e.offsetWidth).click()`);
      await until(() => window.webContents.executeJavaScript(`!![...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('快速出码')&&e.offsetWidth)`), 'Quick code');
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('快速出码')&&e.offsetWidth).click()`);
      await until(() => manager.ready && manager.visible && manager.context?.workspace, 'Original editor', 45000);
      report.workspace = manager.context.workspace;
      report.devtoolsKeys = await manager.view.webContents.executeJavaScript(`({keys:Object.keys(window.devtoolsExport),pane:typeof window.devtoolsExport.W?.openPaneComposite,install:typeof window.devtoolsExport.Y?.install,terminal:typeof window.devtoolsExport.createTerminal,extensions:window.devtoolsExport.Y?.local?.map(e=>({id:e.identifier.id,location:e.local?.location?.toString()}))})`);
      report.settings=await manager.view.webContents.executeJavaScript(`(()=>{const c=window.devtoolsExport.O,k=c.keys();return {keysShape:Object.keys(k),defaultCount:k.default?.length,knownProfiles:k.default?.includes('terminal.integrated.profiles.osx'),profiles:c.getValue('terminal.integrated.profiles.osx'),defaultProfile:c.getValue('terminal.integrated.defaultProfile.osx')};})()`);
      await window.webContents.executeJavaScript(`document.querySelector('[data-m0-native-editor-action="openTerminal"]').click()`);
      const metadata = await until(async()=>{const terminals=await manager.view.webContents.executeJavaScript(`window.devtoolsExport.getAllTerminals()`);return terminals.find(t=>Number.isInteger(t.processId)&&t.processId>0);},'Toolbar creates real terminal');
      const terminal={success:true,terminal:metadata,workspace:report.workspace}; report.terminal=terminal;
      report.assertions.terminalToolbarWorks=true;
      report.shellProfile=await manager.view.webContents.executeJavaScript(`(()=>{const t=window.devtoolsExport.gb.instances.find(t=>t.instanceId===${metadata.id});const c=t.shellLaunchConfig;return {executable:c.executable,args:c.args,cwd:typeof c.cwd==='string'?c.cwd:c.cwd?.path,zdotdir:c.env?.ZDOTDIR};})()`);
      report.assertions.shellSkipsUserDotfiles=report.shellProfile.executable==='/bin/zsh'&&report.shellProfile.args?.includes('-f')&&report.shellProfile.zdotdir===path.join(manager.sandbox,'shell');
      report.assertions.realTerminalCreated = Number.isInteger(terminal.terminal.processId) && terminal.terminal.processId > 0;
      await manager.view.webContents.executeJavaScript(`window.devtoolsExport.sendTerminalCommand(${terminal.terminal.id},${JSON.stringify("pwd; printf '%s\\n' M0_REAL_PTY_OK")})`);
      report.terminalContent = await until(async () => {
        const text = await manager.view.webContents.executeJavaScript(`window.devtoolsExport.getTerminalContent(${terminal.terminal.id},120)`);
        return text.includes('M0_REAL_PTY_OK') && text.includes(report.workspace) ? text : null;
      }, 'Real pty command output');
      report.assertions.terminalCwdCorrect = report.terminalContent.includes(report.workspace);
      report.assertions.terminalPrintfVisible = report.terminalContent.includes('M0_REAL_PTY_OK');
      await fs.mkdir(diagnostics, { recursive: true });
      await fs.writeFile(path.join(diagnostics, 'native-editor-terminal-content.png'), (await manager.view.webContents.capturePage()).toPNG());
      const jsonFile=path.join(report.workspace,'native-probe.json');
      await fs.writeFile(jsonFile,'{\n  ""\n}\n');
      await manager.call('openEditor',{filePath:jsonFile,workspace:report.workspace});
      await manager.view.webContents.executeJavaScript(`window.devtoolsExport.O.updateValue('json.schemas',[{fileMatch:['/native-probe.json'],schema:{type:'object',properties:{nativeEnabled:{type:'boolean'},nativeTitle:{type:'string'}}}}])`);
      report.completion = await until(async()=>manager.view.webContents.executeJavaScript(`(async()=>{const d=window.devtoolsExport;const model=d.$.listCodeEditors().map(e=>e.getModel()).find(m=>m?.uri.path.endsWith('/native-probe.json'));if(!model)return null;const providers=d.bb.completionProvider.ordered(model);let labels=[];for(const provider of providers){try{const result=await provider.provideCompletionItems(model,{lineNumber:2,column:4},{triggerKind:0},{isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})});labels.push(...(result?.suggestions||[]).map(i=>typeof i.label==='string'?i.label:i.label.label));}catch{}}return labels.includes('nativeEnabled')?{labels,languageId:model.getLanguageId(),providers:providers.map(p=>p._debugDisplayName||p.constructor.name)}:null;})()`),'Real built-in JSON completion',20000);
      report.assertions.builtinJsonCompletions = report.completion.labels.includes('nativeEnabled');
      const audit=(await fs.readFile(path.join(manager.sandbox,'process-audit.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
      report.assertions.extensionHostRunning = audit.some(e=>e.role==='vs/workbench/api/node/extensionHostProcess'&&e.operation==='started');
      report.assertions.builtinJsonActivated = audit.some(e=>e.operation.includes('jsonServerMain'));
      const watchFile=path.join(report.workspace,'watcher-proof.txt');
      await fs.writeFile(watchFile,'before native watcher\n');
      await manager.call('openEditor',{filePath:watchFile,workspace:report.workspace});
      await delay(800);
      await fs.writeFile(watchFile,'after native watcher\n');
      report.assertions.watcherReloadsExternalEdit=!!await until(()=>manager.view.webContents.executeJavaScript(`window.devtoolsExport.$.listCodeEditors().some(e=>e.getModel()?.uri.path.endsWith('/watcher-proof.txt')&&e.getModel()?.getValue().includes('after native watcher'))`),'Original watcher reload');
      const vsix=await buildVSIX(manager.sandbox);
      const install=manager.installVSIX.bind(manager);
      manager.installVSIX=async file=>(report.vsixInstall=await install(file));
      // Only the OS picker is stubbed; the production preload, IPC, original
      // archive installer, disk extraction and original host activation all run.
      require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[vsix]});
      await window.webContents.executeJavaScript(`document.querySelector('[data-m0-native-editor-action="installVSIX"]').click()`);
      report.vsixActivation=await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(report.workspace,'vsix-activated.txt'),'utf8'));}catch{return null;}},'Installed VSIX activation',20000);
      report.assertions.vsixInstalledAndActivated=report.vsixInstall.success&&report.vsixActivation.pid>0;
      const proofFile=path.join(report.workspace,'native.m0proof');await fs.writeFile(proofFile,'');
      await manager.call('openEditor',{filePath:proofFile,workspace:report.workspace});
      report.assertions.vsixCompletionProviderWorks=!!await until(()=>manager.view.webContents.executeJavaScript(`(async()=>{const d=window.devtoolsExport,m=d.$.listCodeEditors().map(e=>e.getModel()).find(m=>m?.uri.path.endsWith('/native.m0proof'));if(!m)return false;for(const p of d.bb.completionProvider.ordered(m)){const r=await p.provideCompletionItems(m,{lineNumber:1,column:1},{triggerKind:0},{isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})});if(r?.suggestions?.some(i=>i.label==='originalVSIXWorks'))return true;}return false;})()`),'VSIX completion provider');
      await window.webContents.executeJavaScript(`document.querySelector('[data-m0-native-editor-action="showExtensions"]').click()`);
      report.assertions.extensionsPanelOpened = await until(() => manager.view.webContents.executeJavaScript(`!!document.querySelector('.extensions-viewlet')`), 'Extensions panel');
      if (!Object.values(report.assertions).every(Boolean)) throw new Error('Terminal/extension assertion failed');
      await finish(true);
    } catch (error) { await finish(false, error); }
  });
});
require('../desktop/main.cjs');
