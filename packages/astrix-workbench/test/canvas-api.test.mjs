import {getLayout} from '../layout.cjs';
const layout=getLayout();
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emptyDocument,createNode,getActivePage} from '../../../网页端/workbench/canvas/model.mjs';
import {createCanvasService} from '../../../网页端/workbench/server/canvas.mjs';

let temp,child,origin,first,second;
const root=layout.webRoot;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(route,method='GET',body){const r=await fetch(origin+route,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'m0-canvas-api-'));
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));origin=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,ASTRIX_PORT:String(port),ASTRIX_DATA_DIR:path.join(temp,'data'),ASTRIX_WORKSPACE:path.join(temp,'workspace'),FIGMA_OAUTH_CLIENT_ID:'',FIGMA_OAUTH_CLIENT_SECRET:'',FIGMA_OAUTH_REDIRECT_URI:''},stdio:'ignore'});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/__local/health')).ok){ready=true;break;}}catch{}await delay(40);}assert.ok(ready);
  const oauth=await fetch(origin+'/api/auth/figma/session');assert.equal(oauth.status,200);
  assert.deepEqual(await oauth.json(),{configured:false,authenticated:false,user:null},'canvas fixture must not use application OAuth credentials or sessions');
  first=(await request('/api/project/v2/create','POST',{mode:'code',projectName:'画布项目A'})).data;
  second=(await request('/api/project/v2/create','POST',{mode:'code',projectName:'画布项目B'})).data;
});
after(async()=>{child?.kill('SIGTERM');await delay(150);await fs.rm(temp,{recursive:true,force:true});});
const route=project=>'/__local/canvas?projectId='+project.id;
function fixture(){const doc=emptyDocument('本地画布 API 测试'),frame=createNode('frame');frame.children=[{...createNode('text',20,30),text:'真实画布转原 KRN'}];getActivePage(doc).nodes=[frame];return doc;}
test('unqualified canvas binds the project when its folder has a different canonical alias',async()=>{
  const directory=path.join(temp,'canonical-workspace'),alias=path.join(temp,'workspace-alias');await fs.mkdir(directory);await fs.symlink(directory,alias);
  const project={id:'alias-project',projectPath:alias},service=createCanvasService({api:{state:{projects:[project]}},getWorkspace:()=>directory});
  const context=await service.target();assert.equal(context.projectId,project.id);assert.equal(context.workspace,await fs.realpath(directory));
});
test('canvas saves to the explicit project, validates revision and survives workspace switching',async()=>{
  const initial=await request(route(first));assert.equal(initial.data.document,null);assert.equal(initial.data.revision,null);
  const saved=await request(route(first),'PUT',{document:fixture(),expectedRevision:null});assert.equal(saved.status,200);assert.equal(saved.data.projectId,first.id);assert.match(saved.data.revision,/^[a-f0-9]{64}$/);
  const content=JSON.parse(await fs.readFile(path.join(first.projectPath,'canvas.json'),'utf8'));assert.equal(content.name,'本地画布 API 测试');
  assert.equal((await request(route(second))).data.document,null);
  assert.equal((await request(route(first),'PUT',{document:fixture(),expectedRevision:null})).status,409);
  assert.equal((await request(route(first),'PUT',{document:fixture()})).status,400);
});
test('simultaneous saves enforce optimistic revision instead of overwriting each other',async()=>{
  const current=(await request(route(first))).data;
  const a=fixture(),b=fixture();a.name='并发A';b.name='并发B';
  const results=await Promise.all([request(route(first),'PUT',{document:a,expectedRevision:current.revision}),request(route(first),'PUT',{document:b,expectedRevision:current.revision})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
test('saved canvas invokes the recovered KRN generator and imports into the captured project only',async()=>{
  const current=(await request(route(first))).data;
  const generated=await request('/__local/canvas/generate?projectId='+first.id,'POST',{expectedRevision:current.revision,directory:'generated/design'});
  assert.equal(generated.status,200,JSON.stringify(generated.data));assert.equal(generated.data.engine,'recovered-original-krn');
  assert.match(await fs.readFile(path.join(first.projectPath,'generated/design/App.tsx'),'utf8'),/真实画布转原 KRN/);
  assert.match(await fs.readFile(path.join(first.projectPath,'generated/design/styles.ts'),'utf8'),/StyleSheet/);
  await assert.rejects(fs.access(path.join(second.projectPath,'generated/design/App.tsx')));
  assert.equal((await request('/__local/canvas/generate?projectId='+first.id,'POST',{expectedRevision:current.revision,directory:'generated/design'})).status,409);
  assert.equal((await request('/__local/canvas/generate?projectId='+first.id,'POST',{expectedRevision:current.revision,directory:'../../escape'})).status,400);
});
test('canvas rejects malformed documents, unknown projects and escaping symlinks',async()=>{
  assert.equal((await request('/__local/canvas?projectId=99999')).status,404);
  const current=(await request(route(first))).data;
  assert.equal((await request(route(first),'PUT',{document:{format:'other',nodes:[]},expectedRevision:current.revision})).status,400);
  const outside=path.join(temp,'outside.json');await fs.writeFile(outside,JSON.stringify(fixture()));
  await fs.symlink(outside,path.join(second.projectPath,'canvas.json'));
  assert.equal((await request(route(second))).status,400);
  assert.equal((await request(route(second),'PUT',{document:fixture(),expectedRevision:null})).status,400);
  assert.equal(JSON.parse(await fs.readFile(outside,'utf8')).name,'本地画布 API 测试');
});
test('legacy canvas migrates without loss, and native KRN image references have exact local bytes',async()=>{
  const legacy={format:'m0-local-canvas-v1',version:1,name:'旧版画布迁移',nodes:[{...createNode('frame'),id:'legacy-frame',children:[{...createNode('text'),id:'legacy-text',text:'旧版本保留文字'}]}]};
  const current=(await request(route(first))).data;
  const migrated=await request(route(first),'PUT',{document:legacy,expectedRevision:current.revision});
  assert.equal(migrated.status,200);assert.equal(migrated.data.document.version,2);assert.equal(migrated.data.document.pages[0].nodes[0].children[0].text,'旧版本保留文字');
  const document=migrated.data.document,base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhYUAAAAASUVORK5CYII=';
  const image={...createNode('image'),imageData:'data:image/png;base64,'+base64};
  getActivePage(document).nodes[0].children.push(image);
  const saved=await request(route(first),'PUT',{document,expectedRevision:migrated.data.revision});assert.equal(saved.status,200);
  const generated=await request('/__local/canvas/generate?projectId='+first.id,'POST',{expectedRevision:saved.data.revision,directory:'generated/image-proof'});
  assert.equal(generated.status,200,JSON.stringify(generated.data));assert.equal(generated.data.assets.length,1);
  const asset=generated.data.assets[0],bytes=await fs.readFile(path.join(first.projectPath,asset.path));assert.deepEqual(bytes,Buffer.from(base64,'base64'));
  const app=await fs.readFile(path.join(first.projectPath,'generated/image-proof/App.tsx'),'utf8');assert.ok(app.includes("./assets/"+path.basename(asset.path)));
  assert.equal(generated.data.imported.files.length,3);
  assert.equal((await request('/__local/canvas/generate?projectId='+first.id,'POST',{expectedRevision:saved.data.revision,directory:'generated/image-proof'})).status,409);
  assert.deepEqual(await fs.readFile(path.join(first.projectPath,asset.path)),bytes);
  // The public text-project import cannot opt into the internal binary path.
  const rejected=await request('/__local/project/import','POST',{files:[{path:'binary-injection.bin',content:{type:'Buffer',data:[0,1,2]}}],allowBinary:true});assert.equal(rejected.status,400);
});
test('dangling canvas symlinks cannot be used to create a file outside the project',async()=>{
  await fs.unlink(path.join(second.projectPath,'canvas.json'));
  const outside=path.join(temp,'never-create.json');await fs.symlink(outside,path.join(second.projectPath,'canvas.json'));
  const rejected=await request(route(second),'PUT',{document:fixture(),expectedRevision:null});assert.equal(rejected.status,400);
  await assert.rejects(fs.access(outside));
  assert.equal((await fs.readdir(first.projectPath)).some(name=>name.startsWith('.m0-canvas-')),false);
});
test('an unregistered workspace canvas cannot save or restore into a newly selected directory',async()=>{
  const a=path.join(temp,'loose-a'),b=path.join(temp,'loose-b');await fs.mkdir(a);await fs.mkdir(b);
  const select=directory=>request('/__local/rpc','POST',{namespace:'workspace',method:'selectPath',args:[directory]});
  assert.equal((await select(a)).status,200);
  const captured=(await request('/__local/canvas')).data;assert.equal(captured.projectId,null);assert.match(captured.workspaceKey,/^[a-f0-9]{64}$/);
  assert.equal((await select(b)).status,200);
  const scope='workspaceKey='+captured.workspaceKey;
  assert.equal((await request('/__local/canvas?'+scope,'PUT',{document:fixture(),expectedRevision:null})).status,409);
  assert.equal((await request('/__local/design-cloud/api/versions?'+scope,'POST',{expectedRevision:null,label:'不应写入'})).status,409);
  assert.equal((await request('/__local/design-preview?'+scope)).status,409);
  await assert.rejects(fs.access(path.join(a,'canvas.json')));await assert.rejects(fs.access(path.join(b,'canvas.json')));
  assert.equal((await request(route(first))).status,200);
});
