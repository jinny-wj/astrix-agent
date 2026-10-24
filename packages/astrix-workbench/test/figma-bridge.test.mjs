import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createPluginHarness as plugin,createPluginUiHarness} from '../../../网页端/workbench/figma-plugin-bridge/test-harness.mjs';
import {createFigmaBridge} from '../../../网页端/workbench/server/figma-bridge.mjs';

const FILE='FigmaFile_123',OTHER='OtherFile_456',SESSION='figma-session-one';
const selected={id:'1:1',name:'Text',type:'TEXT',supports:{text:true,fill:true,resize:true},characters:'Initial'};
function snapshot(fileKey=FILE,sessionId=SESSION,revision=1){return {fileKey,sessionId,revision,documentName:'Fixture',pageId:'0:1',pageName:'Page',nodes:[selected]};}
async function fixture(t,options={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'m0-figma-bridge-')),projects=new Map([['1',{id:1,projectPath:path.join(dataDir,'project-one')}],['2',{id:2,projectPath:path.join(dataDir,'project-two')}]]);for(const project of projects.values())await fs.mkdir(project.projectPath);
  const config={dataDir,port:4888,resolveProject:id=>projects.get(String(id)),...options};let service=createFigmaBridge(config);
  const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res,new URL(req.url,'http://127.0.0.1'))){res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  async function request(route,body,{plugin=false,token,method=body?'POST':'GET',headers={}}={}){const response=await fetch(origin+'/__local/figma/bridge/'+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(plugin?{origin:'null'}:{}),...(token?{authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,data:response.status===204?null:await response.json(),headers:response.headers};}
  async function pair({fileKey=FILE,sessionId=SESSION,projectId=1,selection=snapshot(fileKey,sessionId)}={}){const created=await request('pair',{action:'create',projectId});assert.equal(created.status,200,JSON.stringify(created.data));const paired=await request('pair',{code:created.data.code,fileKey,sessionId},{plugin:true});assert.equal(paired.status,200);assert.equal((await request('selection',{fileKey,sessionId,snapshot:selection},{plugin:true,token:paired.data.token})).status,200);return paired.data;}
  const command=(input={})=>request('commands',{projectId:1,fileKey:FILE,sessionId:SESSION,type:'patch-nodes',selectionRevision:1,targets:[{nodeId:'1:1',expectedType:'TEXT',patches:[{kind:'replace-text',value:'Changed'}]}],...input});
  const pull=pair=>request('pull?'+new URLSearchParams({fileKey:pair.fileKey,sessionId:pair.sessionId}),undefined,{plugin:true,token:pair.token});
  return {request,pair,command,pull,dataDir,projects,origin,get service(){return service},async restart(){service.close();service=createFigmaBridge(config)}};
}
function receipt(command,values={}){return {id:command.id,ok:true,fileKey:command.fileKey,sessionId:command.sessionId,changedNodeIds:['1:1'],...values};}

test('opaque plugin pairs once with a local owner code, persisted tokens are hashes and owner status contains no secrets',async t=>{
  const f=await fixture(t),created=await f.request('pair',{action:'create',projectId:1});assert.equal(created.status,200);assert.match(created.data.code,/^[A-F0-9]{12}$/);
  const manifest=JSON.parse(await fs.readFile(path.join(created.data.pluginDirectory,'manifest.json'),'utf8'));assert.deepEqual(manifest.networkAccess.allowedDomains,['http://127.0.0.1:4888','http://localhost:4888']);
  const pair=await f.request('pair',{code:created.data.code,fileKey:FILE,sessionId:SESSION},{plugin:true});assert.equal(pair.status,200);assert.equal(pair.headers.get('access-control-allow-origin'),'null');
  assert.equal((await f.request('pair',{code:created.data.code,fileKey:OTHER,sessionId:'other'},{plugin:true})).status,403);
  const persisted=await fs.readFile(path.join(f.dataDir,'figma-bridge/pairings.json'),'utf8');assert.ok(!persisted.includes(pair.data.token));assert.match(persisted,/[a-f0-9]{64}/);
  const status=await f.request('status?projectId=1');assert.ok(!JSON.stringify(status.data).includes(pair.data.token));assert.ok(!JSON.stringify(status.data).includes('tokenHash'));
  assert.equal((await f.request('commands',{projectId:1},{plugin:true})).status,403);assert.equal((await f.request('pair',{action:'create',projectId:1},{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await f.request('selection',{fileKey:FILE,sessionId:SESSION,snapshot:snapshot()},{plugin:true})).status,401);
});

test('every queued write, pull and acknowledgement is bound to its paired file, project and session',async t=>{
  const f=await fixture(t),one=await f.pair(),two=await f.pair({fileKey:OTHER,sessionId:'other-session',projectId:2});
  assert.equal((await f.command({fileKey:OTHER})).status,409);assert.equal((await f.command({projectId:2})).status,409);assert.equal((await f.command({selectionRevision:0})).status,409);assert.equal((await f.command({targets:[{nodeId:'outside',expectedType:'TEXT',patches:[{kind:'rename',value:'wrong'}]}]})).status,409);
  const queued=await f.command();assert.equal(queued.status,202);assert.deepEqual((await f.pull(two)).data.commands,[]);const command=(await f.pull(one)).data.commands[0];assert.equal(command.id,queued.data.commandId);
  const forged=await f.request('ack',{fileKey:OTHER,sessionId:two.sessionId,results:[receipt(command)]},{plugin:true,token:two.token});assert.equal(forged.status,403);
  assert.equal((await f.request('ack',{fileKey:FILE,sessionId:SESSION,results:[receipt(command,{sessionId:'wrong'})]},{plugin:true,token:one.token})).status,403);
  assert.equal((await f.request('ack',{fileKey:FILE,sessionId:SESSION,results:[receipt(command)]},{plugin:true,token:one.token})).status,200);
  const result=await f.request('results/'+command.id+'?projectId=1&fileKey='+FILE+'&sessionId='+SESSION);assert.equal(result.data.status,'completed');assert.equal(result.data.result.ok,true);
  assert.equal((await f.request('results/'+command.id+'?projectId=2&fileKey='+FILE+'&sessionId='+SESSION)).status,404);
});

test('service execute waits for the adapted plugin VM receipt, preserves native undo and returns real export data',async t=>{
  const f=await fixture(t),p=plugin(),snap=p.snapshot(),pair=await f.pair({sessionId:p.id,selection:snap});
  const context=await f.service.getContext({projectId:1,fileKey:FILE,sessionId:p.id});assert.equal(context.selectionRevision,snap.revision);assert.equal(context.nodes[0].id,'1:1');
  const promise=f.service.execute({projectId:1,fileKey:FILE,sessionId:p.id,selectionRevision:snap.revision,type:'patch-nodes',targets:[{nodeId:'1:1',expectedType:'TEXT',patches:[{kind:'replace-text',value:'Actually executed in Plugin API fixture'}]}]});
  await new Promise(resolve=>setTimeout(resolve,5));const cmd=(await f.pull(pair)).data.commands[0],result=await p.execute(cmd);assert.equal(p.text.characters,'Actually executed in Plugin API fixture');assert.equal(p.undos,1);
  await f.request('ack',{fileKey:FILE,sessionId:p.id,results:[result]},{plugin:true,token:pair.token});const completed=await promise;assert.equal(completed.ok,true);assert.equal(completed.result.fileKey,FILE);
  for(const [type,format] of [['get-node',undefined],['export-node','PNG'],['export-node','SVG'],['export-node','JSON_REST_V1'],['export-schema',undefined]]){
    const queued=await f.command({sessionId:p.id,type,nodeId:'1:1',format});assert.equal(queued.status,202);const next=(await f.pull(pair)).data.commands.find(command=>command.id===queued.data.id),value=await p.execute(next);assert.equal(value.ok,true);assert.ok(value.data);if(type==='export-schema')assert.equal(value.data.nodeTree.nodeType,'text');else assert.equal(value.data.format,format||'JSON_REST_V1');
    assert.equal((await f.request('ack',{fileKey:FILE,sessionId:p.id,results:[value]},{plugin:true,token:pair.token})).status,200);
  }
});

test('plugin guards missing or wrong binding, changed selection and old generic writes before changing nodes',async()=>{
  const p=plugin(),snap=p.snapshot(),command={id:'bound',fileKey:FILE,sessionId:p.id,type:'patch-nodes',selectionRevision:snap.revision,targets:[{nodeId:'1:1',expectedType:'TEXT',patches:[{kind:'replace-text',value:'Must not write'}]}]};
  await assert.rejects(p.execute({...command,fileKey:OTHER}),/不匹配/);await assert.rejects(p.execute({...command,sessionId:'different'}),/不匹配/);
  p.snapshot();const stale=await p.execute(command);assert.equal(stale.ok,false);assert.match(stale.summary,/未修改/);assert.equal(p.text.characters,'Initial');
  const legacy=await p.execute({...command,id:'legacy',type:'set-characters',nodeId:'1:1',characters:'No'});assert.equal(legacy.ok,false);assert.equal(p.text.characters,'Initial');
  const noKey=plugin(undefined);noKey.figma.fileKey=undefined;await assert.rejects(noKey.execute({...command,sessionId:noKey.id}),/fileKey/);
});

test('atomic preflight prevents partial writes and duplicate command IDs execute only once',async()=>{
  const p=plugin(),snap=p.snapshot(),command={id:'atomic',fileKey:FILE,sessionId:p.id,selectionRevision:snap.revision,type:'patch-nodes',targets:[{nodeId:'1:1',expectedType:'TEXT',patches:[{kind:'replace-text',value:'Safe'}]},{nodeId:'1:2',expectedType:'FRAME',patches:[{kind:'replace-text',value:'Invalid'}]}]};p.page.selection=[p.text,p.frame];
  const result=await p.execute(command);assert.equal(result.ok,false);assert.equal(p.text.characters,'Initial');assert.equal(p.undos,0);
  const next={...command,id:'once',targets:command.targets.slice(0,1)},success=await p.execute(next);assert.equal(success.ok,true);assert.equal(p.undos,1);p.text.characters='Peer later';const retry=await p.execute(next);assert.equal(retry.ok,true);assert.equal(p.text.characters,'Peer later');assert.equal(p.undos,1);
});

test('schema exports complex appearance as actual PNG assets and keeps simple view/text structure',async()=>{
  const p=plugin();p.frame.fills=[{type:'IMAGE',imageHash:'existing-pixels',scaleMode:'FILL'}];
  const value=await p.execute({id:'schema',fileKey:FILE,sessionId:p.id,type:'export-schema',nodeId:p.frame.id});assert.equal(value.ok,true);assert.equal(value.data.nodeTree.nodeType,'image');const asset=value.data.imageMap[value.data.nodeTree.imageId];assert.equal(asset.fileName,'figma-1-2.png');assert.ok(Buffer.from(asset.dataURL.split(',')[1],'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.ok(value.data.metadata.notes.length);
});

test('timeouts never report success, abort prevents undispatched writes and revoked sessions cannot pull or ack',async t=>{
  const f=await fixture(t,{commandTimeoutMs:35}),pair=await f.pair();
  const pending=f.service.execute({projectId:1,fileKey:FILE,sessionId:SESSION,type:'get-node',nodeId:'1:1'});await assert.rejects(pending,error=>error.status===504);
  const controller=new AbortController(),cancelled=f.service.execute({projectId:1,fileKey:FILE,sessionId:SESSION,selectionRevision:1,type:'create-frame',signal:controller.signal});await new Promise(resolve=>setTimeout(resolve,1));controller.abort();await assert.rejects(cancelled,error=>error.status===499);assert.deepEqual((await f.pull(pair)).data.commands,[]);
  assert.equal((await f.request('pair',{action:'revoke',projectId:1,pairingId:pair.pairingId})).status,200);assert.equal((await f.pull(pair)).status,403);
});

test('persistent pairing resumes only its file with a new session after restart and invalidates the old session',async t=>{
  const f=await fixture(t),paired=await f.pair();await f.restart();assert.equal((await f.request('status?projectId=1')).data.sessions.length,0);
  const wrong=await f.request('pair',{token:paired.token,fileKey:OTHER,sessionId:'resumed'},{plugin:true});assert.equal(wrong.status,403);
  const resumed=await f.request('pair',{token:paired.token,fileKey:FILE,sessionId:'resumed'},{plugin:true});assert.equal(resumed.status,200);
  assert.equal((await f.pull(paired)).status,403);const current=resumed.data;assert.equal((await f.request('selection',{fileKey:FILE,sessionId:'resumed',snapshot:snapshot(FILE,'resumed')},{plugin:true,token:current.token})).status,200);assert.equal((await f.service.getContext({projectId:1,fileKey:FILE})).sessionId,'resumed');
});

test('project directory changes and symlink materialization cannot silently redirect a pairing',async t=>{
  const f=await fixture(t),pair=await f.pair();f.projects.set('1',{id:1,projectPath:f.projects.get('2').projectPath});assert.equal((await f.pull(pair)).status,409);await assert.rejects(f.service.getContext({projectId:1,fileKey:FILE}),error=>error.status===409);
  const file=path.join(f.dataDir,'figma-plugin','code.js');await fs.unlink(file);await fs.symlink(path.join(f.dataDir,'untouched'),file);await assert.rejects(f.service.preparePlugin(),/符号链接/);await assert.rejects(fs.access(path.join(f.dataDir,'untouched')));
});

test('repeated metadata reads do not rewrite watched plugin files or trigger needless hot reloads',async t=>{
  const f=await fixture(t),first=await f.service.preparePlugin(),file=path.join(first.pluginDirectory,'code.js'),before=await fs.stat(file);
  await new Promise(resolve=>setTimeout(resolve,5));await Promise.all([f.service.preparePlugin(),f.service.preparePlugin(),f.request('metadata')]);const after=await fs.stat(file);assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs);
});

test('a user Figma-assigned manifest ID survives repeated preparation and a new service port without needless rewrites',async t=>{
  const f=await fixture(t),prepared=await f.service.preparePlugin(),manifestPath=prepared.manifestPath,manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  assert.equal(manifest.id,'m0-local-figma-bridge');manifest.id='1234567890123456789';await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');const before=await fs.stat(manifestPath),codeBefore=await fs.stat(path.join(prepared.pluginDirectory,'code.js'));
  await new Promise(resolve=>setTimeout(resolve,5));await f.service.preparePlugin();await f.request('metadata');const same=await fs.stat(manifestPath);assert.equal(same.ino,before.ino);assert.equal(same.mtimeMs,before.mtimeMs);assert.equal(JSON.parse(await fs.readFile(manifestPath,'utf8')).id,manifest.id);
  const restarted=createFigmaBridge({dataDir:f.dataDir,port:4999,resolveProject:id=>f.projects.get(String(id))});t.after(()=>restarted.close());await restarted.preparePlugin();
  const changed=JSON.parse(await fs.readFile(manifestPath,'utf8'));assert.equal(changed.id,manifest.id);assert.deepEqual(changed.networkAccess.allowedDomains,['http://127.0.0.1:4999','http://localhost:4999']);assert.match(await fs.readFile(path.join(prepared.pluginDirectory,'ui.html'),'utf8'),/http:\/\/127\.0\.0\.1:4999/);const codeAfter=await fs.stat(path.join(prepared.pluginDirectory,'code.js'));assert.equal(codeAfter.ino,codeBefore.ino);assert.equal(codeAfter.mtimeMs,codeBefore.mtimeMs);
  const portChanged=await fs.stat(manifestPath);await new Promise(resolve=>setTimeout(resolve,5));await Promise.all([restarted.preparePlugin(),restarted.preparePlugin()]);const stable=await fs.stat(manifestPath);assert.equal(stable.ino,portChanged.ino);assert.equal(stable.mtimeMs,portChanged.mtimeMs);
});

test('actual plugin UI pairs, polls the local HTTP queue, executes the VM scene and posts a native receipt',async t=>{
  const f=await fixture(t),p=plugin(),ui=await createPluginUiHarness({plugin:p,baseUrl:f.origin}),created=(await f.request('pair',{action:'create',projectId:1})).data;await ui.pair(created.code);
  async function until(action){for(let count=0;count<100;count++){const value=await action();if(value)return value;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Plugin UI timeout: '+ui.log)}
  const context=await until(async()=>{try{return await f.service.getContext({projectId:1,fileKey:FILE,sessionId:p.id})}catch{}});assert.match(ui.status,/已配对/);
  const promise=f.service.execute({projectId:1,fileKey:FILE,sessionId:p.id,selectionRevision:context.selectionRevision,type:'patch-nodes',targets:[{nodeId:'1:1',expectedType:'TEXT',patches:[{kind:'replace-text',value:'UI → HTTP → Plugin → ack'}]}]});await new Promise(resolve=>setTimeout(resolve,2));await ui.tick();const result=await promise;assert.equal(result.ok,true);assert.equal(p.text.characters,'UI → HTTP → Plugin → ack');assert.equal(p.undos,1);assert.equal(ui.errors.length,0);assert.ok(p.storage.size);
  const fresh=await f.service.getContext({projectId:1,fileKey:FILE,sessionId:p.id});assert.ok(fresh.selectionRevision>context.selectionRevision,'selection upload precedes final ack');
  assert.equal(result.result.selectionRevision,fresh.selectionRevision);
  const next=f.service.execute({projectId:1,fileKey:FILE,sessionId:p.id,selectionRevision:result.result.selectionRevision,type:'patch-nodes',targets:[{nodeId:'1:1',expectedType:'TEXT',patches:[{kind:'resize',width:{mode:'absolute',value:240},height:{mode:'absolute',value:120}},{kind:'move',x:{mode:'absolute',value:50},y:{mode:'delta',value:15}}]}]});await new Promise(resolve=>setTimeout(resolve,2));await ui.tick();const resized=await next;assert.equal(resized.ok,true);assert.equal(p.text.width,240);assert.equal(p.text.height,120);assert.equal(p.text.x,50);assert.equal(p.text.y,35);assert.equal(p.undos,2);assert.ok(resized.result.selectionRevision>result.result.selectionRevision);
  const persisted=[...p.storage.values()][0];assert.equal(persisted.fileKey,FILE);assert.ok(!ui.log.includes(persisted.token));
});

test('native creation, explicit selection and context commands use the bound current file and revision',async()=>{
  const p=plugin();let current=p.snapshot();const frame=await p.execute({id:'frame-create',fileKey:FILE,sessionId:p.id,selectionRevision:current.revision,type:'create-frame',name:'Created frame',width:320,height:240,x:20,y:30});assert.equal(frame.ok,true);assert.equal(p.nodes.get(frame.nodeId).width,320);assert.equal(p.undos,1);
  current=p.snapshot();const text=await p.execute({id:'text-create',fileKey:FILE,sessionId:p.id,selectionRevision:current.revision,type:'create-text',name:'Created text',characters:'真实文本',fontSize:24,parentId:frame.nodeId});assert.equal(text.ok,true);assert.equal(p.nodes.get(text.nodeId).characters,'真实文本');assert.equal(p.nodes.get(text.nodeId).parent.id,frame.nodeId);assert.equal(p.undos,2);
  const select=await p.execute({id:'select',fileKey:FILE,sessionId:p.id,type:'select-node',nodeId:'1:1'});assert.equal(select.ok,true);assert.equal(p.page.selection[0].id,'1:1');const context=await p.execute({id:'context',fileKey:FILE,sessionId:p.id,type:'read-context'});assert.equal(context.data.content.nodes[0].id,'1:1');assert.equal(context.data.content.fileKey,FILE);
});

test('lost UI acknowledgement retries the same command receipt without repeating the Figma mutation',async t=>{
  const f=await fixture(t,{leaseMs:5}),p=plugin();let lost=true;const ui=await createPluginUiHarness({plugin:p,baseUrl:f.origin,fetchImpl:async(url,options)=>{if(String(url).endsWith('/ack')&&lost){lost=false;return new Response(JSON.stringify({error:'simulated lost receipt'}),{status:502,headers:{'content-type':'application/json'}})}return fetch(url,options)}});
  const code=(await f.request('pair',{action:'create',projectId:1})).data.code;await ui.pair(code);await new Promise(resolve=>setTimeout(resolve,5));const context=await f.service.getContext({projectId:1,fileKey:FILE,sessionId:p.id});
  const promise=f.service.execute({projectId:1,fileKey:FILE,sessionId:p.id,selectionRevision:context.selectionRevision,type:'patch-nodes',targets:[{nodeId:'1:1',expectedType:'TEXT',patches:[{kind:'replace-text',value:'First execution'}]}]});await new Promise(resolve=>setTimeout(resolve,2));await ui.tick();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(p.undos,1);p.text.characters='Peer change after execution';await ui.tick();const result=await promise;assert.equal(result.ok,true);assert.equal(p.undos,1);assert.equal(p.text.characters,'Peer change after execution');assert.match(ui.log,/回执提交失败/);
});

test('cancelled in-flight commands keep late native receipts separate and never resurrect a successful promise',async t=>{
  const f=await fixture(t),pair=await f.pair(),controller=new AbortController(),promise=f.service.execute({projectId:1,fileKey:FILE,sessionId:SESSION,type:'get-node',nodeId:'1:1',signal:controller.signal});await new Promise(resolve=>setTimeout(resolve,2));const command=(await f.pull(pair)).data.commands[0];controller.abort();await assert.rejects(promise,error=>error.status===499);
  assert.equal((await f.request('ack',{fileKey:FILE,sessionId:SESSION,results:[receipt(command,{changedNodeIds:[],data:{format:'JSON_REST_V1',content:{document:{id:'1:1'}}}})]},{plugin:true,token:pair.token})).status,200);
  const result=(await f.request('results/'+command.id+'?projectId=1&fileKey='+FILE+'&sessionId='+SESSION)).data;assert.equal(result.status,'cancelled');assert.equal(result.result,undefined);assert.equal(result.lateResult.ok,true);
});
