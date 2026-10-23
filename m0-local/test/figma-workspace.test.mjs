import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createFigmaBridge} from '../server/figma-bridge.mjs';
import {createFigmaWorkspace,normalizeFigmaWorkspaceURL} from '../server/figma-workspace.mjs';
import {createCanvasService} from '../server/canvas.mjs';
import {createPluginHarness,createPluginUiHarness} from '../figma-plugin-bridge/test-harness.mjs';

const FILE='FigmaFile_123',OTHER='AnotherFile_456';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(action){for(let count=0;count<100;count++){const value=await action();if(value)return value;await delay(2);}throw Error('Workspace fixture timeout');}
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-figma-workspace-')),dataDir=path.join(directory,'data'),projects=[{id:1,name:'One',projectPath:path.join(directory,'one')},{id:2,name:'Two',projectPath:path.join(directory,'two')}];for(const project of projects)await fs.mkdir(project.projectPath);
  let saved=0,active=projects[0].projectPath;const api={state:{projects},findProject:id=>projects.find(project=>String(project.id)===String(id)),save(){saved++}};
  const canvas=createCanvasService({api,getWorkspace:()=>active}),bridge=createFigmaBridge({dataDir,resolveProject:api.findProject,commandTimeoutMs:2000});const workspace=createFigmaWorkspace({api,canvas,bridge,port:4317,dataDir});
  const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');if(await bridge.handle(req,res,url))return;let body='';for await(const chunk of req)body+=chunk;const parsed=body?JSON.parse(body):{};let value;
      if(url.pathname==='/workspace')value=req.method==='PUT'?await workspace.set(url.searchParams.get('projectId'),parsed):await workspace.get(url.searchParams.get('projectId'));
      else if(url.pathname==='/generate')value=await workspace.generate(url.searchParams.get('projectId'),parsed);
      else throw Object.assign(Error('Not found'),{status:404});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
    }catch(error){res.writeHead(error.status||400,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{bridge.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const request=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(origin+route,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  async function connect({fileKey=FILE,projectId=1,node='text',image=false}={}){
    await workspace.set(projectId,{url:'https://www.figma.com/design/'+fileKey+'/Fixture'});
    const plugin=createPluginHarness(fileKey);if(node==='frame')plugin.page.selection=[plugin.frame];if(image)plugin.frame.fills=[{type:'IMAGE',imageHash:'fixture-existing-image',scaleMode:'FILL'}];
    const ui=await createPluginUiHarness({plugin,baseUrl:origin}),pair=await request('/__local/figma/bridge/pair',{action:'create',projectId});await ui.pair(pair.data.code);
    const context=await until(async()=>{try{return await bridge.getContext({projectId,fileKey,sessionId:plugin.id})}catch{}});
    const captured={projectId,fileKey,sessionId:plugin.id,selectionRevision:context.selectionRevision,targetNodeIds:[context.nodes[0].id]};return {plugin,ui,context,captured};
  }
  return {directory,dataDir,projects,api,canvas,bridge,workspace,request,connect,origin,setActive:value=>active=value,get saved(){return saved;}};
}

test('Figma workspace URLs normalize canonical HTTPS links and reject other origins, credentials and invalid keys',()=>{
  const input=' https://figma.com/design/Abc_123-xyz/My%20File?node-id=1-2&tracking=secret#section ',normalized=normalizeFigmaWorkspaceURL(input);assert.equal(normalized.fileKey,'Abc_123-xyz');assert.equal(normalized.url,'https://www.figma.com/design/Abc_123-xyz/My%20File?node-id=1-2');
  assert.deepEqual(normalizeFigmaWorkspaceURL('https://figma.new/?tracking=x'),{url:'https://figma.new/',fileKey:null});assert.equal(normalizeFigmaWorkspaceURL('https://www.figma.com/files').fileKey,null);
  for(const value of ['http://www.figma.com/design/key','https://www.figma.com.evil.example/design/key','https://name:pass@www.figma.com/design/key','https://www.figma.com:444/design/key','https://www.figma.com/design/%2Fescape','file:///tmp/figma','javascript:alert(1)','https://www.figma.com/account'])assert.throws(()=>normalizeFigmaWorkspaceURL(value),undefined,value);
});

test('project file bindings persist through the project store and captured selections require the exact live scope',async t=>{
  const f=await fixture(t),live=await f.connect(),captured=await f.workspace.capture(1,live.captured);assert.equal(captured.nodes[0].id,'1:1');assert.ok(f.saved>0);assert.equal((await f.workspace.get(1)).fileKey,FILE);
  await assert.rejects(f.workspace.capture(2,live.captured),error=>error.status===409);await assert.rejects(f.workspace.capture(1,{...live.captured,fileKey:OTHER}),error=>error.status===409);await assert.rejects(f.workspace.capture(1,{...live.captured,sessionId:'wrong-session'}),error=>error.status===409);await assert.rejects(f.workspace.capture(1,{...live.captured,targetNodeIds:['outside']}),error=>error.status===409);
  const next=live.plugin.snapshot();await fetch(f.origin+'/__local/figma/bridge/selection',{method:'POST',headers:{origin:'null','content-type':'application/json',authorization:'Bearer '+[...live.plugin.storage.values()][0].token},body:JSON.stringify({fileKey:FILE,sessionId:live.plugin.id,snapshot:next})});
  await assert.rejects(f.workspace.capture(1,live.captured),error=>error.status===409);await f.workspace.set(1,{url:'https://www.figma.com/design/'+OTHER});await assert.rejects(f.workspace.capture(1,{...live.captured,selectionRevision:next.revision}),error=>error.status===409);
});

test('actual plugin schema export runs the recovered KRN generator and saves matching PNG bytes and SHA in only its project',async t=>{
  const f=await fixture(t),live=await f.connect({node:'frame',image:true}),generation=f.request('/generate?projectId=1',{...live.captured,nodeId:'1:2'});await delay(10);await live.ui.tick();const response=await generation;assert.equal(response.status,200,JSON.stringify(response.data));const value=response.data;
  assert.equal(value.engine,'recovered-original-krn');assert.equal(value.fileKey,FILE);assert.equal(value.assets.length,1);assert.equal(value.projectId,1);assert.equal(value.assets[0].path,value.directory+'/assets/figma-1-2.png');
  const image=await fs.readFile(path.join(f.projects[0].projectPath,value.assets[0].path));assert.ok(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.equal(createHash('sha256').update(image).digest('hex'),value.assets[0].sha256);assert.equal(image.length,value.assets[0].size);
  const app=await fs.readFile(path.join(f.projects[0].projectPath,value.directory,'App.tsx'),'utf8');assert.match(app,/react-native/);assert.match(app,/figma-1-2\.png/);assert.ok(value.files.every(file=>file.path.startsWith(value.directory+'/')));assert.deepEqual(await fs.readdir(f.projects[1].projectPath),[]);assert.equal(live.ui.errors.length,0);
});

test('stale selections and a file binding changed during native export cannot save generated output',async t=>{
  const f=await fixture(t),live=await f.connect();await assert.rejects(f.workspace.generate(1,{...live.captured,selectionRevision:0,nodeId:'1:1'}),error=>error.status===409);
  const generation=f.workspace.generate(1,{...live.captured,nodeId:'1:1'});const rejection=assert.rejects(generation,error=>error.status===409&&/切换/.test(error.message));await delay(10);await f.workspace.set(1,{url:'https://www.figma.com/design/'+OTHER});await live.ui.tick();await rejection;assert.deepEqual(await fs.readdir(f.projects[0].projectPath),[]);
});

test('switching the application active project does not redirect a captured project export',async t=>{
  const f=await fixture(t),live=await f.connect(),generation=f.workspace.generate(1,{...live.captured,nodeId:'1:1'});await delay(10);f.setActive(f.projects[1].projectPath);await live.ui.tick();const value=await generation;assert.equal(value.projectId,1);assert.ok((await fs.readdir(f.projects[0].projectPath)).includes('generated'));assert.deepEqual(await fs.readdir(f.projects[1].projectPath),[]);
});
