'use strict';
const {getLayout}=require('../../../packages/astrix-workbench/layout.cjs');
const layout=getLayout();
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),report={ok:false,checks:[],errors:[]};
let directory,server,window,origin;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=source=>window.webContents.executeJavaScript(source,true);
async function until(source,label){const end=Date.now()+10000;while(Date.now()<end){if(await evaluate(source))return;await sleep(40);}throw Error('Timeout: '+label);}
async function click(selector){const bounds=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing control');const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mouseDown','mouseUp'])window.webContents.sendInputEvent({type,button:'left',clickCount:1,x:Math.round(bounds.x),y:Math.round(bounds.y)});await sleep(70);}
async function request(route,body){const response=await fetch(origin+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;}
app.setPath('userData',path.join(os.tmpdir(),'m0-prototype-browser-'+process.pid));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-prototype-ui-'));
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));origin='http://127.0.0.1:'+port;
  server=spawn(process.execPath,[path.join(layout.webRoot,'server/index.mjs')],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',M0_LOCAL_PORT:String(port),M0_LOCAL_DATA_DIR:path.join(directory,'data'),M0_LOCAL_WORKSPACE:path.join(directory,'workspace')},stdio:'ignore'});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/__local/health')).ok){ready=true;break;}}catch{}await sleep(50);}assert.ok(ready,'isolated server started');
  const model=await import(path.join(layout.webRoot,'canvas/model.mjs'));
  const document=model.emptyDocument('离线交互原型'),page=model.getActivePage(document),first=model.createNode('frame');first.id='start';first.name='首页';first.height=480;
  const button=model.createNode('rectangle',40,100);button.id='next';button.name='打开详情';button.width=220;button.height=64;button.fill='#7c5cff';button.prototype={trigger:'click',targetId:'detail'};
  const label=model.createNode('text',52,115);label.text='点击进入详情';label.fill='#ffffff';label.prototype={trigger:'click',targetId:'detail'};first.children=[button,label];page.nodes=[first];
  const next=model.createPage('详情页'),second=model.createNode('frame');second.id='detail';second.name='详情';second.fill='#e9e5ff';second.height=480;const text=model.createNode('text',30,55);text.text='跨页面原型跳转成功';second.children=[text];next.nodes=[second];document.pages.push(next);
  const project=await request('/api/project/v2/create',{projectName:'Prototype UI Check',mode:'design'});
  const saved=await fetch(origin+'/__local/canvas?projectId='+project.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({document,expectedRevision:null})});assert.equal(saved.status,200,await saved.text());report.checks.push('project-scoped v2 multi-page prototype saved');
  window=new BrowserWindow({width:1000,height:780,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'prototype-ui-'+Date.now()}});
  window.webContents.on('console-message',details=>{if(details.level==='error')report.errors.push(details.message);});
  const route='/__local/design-preview?projectId='+project.id;
  const response=await fetch(origin+route);assert.ok(response.headers.get('content-security-policy').includes("connect-src 'none'"));assert.ok(!response.headers.get('content-security-policy').includes('allow-same-origin'));report.checks.push('read-only prototype sandbox cannot access local application APIs');
  await window.loadURL(origin+route);await until('document.querySelector("#screen-0:not([hidden])")','initial screen');assert.equal(await evaluate('typeof require'),'undefined');
  await click('[data-node-id="next"]');await until('document.querySelector("#screen-1:not([hidden])")','cross-page hotspot navigation');assert.equal(await evaluate('document.querySelector("#screens").value'),'1');report.checks.push('real pointer click navigates to another page frame');
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await until('document.querySelector("#screen-0:not([hidden])")','back navigation');report.checks.push('keyboard back restores the previous screen');
  await click('#hints');assert.equal(await evaluate('document.body.classList.contains("hints")'),true);report.checks.push('interactive hotspot hints toggle');
  await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics/design-prototype-ui.png'),await(await window.webContents.capturePage()).toPNG());
  const download=await fetch(origin+route+'&download=1');assert.match(download.headers.get('content-disposition'),/attachment/);const exported=path.join(directory,'offline-prototype.html');await fs.writeFile(exported,await download.text());
  const outbound=[];window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(/^https?:/.test(details.url))outbound.push(details.url);callback({cancel:/^https?:/.test(details.url)});});
  await window.loadFile(exported);await until('document.querySelector("#screen-0:not([hidden])")','offline export load');await click('[data-node-id="next"]');await until('document.querySelector("#screen-1:not([hidden])")','offline hotspot navigation');assert.deepEqual(outbound,[]);report.checks.push('exported single HTML works offline with no server or external requests');
  report.ok=true;
}).catch(error=>{report.errors.push(error.stack||String(error));process.exitCode=1;}).finally(async()=>{
  window?.destroy();server?.kill('SIGTERM');await sleep(150);if(directory)await fs.rm(directory,{recursive:true,force:true});await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics/design-prototype-ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));app.quit();
});
