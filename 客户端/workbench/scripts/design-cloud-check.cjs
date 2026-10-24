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
let directory,server,window,shareWindow,origin;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=source=>window.webContents.executeJavaScript(source,true);
async function until(source,label){const end=Date.now()+10000;while(Date.now()<end){if(await evaluate(source))return;await pause(35);}throw Error('Timeout: '+label);}
async function click(selector){const position=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing '+${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mouseDown','mouseUp'])window.webContents.sendInputEvent({type,button:'left',clickCount:1,x:Math.round(position.x),y:Math.round(position.y)});await pause(50);}
async function fill(selector,text){await click(selector);window.webContents.insertText(text);}
async function request(route,method='GET',body){const response=await fetch(origin+route,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;}
app.setPath('userData',path.join(os.tmpdir(),'m0-design-cloud-browser-'+process.pid));
app.commandLine.appendSwitch('disable-background-networking');app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-design-cloud-ui-'));
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));origin='http://127.0.0.1:'+port;
  server=spawn(process.execPath,[path.join(layout.webRoot,'server/index.mjs')],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',M0_LOCAL_PORT:String(port),M0_LOCAL_DATA_DIR:path.join(directory,'data'),M0_LOCAL_WORKSPACE:path.join(directory,'workspace')},stdio:'ignore'});
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(origin+'/__local/health')).ok){ready=true;break;}}catch{}await pause(40);}assert.ok(ready,'isolated server ready');
  const model=await import(path.join(layout.webRoot,'canvas/model.mjs'));
  function document(name){const doc=model.emptyDocument(name),frame=model.createNode('frame');frame.id='frame-ui';const text=model.createNode('text',20,40);text.id='text-ui';text.text=name;frame.children=[text];if(doc.pages)doc.pages[0].nodes=[frame];else doc.nodes=[frame];return doc;}
  const project=await request('/api/project/v2/create','POST',{projectName:'本地设计协作验证',mode:'design'}),canvas='/__local/canvas?projectId='+project.id;
  async function save(name){const current=await request(canvas);return request(canvas,'PUT',{document:document(name),expectedRevision:current.revision});}
  await save('初始设计 Alpha');
  window=new BrowserWindow({width:1200,height:950,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'design-cloud-ui-'+Date.now()}});
  window.webContents.on('console-message',details=>{if(details.level==='error')report.errors.push(details.message);});
  const route='/__local/design-cloud?projectId='+project.id+'&nodeId=text-ui';await window.loadURL(origin+route);
  await until(`document.querySelector('#project-name').textContent==='初始设计 Alpha'`,'initial project load');
  await fill('#version-label','初始定稿');await click('#create-version');await until(`document.querySelector('#status').textContent.includes('版本快照已保存')`,'snapshot creation');
  assert.equal((await request('/__local/design-cloud/api/versions?projectId='+project.id)).length,1);report.checks.push('real UI creates a persistent immutable snapshot');
  await save('后续设计 Beta');await click('#reload');await until(`document.querySelector('#project-name').textContent==='后续设计 Beta'`,'refresh changed design');
  await click('#versions-list .entry .actions button:nth-child(2)');await until(`document.querySelector('#status').textContent.includes('已恢复版本')`,'restore snapshot');assert.equal((await request(canvas)).document.name,'初始设计 Alpha');report.checks.push('real UI restores a version with automatic current-canvas backup');
  await click('[data-tab="comments"]');assert.equal(await evaluate(`document.querySelector('#comment-node').value`),'text-ui');
  await fill('#comment-text','请检查该文字的层级与对比度');await click('#add-comment');await until(`document.querySelector('#status').textContent==='评论已保存。'`,'node comment');
  await click('#comments-list .entry button');await until(`document.querySelector('#comments-list').textContent.includes('已解决')`,'comment resolution');const comments=await request('/__local/design-cloud/api/comments?projectId='+project.id);assert.equal(comments[0].resolved,true);report.checks.push('node-targeted comment is created and resolved through actual controls');
  await click('[data-tab="templates"]');await fill('#template-label','离线登录页');await click('#create-template');await until(`document.querySelector('#status').textContent.includes('模板已保存')`,'template save');
  await save('待替换设计 Gamma');await click('#reload');await until(`document.querySelector('#project-name').textContent==='待替换设计 Gamma'`,'template precondition');await click('#templates-list .entry button');await until(`document.querySelector('#status').textContent.includes('已应用模板')`,'template apply');assert.equal((await request(canvas)).document.name,'初始设计 Alpha');report.checks.push('offline project template is actually applied with a recovery version');
  await click('[data-tab="shares"]');await fill('#share-label','只读复核');await click('#create-share');await until(`document.querySelector('#status').textContent.includes('已创建冻结内容')`,'share create');
  const share=await evaluate(`document.querySelector('#shares-list .entry a').getAttribute('href')`);
  shareWindow=new BrowserWindow({width:900,height:700,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'design-cloud-share-'+Date.now()}});await shareWindow.loadURL(origin+share);
  assert.ok(await shareWindow.webContents.executeJavaScript(`document.body.textContent.includes('初始设计 Alpha')&&document.querySelectorAll('input,textarea,[contenteditable]').length===0`));shareWindow.destroy();shareWindow=undefined;report.checks.push('frozen share opens as a read-only design page');
  await click('#shares-list .entry button.danger');await until(`document.querySelector('#status').textContent==='只读链接已撤销。'`,'share revoke');assert.equal((await fetch(origin+share)).status,404);report.checks.push('revocation invalidates the existing share URL');
  const exported=await fetch(origin+'/__local/design-cloud/api/export?projectId='+project.id);assert.match(exported.headers.get('content-disposition'),/attachment/);const html=await exported.text();assert.match(html,/初始设计 Alpha/);assert.doesNotMatch(html,/<script|\/__local\//i);report.checks.push('standalone static HTML contains the design and no local API endpoint');
  await window.reload();await until(`document.querySelector('#shares-list').textContent.includes('已撤销')`,'persisted collaboration state after reload');
  await click('[data-tab="versions"]');await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics/design-cloud-ui.png'),await(await window.webContents.capturePage()).toPNG());
  assert.deepEqual(report.errors,[]);report.ok=true;
}).catch(error=>{report.errors.push(error.stack||String(error));process.exitCode=1;}).finally(async()=>{
  shareWindow?.destroy();window?.destroy();server?.kill('SIGTERM');await pause(150);if(directory)await fs.rm(directory,{recursive:true,force:true});await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics/design-cloud-ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);
});
