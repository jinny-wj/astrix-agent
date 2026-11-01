import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createChatService} from '../../../网页端/workbench/server/chat.mjs';
import {createM0Api} from '../../../网页端/workbench/server/m0-api.mjs';
import {beginConversationTurn,createConversationStore,knownMissingQuestions,resolvedTaskPrompt} from '../../../网页端/workbench/server/conversations.mjs';

async function fixture(t,handler,{mode='compatible'}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-conversation-'));
  const workspace=path.join(directory,'workspace'),dataDir=path.join(directory,'state');await fs.mkdir(workspace);
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const requests=[];
  const modelServer=http.createServer(async(req,res)=>{
    let input='';for await(const chunk of req)input+=chunk;
    const body=JSON.parse(input);requests.push(body);
    try{const message=await handler(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',...message}}]}));}
    catch(error){res.writeHead(500);res.end(error.message);}
  });
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{modelServer.closeAllConnections();modelServer.close(resolve);}));
  const config={mode,provider:'openai',model:'mock-only',baseUrl:`http://127.0.0.1:${modelServer.address().port}/v1`,allowWriteTools:true};
  let chat,api;
  function restart(){chat?.close();chat=createChatService({getModelConfig:()=>config,getWorkspace:()=>workspace,dataDir});api=createM0Api({dataDir,workspaceRoot:workspace});}
  restart();const project=api.createProject({projectName:'test',projectPath:workspace});
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;
      const body=raw?JSON.parse(raw):{};
      if(await chat.handleConversationRoute(req,res,url,body,api))return;
      await chat.handle({req,res,url,body,api});
    }catch(error){res.writeHead(error.status||400,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{chat.close();return new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function post(body){const response=await fetch(base+'/__local/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'session-a',projectId:project.id,...body})});const raw=await response.text();return {status:response.status,raw,events:raw.split('\n\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)))};}
  async function get(session='session-a',projectId=project.id){const response=await fetch(base+'/__local/conversations/'+session+'?projectId='+projectId);return {status:response.status,data:await response.json()};}
  return {post,get,requests,restart,directory,workspace,base,project,config,get api(){return api;}};
}
const assess=body=>body.messages[0].content.includes('需求预检器');
const ready=()=>({content:JSON.stringify({ready:true,questions:[]})});
const question=()=>({content:JSON.stringify({ready:false,questions:[{id:'date',prompt:'活动日期保留还是更新？',required:true}]})});
const write=()=>({content:null,tool_calls:[{id:'write-once',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'result.txt',content:'mock-task-proof'})}}]});

test('clarification survives restart and resumes original task before one actual mock write',async t=>{
  let writes=0;
  const f=await fixture(t,body=>{
    if(assess(body)){
      assert.equal(body.tools,undefined);
      const input=JSON.parse(body.messages.at(-1).content);
      assert.equal(input.originalRequest,'整理秋季活动方案并保存 result.txt');
      if(!input.answers.length)return question();
      assert.equal(input.answers[0].answers.date,'日期不变');return ready();
    }
    assert.match(body.messages.at(-1).role==='tool'?body.messages.at(-2).tool_calls[0].function.name:body.messages.at(-1).content,/write_file|秋季活动/);
    if(!body.messages.some(message=>message.role==='tool')){writes++;return write();}
    return {content:'已按原任务保存模拟结果。'};
  });
  const first=await f.post({message:'整理秋季活动方案并保存 result.txt',requestId:'original'});
  const pending=first.events.find(event=>event.name==='local-clarification').value;
  assert.equal(writes,0);assert.equal(first.events.some(event=>event.name==='local-tool'),false);
  await assert.rejects(fs.stat(path.join(f.workspace,'result.txt')),{code:'ENOENT'});
  f.restart();const restored=await f.get();assert.equal(restored.data.pending.id,pending.id);assert.equal(restored.data.status,'awaiting_user');assert.equal(restored.data.messages.length,2);
  const body={message:'日期不变',requestId:'answer',clarificationAnswer:{id:pending.id,answers:{date:'日期不变'}}};
  const second=await f.post(body);assert.equal(second.status,200);assert.equal(writes,1);assert.equal(await fs.readFile(path.join(f.workspace,'result.txt'),'utf8'),'mock-task-proof');
  assert.equal((await f.get()).data.taskId,pending.taskId);assert.equal((await f.get()).data.status,'completed');
  const count=f.requests.length;await f.post(body);assert.equal(f.requests.length,count);assert.equal(writes,1);assert.equal((await f.get()).data.messages.length,4);
});

test('wrong/partial answers, project mismatch and concurrent requests cannot execute',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);let block=false;
  const f=await fixture(t,async body=>{if(block)await gate;return question();});
  const initial=await f.post({message:'规划活动'});const pending=initial.events.find(event=>event.name==='local-clarification').value;
  const count=f.requests.length;
  assert.equal((await f.post({message:'回答',clarificationAnswer:{id:'wrong',answers:{date:'明天'}}})).status,409);
  assert.equal((await f.post({message:'回答',clarificationAnswer:{id:pending.id,answers:{}}})).status,400);
  assert.equal(f.requests.length,count);assert.equal((await f.get('session-a',999)).status,409);
  block=true;const first=f.post({message:'日期不变'});
  while(f.requests.length===count)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await f.post({message:'日期不变'})).status,400);
  release();await first;
});

