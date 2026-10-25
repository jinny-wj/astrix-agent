import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createFigmaBridge} from '../../../网页端/workbench/server/figma-bridge.mjs';
import {createPluginHarness,createPluginUiHarness} from '../../../网页端/workbench/figma-plugin-bridge/test-harness.mjs';

const FILE='MultiEndpointFile_123',delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const canonicalOrigin=value=>{const url=new URL(value);if(url.hostname==='localhost')url.hostname='127.0.0.1';return url.origin;};
async function until(action){for(let count=0;count<200;count++){const value=await action();if(value)return value;await delay(5);}throw Error('Multi-endpoint fixture did not settle');}
async function endpoint(t,projectId){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-bridge-endpoint-')),workspace=path.join(directory,'project');await fs.mkdir(workspace);
  let service;
  const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res,new URL(req.url,'http://127.0.0.1'))){res.statusCode=404;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,origin='http://127.0.0.1:'+port;
  service=createFigmaBridge({dataDir:path.join(directory,'data'),port,resolveProject:id=>String(id)===String(projectId)?{id:projectId,projectPath:workspace}:null,commandTimeoutMs:3000});
  t.after(async()=>{service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  async function request(route,body,token){const response=await fetch(origin+'/__local/figma/bridge/'+route,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{origin:'null',authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
  async function code(){return (await request('pair',{action:'create',projectId})).data.code;}
  const context=plugin=>service.getContext({projectId,fileKey:FILE,sessionId:plugin.id}).catch(()=>null);
  return {origin,port,projectId,directory,service,request,code,context};
}

test('prepared plugin allows only the two fixed loopback services and its current custom port',async t=>{
  const one=await endpoint(t,1),prepared=await one.service.preparePlugin();
  const expected=[4317,5273,one.port];
  const manifest=JSON.parse(await fs.readFile(prepared.manifestPath,'utf8'));
  assert.deepEqual(manifest.networkAccess.allowedDomains,['none']);
  assert.deepEqual(manifest.networkAccess.devAllowedDomains,expected.map(port=>'http://localhost:'+port));
  const template=JSON.parse(await fs.readFile(new URL('../../../网页端/workbench/figma-plugin-bridge/manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(template.networkAccess.allowedDomains,['none']);assert.deepEqual(template.networkAccess.devAllowedDomains,['http://localhost:4317','http://localhost:5273']);
  assert.deepEqual(prepared.endpoints,expected.map(port=>'http://127.0.0.1:'+port));
  const html=await fs.readFile(path.join(prepared.pluginDirectory,'ui.html'),'utf8');
  assert.ok(html.includes('globalThis.__ASTRIX_BRIDGE_ENDPOINTS__='+JSON.stringify(prepared.endpoints)));
  assert.equal(html.includes('<!-- ASTRIX_BRIDGE_ENDPOINTS -->'),false);
  assert.throws(()=>createFigmaBridge({dataDir:one.directory,port:'443/remote.example'}),/local port/);
});

test('one plugin independently pairs two projects and fans out the same real fixture selection',async t=>{
  const one=await endpoint(t,1),two=await endpoint(t,2),plugin=createPluginHarness(FILE);
  const ui=await createPluginUiHarness({plugin,baseUrl:one.origin,endpoints:[one.origin,two.origin]});
  const wrong=await two.request('pair',{code:await one.code(),fileKey:FILE,sessionId:plugin.id});assert.equal(wrong.status,403);
  await ui.pair(await one.code());await ui.pair(await two.code(),{endpoint:two.origin});
  const initial=await until(async()=>{const contexts=await Promise.all([one.context(plugin),two.context(plugin)]);return contexts.every(Boolean)&&contexts;});
  assert.equal(initial[0].projectId,'1');assert.equal(initial[1].projectId,'2');assert.equal(initial[0].sessionId,initial[1].sessionId);
  plugin.page.selection=[plugin.frame];plugin.publish();
  const current=await until(async()=>{const contexts=await Promise.all([one.context(plugin),two.context(plugin)]);return contexts.every(context=>context?.nodes[0]?.id===plugin.frame.id)&&contexts;});
  assert.equal(current[0].selectionRevision,current[1].selectionRevision);
  const saved=plugin.storage.get('astrix-figma-bridge-pairings-v2');assert.equal(saved.version,2);assert.deepEqual(Object.keys(saved.endpoints).sort(),[one.origin,two.origin].sort());
  assert.ok(ui.requests.length>0&&ui.requests.every(value=>new URL(value).hostname==='localhost'),'actual HTTP transport must match the development manifest, while stored origins remain compatible');
  assert.notEqual(saved.endpoints[one.origin].token,saved.endpoints[two.origin].token);
  const leaked=await two.request('pull?'+new URLSearchParams({fileKey:FILE,sessionId:plugin.id}),undefined,saved.endpoints[one.origin].token);assert.equal(leaked.status,403);
  assert.ok(!ui.log.includes(saved.endpoints[one.origin].token));assert.equal(ui.errors.length,0);
  const reopened=createPluginHarness(FILE,{storage:plugin.storage});
  const resumed=await createPluginUiHarness({plugin:reopened,baseUrl:one.origin,endpoints:[one.origin,two.origin]});
  await until(async()=>(await one.context(reopened))&&(await two.context(reopened)));
  const restored=plugin.storage.get('astrix-figma-bridge-pairings-v2');
  assert.deepEqual(Object.keys(restored.endpoints).sort(),[one.origin,two.origin].sort());
  assert.equal(restored.endpoints[one.origin].sessionId,reopened.id);assert.equal(restored.endpoints[two.origin].sessionId,reopened.id);assert.equal(resumed.errors.length,0);
});

test('each endpoint pull and acknowledgement returns only to its originating local service',async t=>{
  const one=await endpoint(t,1),two=await endpoint(t,2),plugin=createPluginHarness(FILE),traffic=[];
  const ui=await createPluginUiHarness({plugin,baseUrl:one.origin,endpoints:[one.origin,two.origin],fetchImpl:async(url,options)=>{const target=new URL(url);if(target.pathname.endsWith('/ack'))traffic.push({origin:canonicalOrigin(target),ids:JSON.parse(options.body).results.map(result=>result.id)});return fetch(url,options);}});
  await ui.pair(await one.code());await ui.pair(await two.code(),{endpoint:two.origin});await until(async()=>(await one.context(plugin))&&(await two.context(plugin)));
  const first=one.service.execute({projectId:1,fileKey:FILE,sessionId:plugin.id,type:'get-node',nodeId:plugin.text.id}),second=two.service.execute({projectId:2,fileKey:FILE,sessionId:plugin.id,type:'get-node',nodeId:plugin.frame.id});
  const results=Promise.all([first,second]);await delay(5);await ui.tick();const [a,b]=await results;
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  assert.ok(traffic.some(item=>item.origin===one.origin&&item.ids.includes(a.id)));
  assert.ok(traffic.some(item=>item.origin===two.origin&&item.ids.includes(b.id)));
  assert.ok(traffic.every(item=>item.ids.every(id=>item.origin===one.origin?id!==b.id:id!==a.id)));
  assert.equal(ui.errors.length,0);
});

test('a blocked endpoint does not hold another endpoint selection, pull or receipt',async t=>{
  const one=await endpoint(t,1),two=await endpoint(t,2),plugin=createPluginHarness(FILE);let block=false,release;
  const blocked=new Promise(resolve=>release=resolve);
  t.after(()=>release());
  const ui=await createPluginUiHarness({plugin,baseUrl:one.origin,endpoints:[one.origin,two.origin],fetchImpl:async(url,options)=>{if(block&&canonicalOrigin(url)===one.origin)await blocked;return fetch(url,options);}});
  await ui.pair(await one.code());await ui.pair(await two.code(),{endpoint:two.origin});await until(async()=>(await one.context(plugin))&&(await two.context(plugin)));
  block=true;plugin.page.selection=[plugin.frame];plugin.publish();
  await until(async()=>{const current=await two.context(plugin);return current?.nodes[0]?.id===plugin.frame.id;});
  const promise=two.service.execute({projectId:2,fileKey:FILE,sessionId:plugin.id,type:'get-node',nodeId:plugin.frame.id});
  await delay(5);const tick=ui.tick();
  const completed=await Promise.race([promise,delay(750).then(()=>{throw Error('Healthy endpoint was blocked by its peer');})]);
  assert.equal(completed.ok,true);release();await tick;assert.equal(ui.errors.length,0);
});

test('old single-endpoint storage resumes into v2 without replacing an independent second pairing',async t=>{
  const one=await endpoint(t,1),two=await endpoint(t,2),storage=new Map(),first=createPluginHarness(FILE,{storage});
  const paired=await one.request('pair',{code:await one.code(),fileKey:FILE,sessionId:first.id});assert.equal(paired.status,200);
  storage.set('m0-local-figma-bridge-v1',{...paired.data,base:one.origin,fileKey:FILE,sessionId:first.id});
  const plugin=createPluginHarness(FILE,{storage}),ui=await createPluginUiHarness({plugin,baseUrl:one.origin,endpoints:[one.origin,two.origin]});
  await until(()=>one.context(plugin));await ui.pair(await two.code(),{endpoint:two.origin});await until(()=>two.context(plugin));
  const migrated=storage.get('astrix-figma-bridge-pairings-v2');assert.equal(migrated.version,2);assert.deepEqual(Object.keys(migrated.endpoints).sort(),[one.origin,two.origin].sort());
  await ui.disconnect({endpoint:one.origin});await until(()=>!storage.get('astrix-figma-bridge-pairings-v2').endpoints[one.origin]);assert.ok(storage.get('astrix-figma-bridge-pairings-v2').endpoints[two.origin]);
  const fresh=createPluginHarness(FILE,{storage}),reopened=await createPluginUiHarness({plugin:fresh,baseUrl:one.origin,endpoints:[one.origin,two.origin]});
  await until(()=>two.context(fresh));assert.equal(await one.context(fresh),null);assert.equal(reopened.errors.length,0);
});

test('plugin startup, pairing and selection fanout never write document metadata or scene nodes',async t=>{
  const one=await endpoint(t,1),two=await endpoint(t,2),plugin=createPluginHarness(FILE);
  const scene=()=>JSON.stringify([...plugin.nodes.values()].map(node=>({id:node.id,type:node.type,name:node.name,characters:node.characters,x:node.x,y:node.y,width:node.width,height:node.height,fills:node.fills,children:node.children.map(child=>child.id)})));
  const before=scene();assert.deepEqual(plugin.documentWrites,{relaunchData:0,createFrame:0,createText:0,commitUndo:0});
  const ui=await createPluginUiHarness({plugin,baseUrl:one.origin,endpoints:[one.origin,two.origin]});
  await ui.pair(await one.code());await ui.pair(await two.code(),{endpoint:two.origin});plugin.publish();
  await until(async()=>(await one.context(plugin))&&(await two.context(plugin)));await ui.tick();
  assert.deepEqual(plugin.documentWrites,{relaunchData:0,createFrame:0,createText:0,commitUndo:0});assert.equal(scene(),before);assert.equal(plugin.page.selection[0].id,plugin.text.id);
});

test('identical command IDs from different origins do not share their cached execution result',async()=>{
  const plugin=createPluginHarness(FILE),command={id:'same-id',fileKey:FILE,sessionId:plugin.id,type:'get-node'};
  for(const [connectionId,dispatchId,nodeId] of [['http://127.0.0.1:4317','one',plugin.text.id],['http://127.0.0.1:5273','two',plugin.frame.id]])await plugin.figma.ui.onmessage({type:'apply-commands',connectionId,dispatchId,commands:[{...command,nodeId}]});
  const receipts=plugin.messages.filter(message=>message.type==='ack-results');
  assert.equal(receipts[0].results[0].data.content.document.id,plugin.text.id);assert.equal(receipts[1].results[0].data.content.document.id,plugin.frame.id);
  assert.equal(receipts[0].connectionId,'http://127.0.0.1:4317');assert.equal(receipts[1].connectionId,'http://127.0.0.1:5273');
});

test('disconnect cancels its queued scene batch while the other origin still completes',async()=>{
  const plugin=createPluginHarness(FILE),snapshot=plugin.snapshot(),getNode=plugin.figma.getNodeByIdAsync;let release,started=false;
  const gate=new Promise(resolve=>release=resolve);
  plugin.figma.getNodeByIdAsync=async id=>{if(id===plugin.text.id&&!started){started=true;await gate;}return getNode(id);};
  const base={fileKey:FILE,sessionId:plugin.id},one='http://127.0.0.1:4317',two='http://127.0.0.1:5273';
  const running=plugin.figma.ui.onmessage({type:'apply-commands',connectionId:one,dispatchId:'running',commands:[{...base,id:'read-before-disconnect',type:'get-node',nodeId:plugin.text.id}]});
  await until(()=>started);
  const cancelled=plugin.figma.ui.onmessage({type:'apply-commands',connectionId:one,dispatchId:'cancelled',commands:[{...base,id:'must-not-write',type:'patch-nodes',selectionRevision:snapshot.revision,targets:[{nodeId:plugin.text.id,expectedType:'TEXT',patches:[{kind:'replace-text',value:'Must not execute'}]}]}]});
  const independent=plugin.figma.ui.onmessage({type:'apply-commands',connectionId:two,dispatchId:'independent',commands:[{...base,id:'independent-read',type:'get-node',nodeId:plugin.frame.id}]});
  await plugin.figma.ui.onmessage({type:'cancel-connection',connectionId:one});release();await Promise.all([running,cancelled,independent]);
  const skipped=plugin.messages.find(message=>message.dispatchId==='cancelled'),receipt=plugin.messages.find(message=>message.dispatchId==='independent');
  assert.equal(skipped.results.length,0);assert.equal(receipt.results[0].ok,true);assert.equal(plugin.text.characters,'Initial');assert.equal(plugin.undos,0);
});

test('official top-frame envelopes pair both services and fan out the actual fixture selection',async t=>{
  const one=await endpoint(t,1),two=await endpoint(t,2),plugin=createPluginHarness(FILE),ui=await createPluginUiHarness({plugin,baseUrl:one.origin,endpoints:[one.origin,two.origin],hostEnvelope:'top'});
  assert.equal(ui.elements.get('document-status').textContent,'Real file fixture');
  await ui.pair(await one.code());await ui.pair(await two.code(),{endpoint:two.origin});
  await until(async()=>(await one.context(plugin))&&(await two.context(plugin)));
  plugin.page.selection=[plugin.frame];plugin.publish();
  await until(async()=>{const contexts=await Promise.all([one.context(plugin),two.context(plugin)]);return contexts.every(context=>context?.nodes[0]?.id===plugin.frame.id);});
  assert.equal(ui.errors.length,0);assert.deepEqual(plugin.documentWrites,{relaunchData:0,createFrame:0,createText:0,commitUndo:0});
});

test('a top sender needs the exact official origin and that origin never substitutes for window identity',async t=>{
  const one=await endpoint(t,1),plugin=createPluginHarness(FILE),ui=await createPluginUiHarness({plugin,baseUrl:one.origin,hostEnvelope:'top'});await ui.pair(await one.code());
  const initial=await until(()=>one.context(plugin)),spoof={...plugin.snapshot(),documentName:'Must not replace the document',nodes:[{id:plugin.frame.id,type:'FRAME'}]};
  for(const sender of [{sender:'top',origin:'https://www.figma.com.evil.invalid'},{sender:'top',origin:'https://figma.com'},{sender:'top',origin:'null'},{sender:'other',origin:'https://www.figma.com'},{sender:'null',origin:'https://www.figma.com'}])assert.doesNotThrow(()=>ui.deliver({type:'selection-snapshot',snapshot:spoof},sender));
  await ui.tick();const current=await one.context(plugin);assert.equal(current.selectionRevision,initial.selectionRevision);assert.equal(current.nodes[0].id,plugin.text.id);assert.equal(ui.elements.get('document-status').textContent,'Real file fixture');assert.equal(ui.errors.length,0);
});

test('malformed trusted wrappers and selection schemas cannot crash the UI or replace live context',async t=>{
  const one=await endpoint(t,1),plugin=createPluginHarness(FILE),ui=await createPluginUiHarness({plugin,baseUrl:one.origin,hostEnvelope:'top'});await ui.pair(await one.code());const initial=await until(()=>one.context(plugin));
  for(const value of [null,undefined,[],{},'invalid',{pluginMessage:null},{pluginMessage:[]},{pluginMessage:'invalid'},{pluginMessage:{type:7}}])assert.doesNotThrow(()=>ui.deliver(value,{wrapped:false}));
  const valid={...plugin.snapshot(),documentName:'Must not replace the document'};
  for(const snapshot of [null,[],{}, {...valid,nodes:{}},{...valid,sessionId:8},{...valid,revision:-1},{...valid,revision:1.5},{...valid,revision:Number.MAX_SAFE_INTEGER+1},{...valid,fileKey:{}}])assert.doesNotThrow(()=>ui.deliver({type:'selection-snapshot',snapshot}));
  await ui.tick();const current=await one.context(plugin);assert.equal(current.selectionRevision,initial.selectionRevision);assert.equal(current.nodes[0].id,plugin.text.id);assert.equal(ui.elements.get('document-status').textContent,'Real file fixture');assert.equal(ui.errors.length,0);
});
