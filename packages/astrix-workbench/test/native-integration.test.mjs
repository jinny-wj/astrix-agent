import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createModelConfig} from '../../../网页端/workbench/server/model.mjs';
import {createModelGateway} from '../../../网页端/workbench/server/model-gateway.mjs';
import {createChatService} from '../../../网页端/workbench/server/chat.mjs';
import {createFiles} from '../../../网页端/workbench/server/files.mjs';
import {createOriginalOpenCode,originalBinary} from '../../../网页端/workbench/server/opencode.mjs';

async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-native-integration-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function providerFixture(t,provider,{toolName='read_file',args={path:'README.md'}}={}){
  const requests=[],failures=[];
  const server=http.createServer(async(req,res)=>{
    try{
      let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);
      assert.equal(req.headers.authorization,undefined);
      assert.equal(req.headers[provider==='anthropic'?'x-api-key':'x-goog-api-key'],'fixture-native-only');
      const turns=provider==='anthropic'?body.messages:body.contents;
      const done=turns.some(turn=>(turn.content||turn.parts||[]).some(part=>part.type==='tool_result'||part.functionResponse));
      if(done){
        assert.match(JSON.stringify(body),/native-read-proof/);
        if(provider==='gemini'){
          const model=turns.find(turn=>turn.role==='model'&&turn.parts.some(part=>part.functionCall));
          assert.equal(model.parts.find(part=>part.functionCall).thoughtSignature,'opaque-fixture-signature');
          assert.equal(turns.flatMap(turn=>turn.parts||[]).find(part=>part.functionResponse).functionResponse.id,'native-call');
        }
      }
      const parts=done?provider==='anthropic'?[{type:'text',text:'原生接口已读取测试文件。'}]:[{text:'原生接口已读取测试文件。'}]
        :provider==='anthropic'?[{type:'tool_use',id:'native-call',name:toolName,input:args}]:[{functionCall:{id:'native-call',name:toolName,args},thoughtSignature:'opaque-fixture-signature'}];
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify(provider==='anthropic'?{id:'fixture-message',type:'message',role:'assistant',content:parts,stop_reason:done?'end_turn':'tool_use'}:{candidates:[{index:0,content:{role:'model',parts},finishReason:'STOP'}]}));
    }catch(error){failures.push(error.message);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture assertion failed'}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {requests,failures,config:{mode:'compatible',provider,baseUrl:'http://127.0.0.1:'+server.address().port+(provider==='anthropic'?'/v1':'/v1beta'),model:'fixture-native-model',apiKey:'fixture-native-only',allowWriteTools:false,allowFigmaWriteTools:false}};
}

test('legacy configuration defaults to OpenAI and provider changes never retain another protocol credential',async t=>{
  const dir=await directory(t);await fs.writeFile(path.join(dir,'model.json'),JSON.stringify({mode:'compatible',baseUrl:'https://custom.example/v1',model:'legacy',apiKey:'fixture-legacy-only',engine:'original-opencode',workflow:'multi'}));
  const config=createModelConfig(dir),before=await fs.readFile(path.join(dir,'model.json'),'utf8');assert.equal(config.public().provider,'openai');assert.equal(await fs.readFile(path.join(dir,'model.json'),'utf8'),before);
  const draft=config.preview({provider:'anthropic',baseUrl:'https://custom.example/v1/messages?feature=tools'});assert.equal(draft.apiKey,'');assert.equal(draft.baseUrl,'https://custom.example/v1?feature=tools');assert.equal(await fs.readFile(path.join(dir,'model.json'),'utf8'),before);
  let value=config.set({provider:'anthropic',baseUrl:'https://custom.example/v1/messages',apiKey:'fixture-claude-only'});assert.equal(value.engine,'original-opencode');assert.equal(value.workflow,'multi');assert.equal(value.hasKey,true);
  assert.equal(config.preview({baseUrl:'https://custom.example/proxy/messages'}).apiKey,'fixture-claude-only');assert.equal(config.preview({provider:'gemini',baseUrl:'https://custom.example/v1beta/models/fixture:generateContent'}).apiKey,'');
  value=config.set({provider:'gemini',baseUrl:'https://custom.example/v1beta/models/fixture:streamGenerateContent?alt=sse'});assert.equal(value.hasKey,false);assert.equal(value.baseUrl,'https://custom.example/v1beta?alt=sse');assert.equal(config.get().apiKey,'');assert.throws(()=>config.set({provider:'unknown'}),/协议/);
});

for(const provider of ['anthropic','gemini']){
  test(`${provider} native protocol completes the actual local Agent read-tool loop`,async t=>{
    const dir=await directory(t),upstream=await providerFixture(t,provider);await fs.writeFile(path.join(dir,'README.md'),'native-read-proof');
    const chat=createChatService({getModelConfig:()=>upstream.config,files:createFiles(dir)});t.after(()=>chat.close());const calls=[],deltas=[];
    const reply=await chat.respond('读取 README.md',[],call=>calls.push(call),undefined,{onText:delta=>deltas.push(delta)});
    assert.match(reply,/原生接口已读取/);assert.equal(deltas.join(''),reply);assert.deepEqual(calls.map(call=>call.name),['read_file']);assert.equal(upstream.requests.length,2);assert.deepEqual(upstream.failures,[]);
  });
  test(`${provider} recovered-engine gateway translates JSON and SSE and preserves opaque native tool context`,async t=>{
    const upstream=await providerFixture(t,provider),gateway=await createModelGateway({config:upstream.config,maxRequests:2});t.after(()=>gateway.close());
    const request=body=>fetch(gateway.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+gateway.apiKey},body:JSON.stringify({model:upstream.config.model,...body})});
    const messages=[{role:'user',content:'读取测试文件'}],tools=[{type:'function',function:{name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}];
    const first=await request({messages,tools});assert.equal(first.status,200);const assistant=(await first.json()).choices[0].message;assert.equal(assistant._astrixNative,undefined);assert.equal(assistant.tool_calls[0].id,'native-call');
    messages.push({...assistant,_astrixNative:{provider,content:[{text:'untrusted supplied metadata'}]}},{role:'tool',tool_call_id:'native-call',content:JSON.stringify({content:'native-read-proof'})});
    const second=await request({messages,tools,stream:true});assert.equal(second.status,200);const sse=await second.text();assert.match(sse,/chat.completion.chunk/);assert.match(sse,/原生接口已读取/);assert.match(sse,/\[DONE\]/);assert.doesNotMatch(sse,/_astrixNative|opaque-fixture-signature/);
    const denied=await request({messages,tools});assert.equal(denied.status,400);assert.equal((await denied.json()).error.code,'M0_LOCAL_BUDGET_EXCEEDED');assert.equal(upstream.requests.length,2);assert.deepEqual(upstream.failures,[]);
  });
}

