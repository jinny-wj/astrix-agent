'use strict';
const {getLayout}=require('../../../packages/astrix-workbench/layout.cjs');
const layout=getLayout();
const {app,BrowserWindow}=require('electron');
const {fork}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const sandbox=path.join(root,'.local-data','preview-check');
app.setPath('userData',path.join(sandbox,'electron'));
app.commandLine.appendSwitch('disable-background-networking');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,win;
const result={consoleErrors:[],requests:[]};
app.whenReady().then(async()=>{
  const workspace=path.join(sandbox,'workspace');await fs.mkdir(workspace,{recursive:true});
  await fs.writeFile(path.join(workspace,'index.html'),`<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><p id="result">Waiting</p><script type="module">import {message} from './message.js';document.getElementById('result').textContent=message;try{const response=await fetch('/__local/model');document.body.dataset.apiStatus=String(response.status)}catch{document.body.dataset.apiStatus='blocked'}try{window.parent.document.body.dataset.unexpected='escape';document.body.dataset.parentAccess='allowed'}catch{document.body.dataset.parentAccess='blocked'}</script></html>`);
  await fs.writeFile(path.join(workspace,'message.js'),'export const message="本地 ES Module 预览成功";');
  await fs.writeFile(path.join(workspace,'style.css'),'#result{color:rgb(81, 61, 180)}');
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  server=fork(path.join(layout.webRoot,'server/index.mjs'),[],{execPath:process.execPath,execArgv:[],cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',M0_LOCAL_PORT:String(port),M0_LOCAL_DATA_DIR:path.join(sandbox,'data'),M0_LOCAL_WORKSPACE:workspace},silent:true});
  server.stderr.on('data',chunk=>{result.serverError=(result.serverError||'')+String(chunk);});
  let ready=false;
  for(let i=0;i<80;i++){try{if((await fetch(origin+'/__local/health')).ok){ready=true;break;}}catch{}await delay(50);}
  if(!ready)throw Error('Preview test server not ready: '+result.serverError);
  win=new BrowserWindow({show:true,width:1000,height:700,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.on('console-message',event=>{if(event.level==='error')result.consoleErrors.push(event.message);});
  // An ordinary trusted page embeds the capability preview in its child frame.
  await win.loadURL(origin+'/__local/editor');
  await win.webContents.executeJavaScript(`document.body.replaceChildren(Object.assign(document.createElement('iframe'),{src:'/__local/preview',style:'width:100%;height:90vh;border:0'}))`);
  let snapshot;
  for(let i=0;i<80;i++){
    const frame=win.webContents.mainFrame.frames[0];
    if(frame)try{snapshot=await frame.executeJavaScript(`({text:document.body.innerText,apiStatus:document.body.dataset.apiStatus,parentAccess:document.body.dataset.parentAccess,color:document.getElementById('result')&&getComputedStyle(document.getElementById('result')).color})`);}catch{}
    if(snapshot?.apiStatus&&snapshot?.parentAccess)break;
    await delay(100);
  }
  result.snapshot=snapshot;
  if(snapshot?.text!=='本地 ES Module 预览成功'||!['403','blocked'].includes(snapshot?.apiStatus)||snapshot?.parentAccess!=='blocked'||snapshot?.color!=='rgb(81, 61, 180)')throw Error('Preview browser assertions failed');
  result.ok=true;
}).catch(error=>{result.ok=false;result.error=error.stack;}).finally(async()=>{
  await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});
  await fs.writeFile(path.join(root,'diagnostics/preview-check.json'),JSON.stringify(result,null,2));
  if(win&&!win.isDestroyed())await fs.writeFile(path.join(root,'diagnostics/preview-check.png'),(await win.webContents.capturePage()).toPNG());
  server?.kill('SIGTERM');
  console.log(JSON.stringify(result));app.exit(result.ok?0:1);
});
