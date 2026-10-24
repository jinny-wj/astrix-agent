import test from 'node:test';
import assert from 'node:assert/strict';
import {CollaborationState} from './collaboration-state.mjs';
import {diffDocuments,applyOperations} from './collab-model.mjs';
import {emptyDocument,createNode,findNodeAllPages,validateDocument} from './model.mjs';

const copy=value=>structuredClone(value);
const node=document=>findNodeAllPages(document,'text').node;
function initial(){const document=emptyDocument('State fixture');document.pages[0].nodes=[{...createNode('text'),id:'text',text:'initial',fill:'#000000'}];return validateDocument(document);}
const snapshot=(document,revision='r0',seq=0)=>({document,revision,seq});
const event=(before,after,baseRevision,revision,seq,mutationId)=>({type:'document',baseRevision,revision,seq,ops:diffDocuments(before,after),mutationId});

test('remote independent fields merge with a retained local pending edit',()=>{
  const base=initial(),state=new CollaborationState(snapshot(base)),local=copy(base),remote=copy(base);node(local).fill='#ff0000';node(remote).text='peer text';state.changed(base,local);
  state.event(event(base,remote,'r0','r1',1,'peer-mutation'));
  assert.equal(node(state.view()).fill,'#ff0000');assert.equal(node(state.view()).text,'peer text');assert.equal(state.pending.length,1);assert.deepEqual(state.conflicts,[]);
});

test('same-field conflict preserves the exact local draft while retaining the canonical peer version',()=>{
  const base=initial(),state=new CollaborationState(snapshot(base)),local=copy(base),remote=copy(base);node(local).text='unsynced local draft';node(remote).text='peer winner';state.changed(base,local);
  state.event(event(base,remote,'r0','r1',1,'peer-mutation'));
  assert.ok(state.conflicts.some(conflict=>conflict.path[0]==='text'));assert.equal(node(state.view()).text,'unsynced local draft');assert.equal(node(state.base.document).text,'peer winner');assert.equal(state.pending.length,1);
});

test('SSE acknowledgement before an older HTTP acknowledgement never rolls back newer remote edits',()=>{
  const base=initial(),state=new CollaborationState(snapshot(base)),first=copy(base);node(first).text='own accepted';const own=state.changed(base,first);
  state.event(event(base,first,'r0','r1',1,own.mutationId));assert.equal(state.pending.length,0);
  const local=copy(first);node(local).fill='#ff0000';const pending=state.changed(first,local);
  const remote=copy(first);node(remote).text='peer newer';state.event(event(first,remote,'r1','r2',2,'peer-mutation'));
  state.acknowledge(snapshot(first,'r1',1),own.mutationId);
  assert.equal(state.base.revision,'r2');assert.equal(node(state.view()).text,'peer newer');assert.equal(node(state.view()).fill,'#ff0000');assert.equal(state.pending[0].mutationId,pending.mutationId);
});

test('undo operations revert only the local fields and preserve a peer independent change',()=>{
  const base=initial(),state=new CollaborationState(snapshot(base)),local=copy(base);node(local).fill='#ff0000';const own=state.changed(base,local);state.acknowledge(snapshot(local,'r1',1),own.mutationId);
  const peer=copy(local);node(peer).text='must survive undo';state.event(event(local,peer,'r1','r2',2,'peer-mutation'));
  const inverse=state.undoStack.at(-1).inverse,result=applyOperations(state.base.document,inverse);assert.deepEqual(result.conflicts,[]);
  const undo=state.queue(inverse,'undo');state.acknowledge(snapshot(result.document,'r3',3),undo.mutationId);
  assert.equal(node(state.view()).fill,'#000000');assert.equal(node(state.view()).text,'must survive undo');
});

