import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createModelConfig} from '../../../网页端/workbench/server/model.mjs';
import {createWorkbenchApplication} from '../../../网页端/workbench/server/application.mjs';

async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-connections-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function application(t,options={}){
  const dir=await directory(t),dataDir=path.join(dir,'data'),app=createWorkbenchApplication({dataDir,workspaceRoot:path.join(dir,'workspace'),port:4317,...options});
  const server=http.createServer(app.handle);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();});
  const origin='http://127.0.0.1:'+server.address().port;
  async function request(route,body,method=body===undefined?'GET':'POST'){
    const response=await fetch(origin+route,{method,headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }
  return {dataDir,origin,request};
}

test('local Codex selection has its own optional model and preserves saved API and advanced settings',async t=>{
  const config=createModelConfig(await directory(t));
  config.set({mode:'compatible',provider:'anthropic',baseUrl:'https://example.test/v1',model:'claude-fixture',apiKey:'private-fixture',engine:'original-opencode',workflow:'multi',allowWriteTools:true});
  const draft=config.preview({mode:'codex',codexModel:''});assert.equal(draft.mode,'codex');assert.equal(config.get().mode,'compatible');
  const visible=config.set({mode:'codex',codexModel:''});assert.equal(visible.mode,'codex');assert.equal(visible.codexModel,'');assert.equal(visible.hasKey,true);assert.ok(!JSON.stringify(visible).includes('private-fixture'));
  assert.equal(config.get().model,'claude-fixture');assert.equal(config.get().apiKey,'private-fixture');assert.equal(config.get().engine,'original-opencode');assert.equal(config.get().workflow,'multi');assert.equal(config.get().allowWriteTools,true);
  assert.equal(config.set({codexModel:'gpt-fixture'}).codexModel,'gpt-fixture');
  for(const value of [false,'--bad','bad\nname','a'.repeat(129)])assert.throws(()=>config.set({codexModel:value}));
  const restored=config.set({mode:'compatible'});assert.equal(restored.model,'claude-fixture');assert.equal(config.get().apiKey,'private-fixture');
});

test('Codex status probes do not infer or mutate config; explicit draft tests use Codex without an API model',async t=>{
  let probes=0,inferences=0;
  const f=await application(t,{codexStatus:async()=>{probes++;return{installed:true,authenticated:true,authMethod:'chatgpt',ready:true,message:'ChatGPT 登录可用'};},modelCompletion:async config=>{inferences++;assert.equal(config.mode,'codex');assert.equal(config.codexModel,'');assert.equal(config.model,'');return{role:'assistant',content:'连接成功'};}});
  const result=await f.request('/__local/codex/status');assert.equal(result.data.ready,true);assert.equal(result.data.authMethod,'chatgpt');assert.equal(probes,1);assert.equal(inferences,0);await assert.rejects(fs.access(path.join(f.dataDir,'model.json')));
  assert.equal((await f.request('/__local/codex/status',{})).status,405);
  const tested=await f.request('/__local/model/test',{mode:'codex',codexModel:''});assert.equal(tested.status,200);assert.equal(tested.data.ok,true);assert.equal(inferences,1);await assert.rejects(fs.access(path.join(f.dataDir,'model.json')));
  const saved=await f.request('/__local/model',{mode:'codex',codexModel:''},'PUT');assert.equal(saved.status,200);assert.equal(saved.data.mode,'codex');assert.equal((await f.request('/__local/models')).data.models[0].name,'本机 Codex · 自动模型');
});

test('Codex draft test failure never changes saved API configuration or calls it as fallback',async t=>{
  let attempts=0;
  const f=await application(t,{modelCompletion:async config=>{attempts++;assert.equal(config.mode,'codex');throw Object.assign(Error('本机 Codex 未登录，请运行 codex login'),{status:409});}});
  await f.request('/__local/model',{mode:'compatible',baseUrl:'https://example.test/v1',model:'saved-api',apiKey:'private-api-fixture'},'PUT');
  const before=await fs.readFile(path.join(f.dataDir,'model.json'),'utf8');
  const result=await f.request('/__local/model/test',{mode:'codex'});assert.equal(result.status,409);assert.equal(attempts,1);assert.match(result.data.error,/未登录/);assert.equal(await fs.readFile(path.join(f.dataDir,'model.json'),'utf8'),before);
  assert.equal((await f.request('/__local/model')).data.mode,'compatible');
});
