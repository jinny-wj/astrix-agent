'use strict';
const {app}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
process.env.M0_LOCAL_PROFILE='native-editor-marketplace';
process.env.M0_LOCAL_PORT='4354';
process.env.M0_LOCAL_DATA_DIR=path.join(root,'.local-data/native-marketplace-backend');
process.env.M0_LOCAL_WORKSPACE=path.join(process.env.M0_LOCAL_DATA_DIR,'workspace');
delete process.env.M0_LOCAL_URL;
const report={mode:'original-editor-open-vsx-live',assertions:{},steps:[],sources:['https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code','https://www.eclipse.org/legal/open-vsx-registry-faq/','https://open-vsx.org/api/dracula-theme/theme-dracula']};
const diagnostics=path.join(root,'diagnostics');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,ms=30000){const deadline=Date.now()+ms;while(Date.now()<deadline){const value=await fn();if(value)return value;await delay(250);}throw new Error(`${label} timed out`);}
let window,finishing=false;
const watchdog=setTimeout(()=>finish(false,new Error('Live marketplace test exceeded 180 seconds')),180000);
async function finish(ok,error){
  if(finishing)return;finishing=true;clearTimeout(watchdog);report.ok=ok;
  if(error)report.error={message:error.message,stack:error.stack};
  const manager=window?.originalEditor;
  if(manager){report.status=manager.status();report.runtime=manager.diagnostics;if(manager.view&&!manager.view.webContents.isDestroyed()){report.dom=await manager.view.webContents.executeJavaScript('document.body.innerText.slice(-16000)');await fs.mkdir(diagnostics,{recursive:true});await fs.writeFile(path.join(diagnostics,'native-editor-marketplace.png'),(await manager.view.webContents.capturePage()).toPNG());}manager.dispose();}
  await fs.mkdir(diagnostics,{recursive:true});await fs.writeFile(path.join(diagnostics,'native-editor-marketplace.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok,assertions:report.assertions,error:report.error?.message}));app.quit();setTimeout(()=>app.exit(ok?0:1),2000).unref();
}
app.once('browser-window-created',(_event,created)=>{
 window=created;window.webContents.once('did-finish-load',async()=>{try{
  const manager=window.originalEditor;await fs.rm(manager.sandbox,{recursive:true,force:true});
  await until(()=>window.webContents.executeJavaScript(`!![...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Code'&&e.offsetWidth)`),'Code tab');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Code'&&e.offsetWidth).click()`);
  await until(()=>window.webContents.executeJavaScript(`!![...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('快速出码')&&e.offsetWidth)`),'Quick code');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('快速出码')&&e.offsetWidth).click()`);
  await until(()=>manager.ready&&manager.visible&&manager.context?.workspace,'Original editor',45000);
  report.marketplace=await manager.marketplaceStatus();report.assertions.publicRegistryOnline=report.marketplace.online===true;
  const contents=manager.view.webContents;
  report.metadata=await(await fetch('https://open-vsx.org/api/dracula-theme/theme-dracula')).json();
  report.assertions.licenseAndEngineChecked=report.metadata.license==='MIT'&&report.metadata.engines.vscode==='^1.13.0';
  await manager.showExtensions();
  report.search=await contents.executeJavaScript(`(async()=>{const d=window.devtoolsExport;const pager=await d.Y.queryGallery({text:'@id:dracula-theme.theme-dracula',pageSize:10},{isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})});window.__m0MarketExtension=pager.firstPage.find(e=>e.identifier.id==='dracula-theme.theme-dracula');return {total:pager.total,items:pager.firstPage.map(e=>({id:e.identifier.id,name:e.displayName,version:e.version})),methods:{open:typeof d.Y.open,installVersion:typeof d.Y.installVersion}};})()`);
  report.assertions.originalGallerySearch=report.search.items.some(e=>e.id==='dracula-theme.theme-dracula');
  report.searchUI=await contents.executeJavaScript(`(async()=>{const p=await window.devtoolsExport.W.openPaneComposite('workbench.view.extensions',0,true),c=p.getViewPaneContainer();if(typeof c.search==='function'){c.search('@id:dracula-theme.theme-dracula');return true;}return false;})()`);
  report.assertions.originalSearchUI=!!await until(()=>contents.executeJavaScript(`document.body.innerText.includes('Dracula Theme Official')`),'Visible original gallery result');
  await contents.executeJavaScript(`window.devtoolsExport.Y.open(window.__m0MarketExtension).then(()=>undefined)`);
  report.assertions.originalDetailsUI=!!await until(()=>contents.executeJavaScript(`!!document.querySelector('.extension-editor')`),'Original extension detail');
  report.readme=await contents.executeJavaScript(`window.__m0MarketExtension.getReadme()`);
  report.assertions.originalReadmeDownload=report.readme.includes('Dracula');
  report.installedOlder=await contents.executeJavaScript(`(async()=>{window.__m0MarketInstalled=await window.devtoolsExport.Y.installVersion(window.__m0MarketExtension,'2.24.2');const e=window.__m0MarketInstalled;return {id:e.identifier.id,version:e.local.manifest.version,location:e.local.location.toString()};})()`);
  report.assertions.originalDownloadAndInstall=report.installedOlder.version==='2.24.2';
  report.upgraded=await contents.executeJavaScript(`(async()=>{window.__m0MarketInstalled=await window.devtoolsExport.Y.installVersion(window.__m0MarketInstalled,${JSON.stringify(report.metadata.version)});const e=window.__m0MarketInstalled;return {id:e.identifier.id,version:e.local.manifest.version,location:e.local.location.toString()};})()`);
  report.assertions.originalUpgrade=report.upgraded.version===report.metadata.version;
  report.themes=await contents.executeJavaScript(`window.devtoolsExport.fb.getColorThemes().then(themes=>themes.map(t=>({id:t.id,settingsId:t.settingsId,label:t.label})))`);
  const dracula=report.themes.find(t=>t.settingsId==='Dracula');
  await contents.executeJavaScript(`window.devtoolsExport.setColorTheme(${JSON.stringify(dracula.id)})`);
  report.theme=await contents.executeJavaScript(`({settings:window.devtoolsExport.O.getValue('workbench.colorTheme'),current:window.devtoolsExport.fb.getColorTheme().settingsId,background:getComputedStyle(document.querySelector('.monaco-workbench')).backgroundColor})`);
  report.assertions.originalThemeApplied=report.theme.current==='Dracula';
  await fs.writeFile(path.join(diagnostics,'native-editor-marketplace-theme.png'),(await contents.capturePage()).toPNG());
  const light=report.themes.find(t=>t.settingsId==='Default Light Modern');
  if(light)await contents.executeJavaScript(`window.devtoolsExport.setColorTheme(${JSON.stringify(light.id)})`);
  await contents.executeJavaScript(`window.devtoolsExport.Y.uninstall(window.__m0MarketInstalled)`);
  report.assertions.originalUninstall=!!await until(()=>contents.executeJavaScript(`!window.devtoolsExport.Y.local.some(e=>e.identifier.id==='dracula-theme.theme-dracula')`),'Uninstalled from original service');
  report.assertions.childrenStillNoMarketplace=!(await fs.readFile(path.join(manager.sandbox,'process-audit.jsonl'),'utf8')).includes('market:request:');
  if(!Object.values(report.assertions).every(Boolean))throw new Error('A live marketplace assertion failed');
  await finish(true);
 }catch(error){await finish(false,error);}});
});
require('../desktop/main.cjs');
