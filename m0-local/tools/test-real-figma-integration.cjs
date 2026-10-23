'use strict';
// Real desktop host and recovered M0 shell. Plugin execution uses an explicitly
// named Plugin API fixture, never an authenticated Figma account.
const {app}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=4361,origin='http://127.0.0.1:'+port;
process.env.M0_LOCAL_PROFILE='real-figma-integration';process.env.M0_LOCAL_PORT=String(port);
process.env.M0_LOCAL_DATA_DIR=path.join(root,'.local-data/real-figma-integration');process.env.M0_LOCAL_WORKSPACE=path.join(process.env.M0_LOCAL_DATA_DIR,'workspace');delete process.env.M0_LOCAL_URL;
const report={mode:'real-website-desktop-and-plugin-api-fixture',assertions:{},steps:[]};let win,finishing=false,pump,ui,plugin;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(150);}throw Error(label+' timed out');}
const watchdog=setTimeout(()=>finish(false,Error('Real Figma integration exceeded 180 seconds')),180000);
const request=async(route,body,method=body?'POST':'GET')=>{const response=await fetch(origin+route,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;};
const main=code=>win.webContents.executeJavaScript(code,true);
const frame=code=>main(`document.querySelector('[data-m0-figma-workspace-frame]').contentWindow.eval(${JSON.stringify(code)})`);
async function screenshot(name){await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics',name+'.png'),(await win.capturePage()).toPNG());}
async function finish(ok,error){if(finishing)return;finishing=true;clearTimeout(watchdog);clearInterval(pump);report.ok=ok;if(error)report.error={message:error.message,stack:error.stack};try{report.url=win?.webContents.getURL();report.host=win?.figmaHost?.status();report.text=await main('document.body.innerText.slice(-12000)');report.frames=await main('[...document.querySelectorAll("iframe")].map(f=>({src:f.src,width:f.offsetWidth,height:f.offsetHeight}))');if(win&&!win.isDestroyed())await screenshot('real-figma-final');const remote=win?.figmaHost?.view?.webContents;if(remote&&!remote.isDestroyed()){report.remoteDOM=await remote.executeJavaScript('({readyState:document.readyState,html:document.documentElement.outerHTML.slice(0,12000),text:document.body.innerText.slice(0,5000)})');await fs.writeFile(path.join(root,'diagnostics/real-figma-remote.png'),(await remote.capturePage()).toPNG());}}catch{}await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics/real-figma-integration.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok,assertions:report.assertions,error:report.error?.message}));app.once('will-quit',event=>{event.preventDefault();app.exit(ok?0:1);});app.quit();setTimeout(()=>app.exit(ok?0:1),2000).unref();}
app.once('browser-window-created',(_event,created)=>{win=created;win.webContents.once('did-finish-load',async()=>{try{
  const project=await request('/api/project/v2/create',{projectName:'真实 Figma 接线验收',mode:'design'}),session=await request('/api/session/v2/create',{projectId:project.id});report.projectId=project.id;
  await win.loadURL(origin+'/aicode-v2?id='+project.id+'&mode=spark&autoOpenFigma=true&sessionId='+session.sessionId);
  await until(()=>main(`!!document.querySelector('[data-m0-figma-workspace-frame]')`),'Original Design workspace');
  await main(`[...document.querySelectorAll('button,[role="tab"],[role="button"],div,span')].find(e=>e.innerText?.trim()==='设计'&&e.offsetWidth)?.click()`);
  console.log('Step: original Design selected');
  await until(()=>frame(`!!window.m0FigmaWorkspace&&window.m0FigmaWorkspace.getStatus().native`),'Native Figma capability');
  await until(()=>win.figmaHost?.view&&!win.figmaHost.view.webContents.isLoadingMainFrame(),'Official Figma load',60000);
  const host=win.figmaHost,remote=host.view.webContents;report.remoteURL=remote.getURL();report.remoteTitle=remote.getTitle();report.remoteText=await until(()=>remote.executeJavaScript('document.body.innerText.length>50?document.body.innerText.slice(0,2000):null'),'Official Figma rendered login',30000);
  console.log('Step: official Figma loaded '+report.remoteURL);
  report.assertions.realOfficialWebsite=/^https:\/\/(www\.)?figma\.com\//.test(report.remoteURL)&&report.remoteText.length>50;
  const prefs=remote.getLastWebPreferences();report.assertions.remoteIsolated=prefs.nodeIntegration===false&&prefs.contextIsolation===true&&prefs.sandbox===true&&!prefs.preload;
  report.assertions.noBridgeInRemote=await remote.executeJavaScript(`typeof window.m0LocalDesktop==='undefined'&&typeof require==='undefined'`);
  report.assertions.nativeBounds=host.visible&&host.status().bounds.width>200&&host.status().bounds.height>200;
  await fs.writeFile(path.join(root,'diagnostics/real-figma-login-native.png'),(await remote.capturePage()).toPNG());
  await screenshot('real-figma-official-site');
  await frame(`document.getElementById('connect-bridge').click()`);
  await until(()=>frame(`document.getElementById('pair-dialog').open`),'Bridge pairing dialog');report.assertions.modalHidesRemote=host.visible===false;
  await frame(`document.getElementById('create-pair').click()`);const code=await until(()=>frame(`/^[A-F0-9]{12}$/.test(document.getElementById('pair-code').textContent)?document.getElementById('pair-code').textContent:null`),'Pairing code');
  const metadata=await request('/__local/figma/metadata?projectId='+project.id);report.assertions.materializedPlugin=JSON.parse(await fs.readFile(metadata.manifestPath,'utf8')).networkAccess.allowedDomains.includes(origin);
  const harness=await import('../figma-plugin-bridge/test-harness.mjs');plugin=harness.createPluginHarness();ui=await harness.createPluginUiHarness({plugin,baseUrl:origin});await ui.pair(code);let busy=false;pump=setInterval(async()=>{if(busy)return;busy=true;try{await ui.tick()}catch(error){report.pumpError=error.message}finally{busy=false}},80);
  await frame(`document.getElementById('pair-dialog').close()`);
  await until(()=>host.visible,'Login page resumes after pairing dialog');report.assertions.loginResumesAfterModal=true;
  // The synthetic file binding is explicitly scoped to this isolated test.
  // Host navigation must use the real URL; its access/error state is not a fake canvas.
  await request('/__local/figma/workspace?projectId='+project.id,{url:'https://www.figma.com/design/'+plugin.figma.fileKey+'/Fixture'},'PUT');
  await frame(`document.getElementById('file-url').value='https://www.figma.com/design/${plugin.figma.fileKey}/Fixture';document.getElementById('open-form').requestSubmit()`);
  await until(()=>frame(`window.m0FigmaWorkspace.getStatus().online`),'Plugin fixture selected in original UI');
  report.assertions.realSelectionContext=await main(`window.__M0_FIGMA_CONTEXT__?.fileKey===${JSON.stringify(plugin.figma.fileKey)}&&window.__M0_FIGMA_CONTEXT__.targetNodeIds.includes('1:1')`);
  await frame(`document.getElementById('edit-selection').click()`);await until(()=>frame(`document.getElementById('edit-dialog').open`),'Selection dialog');
  await frame(`document.getElementById('text-value').value='M0 UI → Bridge → Plugin fixture';document.getElementById('apply-text').click()`);await until(()=>plugin.text.characters==='M0 UI → Bridge → Plugin fixture','Actual Plugin text mutation');
  await until(()=>frame(`!window.m0FigmaWorkspace.getStatus().commandBusy`),'Native receipt');report.assertions.manualMutationAcknowledged=await frame(`document.getElementById('command-result').textContent.includes('"ok": true')`);
  await frame(`document.getElementById('width-value').value='280';document.getElementById('height-value').value='90';document.getElementById('apply-size').click()`);await until(()=>plugin.text.width===280,'Second native resize');await until(()=>frame(`!window.m0FigmaWorkspace.getStatus().commandBusy`),'Resize receipt');report.assertions.secondMutationUsesOwnReceipt=plugin.undos===2;
  await frame(`document.getElementById('export-svg').click()`);await until(()=>frame(`!document.getElementById('download-result').hidden&&document.getElementById('command-result').textContent.includes('<svg')`),'Native SVG export');report.assertions.realPluginExport=true;
  await screenshot('real-figma-bridge-receipt');await frame(`document.getElementById('edit-dialog').close()`);
  await frame(`document.getElementById('generate-krn').click()`);await until(()=>frame(`document.getElementById('command-result').textContent.includes('generated/figma-')`),'Original KRN conversion');report.assertions.originalKrnFromPluginSchema=true;await frame(`document.getElementById('edit-dialog').close()`);
  const chat=await fetch(origin+'/api/agent/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,projectId:project.id,humanMessage:'Figma 接线验收：保留原会话'})}).then(r=>r.text());report.assertions.agentChatPreserved=chat.includes('本地界面演示')&&chat.includes('RUN_FINISHED');
  await main(`[...document.querySelectorAll('button,[role="tab"],[role="button"],div,span')].find(e=>e.innerText?.trim()==='代码'&&e.offsetWidth)?.click()`);await until(()=>!host.visible,'Code tab hides remote Design');
  await until(()=>win.originalEditor.ready&&win.originalEditor.visible,'Recovered original editor',45000);report.assertions.originalEditorPreserved=true;report.assertions.exclusiveSurfaces=!host.visible;
  const terminal=await win.originalEditor.openTerminal();report.terminal=terminal.terminal;
  await win.originalEditor.view.webContents.executeJavaScript(`window.devtoolsExport.sendTerminalCommand(${terminal.terminal.id},"pwd; echo FIGMA_SWITCH_TERMINAL_OK")`);
  const terminalText=await until(async()=>{const text=await win.originalEditor.view.webContents.executeJavaScript(`window.devtoolsExport.getTerminalContent(${terminal.terminal.id},120)`);report.terminalText=text;return text.includes('FIGMA_SWITCH_TERMINAL_OK')&&text.replace(/\s/g,'').includes(terminal.workspace.replace(/\s/g,''))?text:null},'Recovered real pty output');report.assertions.originalTerminalPreserved=terminalText.replace(/\s/g,'').includes(terminal.workspace.replace(/\s/g,''));
  if(!Object.values(report.assertions).every(Boolean))throw Error('A Figma desktop integration assertion failed');await finish(true);
}catch(error){await finish(false,error);}});});
require('../desktop/main.cjs');
