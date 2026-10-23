import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {modelCompletion} from '../server/model.mjs';
import {createChatService} from '../server/chat.mjs';

async function mock(t,handler){
  const server=http.createServer(async(req,res)=>{
    let input='';for await(const chunk of req)input+=chunk;
    await handler(JSON.parse(input),req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {model:'test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`};
}
function events(res,deltas){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const text=deltas.map(delta=>'data: '+JSON.stringify({choices:[{index:0,delta}]})+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
  const bytes=Buffer.from(text);
  for(let i=0;i<bytes.length;i+=5)res.write(bytes.subarray(i,i+5));
  res.end();
}
test('model SSE decodes UTF-8 and assembles fragmented tool calls',async t=>{
  const config=await mock(t,(body,_req,res)=>{
    assert.equal(body.stream,true);
    events(res,[{content:'正在读取中文文件。'},{tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'read_',arguments:'{"pa'}}]},{tool_calls:[{index:0,function:{name:'file',arguments:'th":"README.md"}'}}]}]);
  });
  const deltas=[];
  const message=await modelCompletion(config,[{role:'user',content:'test'}],undefined,undefined,text=>deltas.push(text));
  assert.equal(deltas.join(''),'正在读取中文文件。');
  assert.deepEqual(message.tool_calls,[{id:'call-1',type:'function',function:{name:'read_file',arguments:'{"path":"README.md"}'}}]);
});
test('an active chat keeps its captured workspace when the user changes project',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-chat-workspace-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const workspaceA=path.join(directory,'a'),workspaceB=path.join(directory,'b');
  await fs.mkdir(workspaceA);await fs.mkdir(workspaceB);
  await fs.writeFile(path.join(workspaceA,'README.md'),'workspace-A-proof');
  await fs.writeFile(path.join(workspaceB,'README.md'),'workspace-B-proof');
  let current=workspaceA,requests=0;
  const model=await mock(t,(body,_req,res)=>{
    requests++;
    if(requests===1){
      current=workspaceB;
      return events(res,[{tool_calls:[{index:0,id:'read-1',type:'function',function:{name:'read_file',arguments:'{"path":"README.md"}'}}]}]);
    }
    assert.match(body.messages.find(message=>message.role==='tool').content,/workspace-A-proof/);
    events(res,[{content:'读取的是'},{content:'原项目。'}]);
  });
  const chat=createChatService({getModelConfig:()=>({...model,mode:'compatible',allowWriteTools:false}),getWorkspace:()=>current,dataDir:path.join(directory,'data'),files:{read:()=>{throw new Error('dynamic files must not be used');}}});
  const deltas=[];
  const result=await chat.respond('读取文件',[],()=>{},undefined,{workspace:workspaceA,onText:delta=>deltas.push(delta)});
  assert.equal(result,'读取的是原项目。');assert.equal(deltas.join(''),result);
  assert.equal(requests,2);assert.equal(current,workspaceB);
});
test('model request honors cancellation',async t=>{
  let requested;
  const arrived=new Promise(resolve=>requested=resolve);
  const config=await mock(t,(_body,_req,res)=>{
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n');
    requested();
  });
  const controller=new AbortController();
  const pending=modelCompletion(config,[{role:'user',content:'wait'}],undefined,controller.signal,()=>{});
  await arrived;controller.abort();
  await assert.rejects(pending,error=>error.name==='AbortError');
});
test('stopping during a tool prevents later tools in the same model batch from writing',async t=>{
  const model=await mock(t,(_body,_req,res)=>events(res,[{tool_calls:[
    {index:0,id:'read',type:'function',function:{name:'read_file',arguments:'{"path":"README.md"}'}},
    {index:1,id:'write',type:'function',function:{name:'write_file',arguments:'{"path":"new.txt","content":"must not write"}'}}
  ]}]));
  let started,release,writes=0;
  const reading=new Promise(resolve=>started=resolve);
  const gate=new Promise(resolve=>release=resolve);
  const chat=createChatService({getModelConfig:()=>({...model,mode:'compatible',allowWriteTools:true}),files:{read:async()=>{started();await gate;return{content:'read'};},write:()=>{writes++;}}});
  const controller=new AbortController();
  const pending=chat.respond('read then write',[],()=>{},controller.signal);
  await reading;controller.abort();release();
  await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(writes,0);
});
