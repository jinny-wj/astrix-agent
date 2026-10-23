import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createCanvasService} from '../server/canvas.mjs';
import {createCanvasCollaboration} from '../server/canvas-collaboration.mjs';
import {emptyDocument,createNode,createPage,findNodeAllPages,validateDocument,convertNodeToPath} from '../canvas/model.mjs';
import {diffDocuments,applyOperations} from '../canvas/collab-model.mjs';
import {CollaborationState} from '../canvas/collaboration-state.mjs';

const copy=value=>structuredClone(value),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const node=(document,id)=>findNodeAllPages(document,id).node;
function document(){const value=emptyDocument('协作测试'),frame={...createNode('frame'),id:'frame',children:[{...createNode('text'),id:'text',text:'initial'}]};value.pages[0].nodes=[frame];return validateDocument(value);}
async function fixture(t,{blank=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-collab-test-')),dataDir=path.join(directory,'data');
  const projects=[{id:1,projectPath:path.join(directory,'one')},{id:2,projectPath:path.join(directory,'two')}];for(const item of projects)await fs.mkdir(item.projectPath);
  let workspace=projects[0].projectPath;const api={state:{projects},findProject:id=>projects.find(item=>String(item.id)===String(id))};
  const canvas=createCanvasService({api,getWorkspace:()=>workspace});
  if(!blank)await canvas.save(await canvas.target(1),{document:document(),expectedRevision:null});
  const options={dataDir,resolveWorkspace:canvas.target,readCanvas:canvas.read,transactCanvas:canvas.transact,subscribeCanvas:canvas.subscribe,pollMs:50};
  let collaboration=createCanvasCollaboration(options);
  const server=http.createServer(async(req,res)=>{try{let text='';for await(const chunk of req)text+=chunk;if(!await collaboration.handle(req,res,new URL(req.url,'http://127.0.0.1'),text?JSON.parse(text):{})){res.statusCode=404;res.end();}}catch(error){res.statusCode=error.status||400;res.end(JSON.stringify({error:error.message}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await collaboration.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  async function request(route,body,method=body?'POST':'GET',base=origin){const response=await fetch(base+'/__local/collaboration/'+route,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
  const join=async body=>{const result=await request('join',{projectId:1,...body});assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
  const ops=async(client,before,after,id=randomUUID(),extra={})=>request('ops',{sessionToken:client.sessionToken,mutationId:id,baseRevision:client.revision,ops:diffDocuments(before,after),...extra});
  async function stream(client,since){
    const abort=new AbortController(),received=[];let wake=()=>{},failure;
    const response=await fetch(origin+client.eventsUrl+(since===undefined?'':'&since='+since),{signal:abort.signal});assert.equal(response.status,200);
    const pump=(async()=>{try{let buffer='';const decoder=new TextDecoder();for await(const bytes of response.body){buffer+=decoder.decode(bytes,{stream:true});let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);for(const line of block.split('\n'))if(line.startsWith('data:')){received.push(JSON.parse(line.slice(5)));wake();}}}}catch(error){if(!abort.signal.aborted)failure=error;wake();}})();
    t.after(()=>{abort.abort();return pump;});
    async function wait(predicate,timeout=2000){const started=performance.now();while(performance.now()-started<timeout){const event=received.find(predicate);if(event)return event;if(failure)throw failure;await new Promise(resolve=>{const timer=setTimeout(resolve,Math.min(50,timeout));wake=()=>{clearTimeout(timer);resolve();};});}throw Error('SSE event timeout: '+predicate);}
    return {received,wait,async close(){abort.abort();await pump;},get seq(){return received.at(-1)?.seq??client.seq;}};
  }
  return {directory,dataDir,projects,canvas,request,join,ops,stream,get collaboration(){return collaboration;},origin,setWorkspace:value=>workspace=value,async restart(){await collaboration.close();collaboration=createCanvasCollaboration(options);}};
}

test('real concurrent users merge different fields and same-page insertions without losing either shape',async t=>{
  const f=await fixture(t),alice=await f.join({name:'Alice'}),invite=(await f.request('invites',{sessionToken:alice.sessionToken,role:'editor'})).data,bob=await f.join({invite:invite.invite,name:'Bob'});
  const base=alice.document,a=copy(base),b=copy(base);node(a,'text').fill='#ff0000';node(b,'text').text='Bob changed text';
  a.pages[0].nodes.push({...createNode('rectangle'),id:'alice-shape'});b.pages[0].nodes.push({...createNode('ellipse'),id:'bob-shape'});
  const results=await Promise.all([f.ops(alice,base,a),f.ops(bob,base,b)]);assert.deepEqual(results.map(item=>item.status),[200,200]);
  const current=(await f.request('state?sessionToken='+alice.sessionToken)).data;
  assert.equal(node(current.document,'text').fill,'#ff0000');assert.equal(node(current.document,'text').text,'Bob changed text');
  assert.ok(findNodeAllPages(current.document,'alice-shape'));assert.ok(findNodeAllPages(current.document,'bob-shape'));
  assert.equal(current.document.pages[0].nodes.length,3);assert.equal((await f.canvas.read(await f.canvas.target(1))).revision,current.revision);
});

test('same-field conflicts reject an atomic batch, viewers cannot write and mutation retries are idempotent',async t=>{
  const f=await fixture(t),owner=await f.join(),editorInvite=(await f.request('invites',{sessionToken:owner.sessionToken,role:'editor'})).data,editor=await f.join({invite:editorInvite.invite}),viewerInvite=(await f.request('invites',{sessionToken:owner.sessionToken,role:'viewer'})).data,viewer=await f.join({invite:viewerInvite.invite});
  const base=owner.document,a=copy(base),b=copy(base);node(a,'text').text='first';node(b,'text').text='stale-second';node(b,'text').fill='#00ff00';
  const mutationId=randomUUID();assert.equal((await f.ops(owner,base,a,mutationId)).status,200);
  const conflict=await f.ops(editor,base,b);assert.equal(conflict.status,409);assert.ok(conflict.data.conflicts.some(item=>item.reason==='field-changed'));assert.equal(node(conflict.data.current.document,'text').fill,node(base,'text').fill);
  assert.equal((await f.ops(viewer,base,b)).status,403);
  const retry=await f.ops(owner,base,a,mutationId);assert.equal(retry.status,200);assert.equal(retry.data.duplicate,true);
  assert.equal((await f.ops(owner,base,b,mutationId)).status,409);
  assert.equal((await f.ops(owner,base,b,randomUUID(),{projectId:2})).status,403);
});

test('delete guards preserve another user child edits and explicit structural reorder conflicts are detected',async t=>{
  const f=await fixture(t),a=await f.join(),b=await f.join(),base=a.document,edited=copy(base),removed=copy(base);
  node(edited,'text').text='remote child edit';removed.pages[0].nodes=[];
  assert.equal((await f.ops(a,base,edited)).status,200);const conflict=await f.ops(b,base,removed);assert.equal(conflict.status,409);assert.ok(conflict.data.conflicts.some(item=>item.reason==='entity-changed-before-delete'));assert.equal(node(conflict.data.current.document,'text').text,'remote child edit');
  const ordered=document();ordered.pages[0].nodes.push({...createNode('rectangle'),id:'two'},{...createNode('rectangle'),id:'three'});const one=copy(ordered),two=copy(ordered);one.pages[0].nodes.reverse();two.pages[0].nodes=[two.pages[0].nodes[1],two.pages[0].nodes[0],two.pages[0].nodes[2]];
  assert.ok(applyOperations(one,diffDocuments(ordered,two)).conflicts.length>0);
  const malicious=[{type:'set',entity:'node',id:'text',path:['__proto__','polluted'],before:null,after:true}];assert.ok(applyOperations(ordered,malicious).conflicts.length);assert.equal({}.polluted,undefined);
});

test('SSE reports presence and replays real updates after an interrupted stream',async t=>{
  const f=await fixture(t),alice=await f.join({name:'Alice'}),bob=await f.join({name:'Bob'}),first=await f.stream(alice),peer=await f.stream(bob);
  await first.wait(event=>event.type==='snapshot');await peer.wait(event=>event.type==='snapshot');
  const pageId=alice.document.pages[0].id;await f.request('presence',{sessionToken:bob.sessionToken,pageId,cursor:{x:30,y:40},selection:['text']});
  const presence=await first.wait(event=>event.type==='presence'&&event.participants.some(item=>item.clientId===bob.clientId&&item.cursor?.x===30));assert.equal(presence.participants.find(item=>item.clientId===bob.clientId).online,true);
  const since=first.seq;await first.close();
  const next=copy(alice.document);node(next,'text').text='while Alice disconnected';assert.equal((await f.ops(bob,alice.document,next)).status,200);
  const reconnected=await f.stream(alice,since),event=await reconnected.wait(event=>event.type==='document');assert.ok(event.seq>since);assert.equal(node(applyOperations(alice.document,event.ops).document,'text').text,'while Alice disconnected');
  await f.request('leave',{sessionToken:bob.sessionToken});await reconnected.wait(event=>event.type==='left'&&event.clientId===bob.clientId);assert.equal((await f.request('state?sessionToken='+bob.sessionToken)).status,403);
});

test('ordinary canvas saves, restores and raw file edits broadcast normalized canonical changes',async t=>{
  const f=await fixture(t),owner=await f.join(),stream=await f.stream(owner);await stream.wait(event=>event.type==='snapshot');
  const context=await f.canvas.target(1),restored=copy(owner.document);restored.name='snapshot restore';await f.canvas.save(context,{document:restored,expectedRevision:owner.revision},{source:'cloud-restore'});
  const saveEvent=await stream.wait(event=>event.type==='document'&&event.source==='cloud-restore');assert.equal(applyOperations(owner.document,saveEvent.ops).document.name,'snapshot restore');
  const external=copy(restored);external.name='external editor change';await fs.writeFile(path.join(context.workspace,'canvas.json'),JSON.stringify(external));
  const event=await stream.wait(event=>event.type==='document'&&event.source==='external'&&event.baseRevision===saveEvent.revision);assert.equal(applyOperations(restored,event.ops).document.name,'external editor change');
});

test('invitation revocation closes active streams, rejects rejoin and stays effective after restart',async t=>{
  const f=await fixture(t),owner=await f.join(),invite=(await f.request('invites',{sessionToken:owner.sessionToken,role:'editor'})).data,guest=await f.join({invite:invite.invite}),stream=await f.stream(guest);await stream.wait(event=>event.type==='snapshot');
  assert.equal((await f.request('invites/'+invite.id,{sessionToken:guest.sessionToken},'DELETE')).status,403);
  assert.equal((await f.request('invites/'+invite.id,{sessionToken:owner.sessionToken},'DELETE')).status,200);await stream.wait(event=>event.type==='revoked');
  assert.equal((await f.request('state?sessionToken='+guest.sessionToken)).status,403);assert.equal((await f.request('join',{invite:invite.invite})).status,403);
  const persisted=await fs.readFile(path.join(f.dataDir,'canvas-collaboration','invites.json'),'utf8');assert.ok(!persisted.includes(invite.invite),'only invite hashes are persisted');
  await f.restart();assert.equal((await f.request('join',{invite:invite.invite})).status,403);assert.equal((await f.request('join',{projectId:1})).status,200);
});

test('initial blank rooms are initialized once, existing documents and captured projects are never overwritten by joins',async t=>{
  const f=await fixture(t,{blank:true}),draft=document();draft.name='first draft';
  const created=await f.request('rooms',{projectId:1,document:draft,expectedRevision:null});assert.equal(created.status,201);assert.equal(created.data.document.name,'first draft');
  const other=copy(draft);other.name='must not replace';assert.equal((await f.request('rooms',{projectId:1,document:other,expectedRevision:null})).data.document.name,'first draft');
  const owner=await f.join();f.setWorkspace(f.projects[1].projectPath);const change=copy(owner.document);change.name='captured original project';assert.equal((await f.ops(owner,owner.document,change)).status,200);
  assert.equal((await f.canvas.read(await f.canvas.target(1))).document.name,'captured original project');assert.equal((await f.canvas.read(await f.canvas.target(2))).document,null);
  assert.equal((await f.request('rooms',{workspaceKey:owner.workspaceKey,expectedRevision:null})).status,409);
});

test('opt-in gateway exposes only static canvas and invited sessions, with no local model/file/admin routes',async t=>{
  const f=await fixture(t),owner=await f.join(),invite=(await f.request('invites',{sessionToken:owner.sessionToken,role:'viewer'})).data;
  assert.equal(f.collaboration.gatewayStatus().enabled,false);
  const [one,two]=await Promise.all([f.collaboration.startGateway({host:'127.0.0.1'}),f.collaboration.startGateway({host:'127.0.0.1'})]);assert.equal(one.port,two.port);const origin='http://127.0.0.1:'+one.port;
  const html=await fetch(origin+'/local-canvas/index.html');assert.equal(html.status,200);assert.match(await html.text(),/canvas|画布|design/i);
  for(const route of ['/__local/model','/__local/file?path=README.md','/__local/canvas','/__local/design-cloud/api/state'])assert.equal((await fetch(origin+route)).status,404,route);
  assert.equal((await f.request('join',{projectId:1},'POST',origin)).status,403);
  const guest=await f.request('join',{invite:invite.invite,name:'LAN Guest'},'POST',origin);assert.equal(guest.status,200);assert.equal(guest.data.role,'viewer');
  assert.equal((await f.request('invites',{sessionToken:guest.data.sessionToken,role:'editor'},'POST',origin)).status,403);
  assert.equal((await fetch(origin+'/__local/collaboration/capabilities',{headers:{Origin:'http://evil.example'}})).status,403);
  assert.equal((await fetch(origin+'/local-canvas/%2e%2e%2f%2e%2e%2fserver/model.mjs')).status,403);
  await f.collaboration.stopGateway();assert.equal(f.collaboration.gatewayStatus().enabled,false);
});

test('expired invites stop already open streams, while duplicated browser client IDs stay distinct',async t=>{
  const f=await fixture(t);let clock=Date.now();t.mock.method(Date,'now',()=>clock);
  const owner=await f.join({clientId:'cloned-tab'}),other=await f.join({clientId:'cloned-tab'});assert.notEqual(owner.clientId,other.clientId);
  const invite=(await f.request('invites',{sessionToken:owner.sessionToken,role:'viewer',expiresInSeconds:60})).data,guest=await f.join({invite:invite.invite}),stream=await f.stream(guest);await stream.wait(event=>event.type==='snapshot');
  clock+=61000;await stream.wait(event=>event.type==='revoked');
  assert.equal((await f.request('state?sessionToken='+guest.sessionToken)).status,403);assert.equal((await f.request('join',{invite:invite.invite})).status,403);assert.equal((await f.request('state?sessionToken='+owner.sessionToken)).status,200);
});

test('reconnect beyond the bounded event history receives a fresh canonical snapshot',async t=>{
  const f=await fixture(t),owner=await f.join();
  for(let i=0;i<270;i++)await f.collaboration.presence({sessionToken:owner.sessionToken,pointer:{x:i,y:20},selectedIds:['text']});
  const stream=await f.stream(owner,owner.seq),reset=await stream.wait(event=>event.type==='snapshot');assert.equal(reset.reset,true);assert.ok(reset.seq>256);
  const participant=reset.participants.find(item=>item.clientId===owner.clientId);assert.equal(participant.pointer.x,269);assert.deepEqual(participant.selectedIds,['text']);
});

test('external deletion blocks writes without resurrecting the file, and recovery resynchronizes clients',async t=>{
  const f=await fixture(t),owner=await f.join(),stream=await f.stream(owner);await stream.wait(event=>event.type==='snapshot');
  const file=path.join(f.projects[0].projectPath,'canvas.json');await fs.unlink(file);await stream.wait(event=>event.type==='sync-error'&&event.message.includes('删除'));
  const draft=copy(owner.document);draft.name='must stay a draft';assert.equal((await f.ops(owner,owner.document,draft)).status,409);await assert.rejects(fs.access(file));
  const recovered=copy(owner.document);recovered.name='external recovery';await fs.writeFile(file,JSON.stringify(recovered));const reset=await stream.wait(event=>event.type==='snapshot'&&event.document.name==='external recovery');assert.equal(reset.reset,true);
});

test('tree merge preserves independent pages/subtrees, rejects double parents and leaves rejected batches unchanged',()=>{
  const base=document(),a=copy(base),b=copy(base),page=createPage('Peer page');page.id='peer-page';page.nodes=[{...createNode('rectangle'),id:'peer-root'}];a.pages.push(page);
  node(b,'frame').children.push({...createNode('group'),id:'local-group',children:[{...createNode('ellipse'),id:'nested-child'}]});
  const combined=applyOperations(a,diffDocuments(base,b));assert.deepEqual(combined.conflicts,[]);assert.ok(findNodeAllPages(combined.document,'peer-root'));assert.ok(findNodeAllPages(combined.document,'nested-child'));
  const movable=copy(combined.document);movable.pages[0].nodes.push({...createNode('frame'),id:'destination'});const left=copy(movable),right=copy(movable);
  node(left,'frame').children=node(left,'frame').children.filter(child=>child.id!=='text');node(left,'destination').children.push(copy(node(movable,'text')));
  node(right,'frame').children=node(right,'frame').children.filter(child=>child.id!=='text');right.pages[1].nodes.push(copy(node(movable,'text')));
  assert.ok(applyOperations(left,diffDocuments(movable,right)).conflicts.length,'concurrent moves cannot leave the same ID under two parents');
  const bad=[{type:'set',entity:'node',id:'frame',path:['layout','gap'],before:node(base,'frame').layout.gap,after:99},{type:'set',entity:'node',id:'frame',path:['children'],before:['text'],after:['missing-node']}];
  const rejected=applyOperations(base,bad);assert.ok(rejected.conflicts.length);assert.equal(node(rejected.document,'frame').layout.gap,node(base,'frame').layout.gap);assert.equal(rejected.applied,0);
});

test('optional vector path fields survive JSON transport and complex geometry stays an atomic field',()=>{
  const base=document();base.pages[0].nodes.push({...createNode('rectangle'),id:'convert-me'});const converted=copy(base);convertNodeToPath(converted,'convert-me');
  const transported=JSON.parse(JSON.stringify(diffDocuments(base,converted))),pathOp=transported.find(op=>op.id==='convert-me'&&op.path?.[0]==='path');assert.equal(pathOp.beforeExists,false);
  const result=applyOperations(base,transported);assert.deepEqual(result.conflicts,[]);assert.equal(node(result.document,'convert-me').type,'path');assert.ok(node(result.document,'convert-me').path.contours.length);
  const changed=copy(result.document);node(changed,'convert-me').path.contours[0].points[0].x+=5;
  const ops=diffDocuments(result.document,changed);assert.ok(ops.some(op=>op.path?.length===1&&op.path[0]==='path'));assert.ok(!ops.some(op=>op.path?.length>2));
});

test('a lost HTTP acknowledgement recovers from a private receipt after history eviction and a later peer write',async t=>{
  const f=await fixture(t),owner=await f.join(),peer=await f.join(),state=new CollaborationState(owner),local=copy(owner.document);node(local,'text').text='own accepted';const own=state.changed(owner.document,local);
  // The HTTP request really commits, but the client discards the entire body.
  const response=await fetch(f.origin+'/__local/collaboration/ops',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionToken:owner.sessionToken,mutationId:own.mutationId,ops:own.ops})});assert.equal(response.status,200);await response.body.cancel();
  const current=(await f.request('state?sessionToken='+peer.sessionToken)).data,next=copy(current.document);node(next,'text').text='peer later same-field write';const peerMutation=randomUUID();assert.equal((await f.ops(peer,current.document,next,peerMutation)).status,200);
  for(let i=0;i<270;i++)await f.collaboration.presence({sessionToken:peer.sessionToken,pointer:{x:i,y:0}});
  const stream=await f.stream(owner,owner.seq),recovered=await stream.wait(event=>event.type==='snapshot');assert.ok(recovered.acknowledgedMutationIds.includes(own.mutationId));assert.ok(!recovered.acknowledgedMutationIds.includes(peerMutation));
  state.snapshot(recovered);assert.equal(state.pending.length,0);assert.deepEqual(state.conflicts,[]);assert.equal(node(state.view(),'text').text,'peer later same-field write');
  const resumed=(await f.request('join',{sessionToken:owner.sessionToken})).data;assert.ok(resumed.acknowledgedMutationIds.includes(own.mutationId));
  const peerState=(await f.request('state?sessionToken='+peer.sessionToken)).data;assert.ok(peerState.acknowledgedMutationIds.includes(peerMutation));assert.ok(!peerState.acknowledgedMutationIds.includes(own.mutationId));
});

test('server restart changes the room epoch and a lower sequence still restores the canonical state with pending edits',async t=>{
  const f=await fixture(t),owner=await f.join(),state=new CollaborationState(owner);
  for(let i=0;i<12;i++)await f.collaboration.presence({sessionToken:owner.sessionToken,pointer:{x:i,y:0}});
  const latest=(await f.request('state?sessionToken='+owner.sessionToken)).data;state.snapshot(latest);
  const draft=copy(latest.document);node(draft,'text').fill='#ff0000';const action=state.changed(latest.document,draft);
  const externallySaved=copy(latest.document);node(externallySaved,'text').text='new durable text';await f.canvas.save(await f.canvas.target(1),{document:externallySaved,expectedRevision:latest.revision});
  await f.restart();const resumed=await f.join();assert.equal(resumed.roomId,owner.roomId);assert.notEqual(resumed.epoch,owner.epoch);assert.ok(resumed.seq<latest.seq);
  state.snapshot(resumed);assert.equal(state.base.epoch,resumed.epoch);assert.equal(node(state.view(),'text').text,'new durable text');assert.equal(node(state.view(),'text').fill,'#ff0000');assert.equal(state.pending.length,1);
  state.acknowledge({...latest,document:draft},action.mutationId);assert.equal(state.pending.length,1);assert.equal(state.base.epoch,resumed.epoch);
  const result=await f.request('ops',{sessionToken:resumed.sessionToken,mutationId:action.mutationId,ops:action.ops});assert.equal(result.status,200);assert.equal(result.data.epoch,resumed.epoch);state.acknowledge(result.data,action.mutationId);assert.equal(state.pending.length,0);
  const stream=await f.stream(resumed),snapshot=await stream.wait(event=>event.type==='snapshot');assert.equal(snapshot.epoch,resumed.epoch);const peer=await f.join();await stream.wait(event=>event.type==='joined'&&event.epoch===resumed.epoch&&event.participant.clientId===peer.clientId);
});
