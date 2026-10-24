import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createCanvasService} from '../../../网页端/workbench/server/canvas.mjs';
import {createDesignCloud} from '../../../网页端/workbench/server/design-cloud.mjs';
import {emptyDocument,createNode,validateDocument} from '../../../网页端/workbench/canvas/model.mjs';

function document(name='设计版本 A'){
  const doc=emptyDocument(name),frame={...createNode('frame'),id:'frame-proof',children:[{...createNode('text',10,20),id:'text-proof',text:name}]};
  if(doc.pages)doc.pages[0].nodes=[frame];else doc.nodes=[frame];return doc;
}
async function fixture(t){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'m0-design-cloud-')),dataDir=path.join(temp,'data');
  const projects=[{id:1,projectPath:path.join(temp,'one')},{id:2,projectPath:path.join(temp,'two')}];for(const project of projects)await fs.mkdir(project.projectPath);
  let active=projects[0].projectPath;
  const api={findProject:id=>projects.find(item=>String(item.id)===String(id)),state:{projects}};
  const canvas=createCanvasService({api,getWorkspace:()=>active});
  const options={dataDir,resolveWorkspace:canvas.target,readCanvas:canvas.read,saveCanvas:canvas.save};
  let cloud=createDesignCloud(options);
  const server=http.createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;if(!await cloud.handle(req,res,new URL(req.url,'http://127.0.0.1'),body?JSON.parse(body):{})){res.statusCode=404;res.end();}}catch(error){res.writeHead(error.status||400,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+server.address().port;
  async function request(route,method='GET',body,projectId=1){const url=route.startsWith('/')?origin+route:origin+'/__local/design-cloud/api/'+route+(route.includes('?')?'&':'?')+'projectId='+projectId;const response=await fetch(url,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const type=response.headers.get('content-type')||'';return {status:response.status,headers:response.headers,data:type.includes('application/json')?await response.json():await response.text()};}
  async function save(doc,projectId=1){const context=await canvas.target(projectId),current=await canvas.read(context);return canvas.save(context,{document:doc,expectedRevision:current.revision});}
  return {temp,dataDir,projects,canvas,request,save,setWorkspace:value=>active=value,restart:()=>cloud=createDesignCloud(options)};
}

test('project snapshots persist, remain immutable and restore with revision checks plus recovery backup',async t=>{
  const f=await fixture(t),saved=await f.save(document());
  const created=await f.request('versions','POST',{label:'定稿快照',expectedRevision:saved.revision});assert.equal(created.status,201);
  const id=created.data.id;
  const changed=await f.save(document('当前版本 B'));
  assert.equal((await f.request('versions/'+id)).data.document.name,'设计版本 A');
  assert.equal((await f.request('versions/'+id+'/restore','POST',{expectedRevision:saved.revision})).status,409);
  assert.equal((await f.request('versions/'+id+'/restore','POST',{})).status,400);
  assert.equal((await f.canvas.read(await f.canvas.target(1))).document.name,'当前版本 B');
  f.setWorkspace(f.projects[1].projectPath);
  const restored=await f.request('versions/'+id+'/restore','POST',{expectedRevision:changed.revision});assert.equal(restored.status,200);assert.equal(restored.data.document.name,'设计版本 A');
  const versions=(await f.request('versions')).data;assert.equal(versions.length,2);assert.match(versions[0].label,/自动备份/);
  assert.equal((await f.request('versions/'+versions[0].id)).data.document.name,'当前版本 B');
  assert.equal((await f.request('versions/'+id,'GET',undefined,2)).status,404);
  assert.equal((await f.canvas.read(await f.canvas.target(2))).document,null);
  f.restart();assert.equal((await f.request('versions')).data.length,2);
  const preview=await f.request('versions/'+id+'?format=html');assert.equal(preview.status,200);assert.match(preview.data,/设计版本 A/);assert.doesNotMatch(preview.data,/<script/i);
});

test('node comments validate targets, isolate projects, detect resolution conflicts and track removed nodes',async t=>{
  const f=await fixture(t);await f.save(document());
  assert.equal((await f.request('comments','POST',{nodeId:'missing',text:'bad'})).status,409);
  const comment=(await f.request('comments','POST',{nodeId:'text-proof',text:'<img src=x onerror=alert(1)> 调整文字',author:'本地复核'})).data;
  assert.equal(comment.nodeId,'text-proof');assert.equal(comment.version,1);
  assert.equal((await f.request('comments/'+comment.id,'PATCH',{resolved:true,expectedVersion:1},2)).status,404);
  const concurrent=await Promise.all([f.request('comments/'+comment.id,'PATCH',{resolved:true,expectedVersion:1}),f.request('comments/'+comment.id,'PATCH',{resolved:true,expectedVersion:1})]);assert.deepEqual(concurrent.map(item=>item.status).sort(),[200,409]);
  assert.equal((await f.request('comments/'+comment.id,'PATCH',{resolved:false,expectedVersion:1})).status,409);
  await f.save(emptyDocument('节点已删除'));
  const state=(await f.request('state')).data;assert.equal(state.comments[0].orphaned,true);assert.equal(state.comments[0].resolved,true);assert.match(state.comments[0].text,/onerror/);
  assert.equal((await f.request('comments','POST',{text:'x'.repeat(4001)})).status,400);
  f.restart();assert.equal((await f.request('comments')).data[0].version,2);
});

test('local templates apply to their own project with an automatic backup and no overwrite on conflict',async t=>{
  const f=await fixture(t),saved=await f.save(document('模板内容'));
  const item=(await f.request('templates','POST',{label:'离线模板',expectedRevision:saved.revision})).data;
  const changed=await f.save(document('当前改动'));
  assert.equal((await f.request('templates/'+item.id+'/apply','POST',{expectedRevision:saved.revision})).status,409);
  assert.equal((await f.request('templates','GET',undefined,2)).data.length,0);
  assert.equal((await f.request('templates/'+item.id+'/apply','POST',{expectedRevision:changed.revision},2)).status,404);
  const result=await f.request('templates/'+item.id+'/apply','POST',{expectedRevision:changed.revision});assert.equal(result.status,200);assert.equal(result.data.document.name,'模板内容');
  const backup=(await f.request('versions')).data[0];assert.equal((await f.request('versions/'+backup.id)).data.document.name,'当前改动');
});

test('multi-page frozen shares and standalone HTML export remain read-only, offline and revocable',async t=>{
  const f=await fixture(t),first={...createNode('text'),id:'first-text',text:'第一页内容 <script>not executable</script>'},second={...createNode('text'),id:'second-text',text:'第二页快照内容'};
  const doc=validateDocument({format:'m0-local-canvas-v1',version:2,name:'多页面设计',activePageId:'first-page',pages:[{id:'first-page',name:'第一页',nodes:[first]},{id:'second-page',name:'第二页',nodes:[second]}],components:[]});
  const saved=await f.save(doc),state=(await f.request('state')).data;assert.equal(state.pages.length,2);assert.ok(state.nodes.some(node=>node.pageId==='second-page'));
  const item=(await f.request('shares','POST',{label:'冻结只读版本',expectedRevision:saved.revision})).data;assert.match(item.token,/^[a-f0-9]{48}$/);
  await f.save(document('后续的新版本不可泄漏到旧分享'));
  const share=await f.request(item.url);assert.equal(share.status,200);assert.match(share.data,/第二页快照内容/);assert.match(share.data,/href="#page-2"/);assert.match(share.data,/&lt;script&gt;/);assert.doesNotMatch(share.data,/后续的新版本|<script|fetch\(|\/api\/|\/__local\//i);
  assert.match(share.headers.get('content-security-policy'),/default-src 'none'/);
  const download=await f.request(item.url+'?download=1');assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.equal((await f.request(item.url,'POST',{})).status,405);
  assert.equal((await f.request('shares/'+item.token,'DELETE',undefined,2)).status,404);
  f.restart();assert.equal((await f.request(item.url)).status,200);
  const prototype=await f.request(item.url+'?mode=prototype');assert.equal(prototype.status,200);assert.match(prototype.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(prototype.headers.get('content-security-policy'),/connect-src 'none'/);
  const exported=await f.request('export');assert.equal(exported.status,200);assert.match(exported.data,/后续的新版本/);assert.doesNotMatch(exported.data,/<script|\/__local\//i);
  await f.request('shares/'+item.token,'DELETE');assert.equal((await f.request(item.url)).status,404);
});

test('storage and canvas symlinks, traversal IDs, malformed input and stale snapshots are rejected',async t=>{
  const f=await fixture(t),saved=await f.save(document());
  assert.equal((await f.request('versions','POST',{expectedRevision:'stale'})).status,409);
  assert.equal((await f.request('versions','POST',{expectedRevision:saved.revision,label:'x'.repeat(121)})).status,400);
  assert.equal((await f.request('/__local/design-cloud/api/versions/%2e%2e%2foutside?projectId=1')).status,400);
  const outside=path.join(f.temp,'outside.json');await fs.writeFile(outside,JSON.stringify(document('外部内容')));await fs.symlink(outside,path.join(f.projects[1].projectPath,'canvas.json'));
  assert.equal((await f.request('versions','POST',{expectedRevision:null},2)).status,400);
  const storage=path.join(f.dataDir,'design-cloud','projects'),key=createHash('sha256').update('1\0'+await fs.realpath(f.projects[0].projectPath)).digest('hex'),project=path.join(storage,key),target=path.join(f.temp,'external-state');await fs.mkdir(target);
  await fs.rename(project,project+'.backup');await fs.symlink(target,project);
  assert.equal((await f.request('state')).status,403);assert.deepEqual(await fs.readdir(target),[]);
});
