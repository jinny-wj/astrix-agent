import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createModelGateway} from '../server/model-gateway.mjs';

test('native model gateway enforces forwarding budget before making upstream requests',async t=>{
  let calls=0;
  const server=http.createServer(async(req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer synthetic-only');for await(const _ of req){}res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'测试响应'}}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const gateway=await createModelGateway({config:{model:'test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'synthetic-only'},maxRequests:2});t.after(()=>gateway.close());
  const request=()=>fetch(gateway.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+gateway.apiKey},body:JSON.stringify({model:'test',messages:[{role:'user',content:'测试'}]})});
  assert.equal((await request()).status,200);assert.equal((await request()).status,200);
  const denied=await request();assert.equal(denied.status,400);assert.equal((await denied.json()).error.code,'M0_LOCAL_BUDGET_EXCEEDED');
  assert.equal(calls,2);assert.equal(gateway.stats.forwardedRequests,2);assert.equal(gateway.stats.deniedRequests,1);
  assert.equal((await fetch(gateway.baseUrl+'/chat/completions',{method:'POST',headers:{origin:'null'},body:'{}'})).status,403);
});
