'use strict';
// Reproduce the native navigation race without Electron or a GUI. A resolved
// loadURL promise is deliberately independent of the target's commit events.
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {navigateAndWait}=require('../desktop/local-navigation.cjs');
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const target='http://127.0.0.1:4317/__local/settings';
function mockContents(){
  const contents=new EventEmitter();
  let current='http://127.0.0.1:4317/aicode-v2?id=1',loading=false;
  contents.getURL=()=>current;contents.isDestroyed=()=>false;contents.isLoadingMainFrame=()=>loading;
  contents.loadURL=async url=>{assert.equal(url,target);loading=true;};
  contents.commit=url=>{current=url;loading=true;contents.emit('did-navigate',{},url,200,'OK');};
  contents.finish=()=>{loading=false;contents.emit('did-finish-load');};
  return contents;
}

test('early loadURL resolution cannot complete navigation before the target commits and finishes',async()=>{
  const contents=mockContents();let settled=false;
  const navigation=navigateAndWait(contents,target,{timeoutMs:1000});navigation.then(()=>settled=true);
  await nextTurn();assert.equal(settled,false,'the stale old page is still active despite loadURL resolving');
  contents.emit('did-navigate',{},'http://127.0.0.1:4317/home',200,'OK');contents.finish();
  await nextTurn();assert.equal(settled,false,'old or unrelated load events must not settle the target request');
  contents.commit(target);await nextTurn();assert.equal(settled,false,'target commit still waits for its completion');
  contents.finish();await navigation;assert.equal(settled,true);assert.deepEqual(contents.eventNames(),[],'successful navigation removes all temporary listeners');
});

test('a failed target main-frame load rejects while unrelated and subframe failures are ignored',async()=>{
  const contents=mockContents();let settled=false;
  const navigation=navigateAndWait(contents,target,{timeoutMs:1000});navigation.then(()=>settled=true,()=>settled=true);
  contents.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','http://127.0.0.1:4317/old',true);
  contents.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED',target,false);
  await nextTurn();assert.equal(settled,false);
  const failure=assert.rejects(navigation,error=>error instanceof Error);
  contents.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED',target,true);
  await failure;assert.deepEqual(contents.eventNames(),[],'failed navigation removes all temporary listeners');
});

test('timeout rejects a navigation without commit and cleans every listener',async()=>{
  const contents=mockContents();
  await assert.rejects(navigateAndWait(contents,target,{timeoutMs:20}),/timed?\s*out|timeout|超时/i);
  assert.deepEqual(contents.eventNames(),[]);
  // Late lifecycle events after timeout have no remaining transaction handler.
  contents.commit(target);contents.finish();assert.deepEqual(contents.eventNames(),[]);
});