test('plain replies remain on the original task across more than one clarification',async t=>{
  const f=await fixture(t,body=>{
    if(!assess(body))return {content:'模拟完成'};
    const input=JSON.parse(body.messages.at(-1).content);
    if(!input.answers.length)return question();
    if(input.answers.length===1)return {content:JSON.stringify({ready:false,questions:[{id:'title',prompt:'新的活动名称是什么？'}]})};
    assert.equal(input.answers[0].message,'日期不变');assert.equal(input.answers[1].message,'秋日盛典');return ready();
  });
  const first=await f.post({message:'整理活动文案'});const original=first.events.find(event=>event.name==='local-clarification').value;
  await f.post({message:'日期不变'});const middle=(await f.get()).data;assert.equal(middle.taskId,original.taskId);assert.notEqual(middle.pending.id,original.id);
  await f.post({message:'秋日盛典'});assert.equal((await f.get()).data.status,'completed');assert.equal((await f.get()).data.originalRequest,'整理活动文案');
});

test('demo mode asks deterministic missing input and saves ready state without any model request',async t=>{
  const f=await fixture(t,()=>{throw Error('must not call model');},{mode:'demo'});
  await f.post({message:'给我做一张战报'});assert.equal((await f.get()).data.status,'awaiting_user');
  await f.post({message:'3027'});assert.equal((await f.get()).data.status,'ready');assert.equal(f.requests.length,0);
  const response=await fetch(f.base+'/__local/conversations/session-a/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:f.project.id})});assert.equal((await response.json()).status,'cancelled');
});

test('invalid assessment is fail-closed, and a new task replaces pending context explicitly',async t=>{
  const f=await fixture(t,()=>({content:'已准备好，开始执行吧'}));
  const response=await f.post({message:'写入文件'});assert.equal(response.events.some(event=>event.type==='RUN_ERROR'),true);assert.equal(response.events.some(event=>event.name==='local-tool'),false);
  const second=await f.post({message:'讨论新的方向',newTask:true});assert.equal((await f.get()).data.originalRequest,'讨论新的方向');assert.equal(second.events.some(event=>event.type==='RUN_ERROR'),true);
});

test('captured file/selection is not replaced by an answer from a different target',()=>{
  const context={fileKey:'file-a',sessionId:'bridge-a',selectionRevision:1,targetNodeIds:['1:2']};
  const first=beginConversationTurn(null,{sessionId:'a',projectId:1,workspace:'/workspace',prompt:'修改选中图层',body:{figmaContext:context}}).record;
  first.status='awaiting_user';first.pending={id:'pending',questions:[{id:'color',prompt:'什么颜色？',required:true}]};
  assert.throws(()=>beginConversationTurn(first,{sessionId:'a',projectId:1,workspace:'/workspace',prompt:'红色',body:{figmaContext:{...context,fileKey:'file-b'}}}),/选区已变化/);
  assert.equal(first.task.context.figmaContext.fileKey,'file-a');
});

test('restart marks in-flight records interrupted while same process reads remain running',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-conversation-restart-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createConversationStore(directory);store.write({sessionId:'running',status:'running',task:{id:'task'}});
  assert.equal(store.read('running').status,'running');assert.equal(createConversationStore(directory).read('running').status,'interrupted');
});

test('execution retains original and supplemental attachment metadata across followups',()=>{
  const original={files:[{path:'assets/original.png',kind:'image'}]};
  let record=beginConversationTurn(null,{sessionId:'a',projectId:1,workspace:'/workspace',prompt:'制作活动方案',body:{attachmentContext:original}}).record;
  record.status='awaiting_user';record.pending={id:'pending',questions:[{id:'date',prompt:'日期？',required:true}]};
  record=beginConversationTurn(record,{sessionId:'a',projectId:1,workspace:'/workspace',prompt:'明天',body:{attachmentContext:{files:[{path:'assets/reference.png',kind:'image'}]}}}).record;
  assert.match(resolvedTaskPrompt(record.task),/assets\/original\.png/);assert.match(resolvedTaskPrompt(record.task),/assets\/reference\.png/);
  record.status='completed';
  record=beginConversationTurn(record,{sessionId:'a',projectId:1,workspace:'/workspace',prompt:'再解释一下方案',body:{}}).record;
  assert.equal(record.task.context.attachmentContext.files.length,2);
});

test('empty attachments cannot supply a KV, and consultation does not require an execution target',()=>{
  const task=source=>({originalRequest:source,answers:[],context:{attachmentContext:{attachments:[]}}});
  assert.equal(knownMissingQuestions(task('给我做资源位延展'))[0].id,'source');
  assert.deepEqual(knownMissingQuestions(task('解释如何把 Figma 图层改成红色')),[]);
  assert.deepEqual(knownMissingQuestions(task('资源位延展是什么，给我讲一下实现方式')),[]);
});

test('a disconnected request keeps its original task and cannot replay a reserved request ID',async t=>{
  let arrived,release;
  const started=new Promise(resolve=>arrived=resolve),gate=new Promise(resolve=>release=resolve);
  const f=await fixture(t,async()=>{arrived();await gate;return ready();});
  const body={sessionId:'session-a',projectId:f.project.id,message:'整理活动方案',requestId:'disconnect'};
  const response=await fetch(f.base+'/__local/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  await started;await response.body.cancel();release();
  let snapshot;
  for(let i=0;i<100;i++){snapshot=(await f.get()).data;if(snapshot.status==='interrupted')break;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.equal(snapshot.status,'interrupted');assert.equal(snapshot.originalRequest,'整理活动方案');
  const count=f.requests.length;await f.post(body);assert.equal(f.requests.length,count);
  f.config.mode='demo';await f.post({message:'继续',requestId:'resume-after-disconnect'});
  const resumed=(await f.get()).data;assert.equal(resumed.originalRequest,'整理活动方案');assert.equal(resumed.taskId,snapshot.taskId);assert.equal(resumed.status,'ready');
});