test('reconnect snapshot containing a mutation with a lost acknowledgement is idempotent even with peer inserts',()=>{
  const base=initial(),state=new CollaborationState(snapshot(base)),local=copy(base);local.pages[0].nodes.push({...createNode('rectangle'),id:'own-shape'});const own=state.changed(base,local);
  const server=copy(local);server.pages[0].nodes.push({...createNode('ellipse'),id:'peer-shape'});
  state.snapshot(snapshot(server,'r2',2));assert.deepEqual(state.conflicts,[]);assert.equal(state.view().pages[0].nodes.length,3);assert.equal(state.pending.length,1);
  const retry=applyOperations(server,own.ops);assert.deepEqual(retry.conflicts,[]);assert.equal(retry.applied,0);
  state.acknowledge(snapshot(server,'r2',2),own.mutationId);assert.equal(state.pending.length,0);assert.equal(state.view().pages[0].nodes.length,3);
});

test('a late proof of own acknowledgement clears only its derived rebase conflict',()=>{
  const base=initial(),state=new CollaborationState(snapshot(base)),local=copy(base);node(local).text='own accepted but ack lost';const own=state.changed(base,local);
  const newer=copy(local);node(newer).text='peer changed it after own acceptance';state.snapshot(snapshot(newer,'r2',2));assert.ok(state.conflicts.length);
  state.event(event(base,local,'r0','r1',1,own.mutationId));
  assert.equal(state.pending.length,0);assert.deepEqual(state.conflicts,[]);assert.equal(node(state.view()).text,'peer changed it after own acceptance');
});

test('an own receipt in a reconnect snapshot clears a lost acknowledgement before rebasing later peer writes',()=>{
  const base=initial(),state=new CollaborationState(snapshot(base)),local=copy(base);node(local).text='own accepted';const own=state.changed(base,local);
  const peer=copy(local);node(peer).text='peer later same-field write';
  state.snapshot({...snapshot(peer,'r2',2),acknowledgedMutationIds:[own.mutationId]});
  assert.equal(state.pending.length,0);assert.deepEqual(state.conflicts,[]);assert.equal(node(state.view()).text,'peer later same-field write');
});

test('a new room epoch accepts a lower sequence, rebases drafts and rejects late responses from the retired epoch',()=>{
  const base=initial(),state=new CollaborationState({...snapshot(base,'old-r10',10),epoch:'before-restart'}),local=copy(base);node(local).fill='#ff0000';const pending=state.changed(base,local);
  const restarted=copy(base);node(restarted).text='saved after restart';state.snapshot({...snapshot(restarted,'new-r1',1),epoch:'after-restart'});
  assert.equal(state.base.epoch,'after-restart');assert.equal(state.base.seq,1);assert.equal(node(state.view()).text,'saved after restart');assert.equal(node(state.view()).fill,'#ff0000');assert.equal(state.pending.length,1);
  state.acknowledge({...snapshot(local,'old-r11',11),epoch:'before-restart'},pending.mutationId);
  state.snapshot({...snapshot(local,'old-r12',12),epoch:'before-restart',acknowledgedMutationIds:[pending.mutationId]});
  state.event({...event(base,local,'old-r10','old-r11',11,pending.mutationId),epoch:'before-restart'});
  state.reject({current:{...snapshot(local,'old-r12',12),epoch:'before-restart'},conflicts:[{reason:'stale-error'}]},local);
  assert.equal(state.base.epoch,'after-restart');assert.equal(state.base.revision,'new-r1');assert.equal(state.pending.length,1);assert.deepEqual(state.conflicts,[]);assert.equal(node(state.view()).text,'saved after restart');
  const applied=applyOperations(restarted,pending.ops);state.acknowledge({...snapshot(applied.document,'new-r2',2),epoch:'after-restart'},pending.mutationId);assert.equal(state.pending.length,0);assert.equal(node(state.view()).text,'saved after restart');
});

test('an unexpected new epoch event requests a snapshot without interpreting its sequence as old history',()=>{
  const base=initial(),state=new CollaborationState({...snapshot(base,'r5',5),epoch:'old'}),changed=copy(base);node(changed).text='new server';
  assert.deepEqual(state.event({...event(base,changed,'r5','r6',1),epoch:'new'}),{needsResync:true});assert.equal(state.base.epoch,'old');assert.equal(node(state.view()).text,'initial');
});