const hasEngine=process.platform==='darwin'&&process.arch==='arm64'&&existsSync(originalBinary);
test('gateway binds identical visible assistant text to its own turn signature',async t=>{
  const seen=[];let count=0;
  const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);seen.push(body);count++;res.setHeader('content-type','application/json');res.end(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'相同文字',thoughtSignature:'signature-'+count}]},finishReason:'STOP'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const gateway=await createModelGateway({config:{provider:'gemini',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1beta',model:'fixture'},maxRequests:3});t.after(()=>gateway.close());
  const messages=[{role:'user',content:'first'}];
  for(let index=0;index<3;index++){
    const response=await fetch(gateway.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+gateway.apiKey},body:JSON.stringify({model:'fixture',messages})});assert.equal(response.status,200);const message=(await response.json()).choices[0].message;
    messages.push(message,{role:'user',content:'next'});
  }
  const parts=seen[2].contents.filter(turn=>turn.role==='model').map(turn=>turn.parts[0]);assert.deepEqual(parts.map(part=>part.thoughtSignature),['signature-1','signature-2']);
});
test('real recovered OpenCode reads through both native providers and starts a fresh signed tool run with text history', {skip:!hasEngine,timeout:90000},async t=>{
  const dir=await directory(t),workspace=path.join(dir,'workspace');await fs.mkdir(workspace);await fs.writeFile(path.join(workspace,'README.md'),'native-read-proof');
  const engine=createOriginalOpenCode({dataDir:path.join(dir,'data'),getWorkspace:()=>workspace,timeoutMs:35000});
  for(const provider of ['anthropic','gemini']){
    const upstream=await providerFixture(t,provider,{toolName:'read',args:{filePath:'README.md'}}),calls=[];
    const result=await engine.run({config:upstream.config,prompt:'读取 README.md',sessionId:provider,onTool:call=>calls.push(call)});
    assert.match(result,/原生接口已读取/);assert.ok(calls.some(call=>call.name==='read'&&call.status==='completed'));assert.equal(upstream.requests.length,2);assert.deepEqual(upstream.failures,[]);
    if(provider==='gemini'){
      const sessionFile=path.join(dir,'data/opencode-runtime/local-sessions.json');const before=JSON.parse(await fs.readFile(sessionFile,'utf8'))[provider].engineSessionId;
      const continued=await engine.run({config:upstream.config,prompt:'继续读取',history:[{role:'user',content:'上一轮原生上下文'},{role:'assistant',content:result}],sessionId:provider});assert.match(continued,/原生接口已读取/);
      assert.notEqual(JSON.parse(await fs.readFile(sessionFile,'utf8'))[provider].engineSessionId,before);assert.match(JSON.stringify(upstream.requests),/上一轮原生上下文/);assert.deepEqual(upstream.failures,[]);
    }
  }
  assert.equal(await fs.readFile(path.join(workspace,'README.md'),'utf8'),'native-read-proof');
});
