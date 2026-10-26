import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {nativeModelCompletion,nativeModelUrl} from '../../../网页端/workbench/server/model-providers.mjs';

const tools=[{type:'function',function:{name:'read_file',description:'Read a workspace file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}}];
const initial=[{role:'system',content:'Follow project boundaries'},{role:'user',content:'读取说明'}];
async function upstream(t,handler) {
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const item={url:req.url,headers:req.headers,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};requests.push(item);await handler(item,res,req);}
    catch(error){res.statusCode=500;res.end(JSON.stringify({error:'fixture failed'}));}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return {baseUrl:`http://127.0.0.1:${server.address().port}`,requests};
}
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
const event=value=>'data: '+JSON.stringify(value)+'\r\n\r\n';
async function fragments(res,values) {
  res.setHeader('content-type','text/event-stream');
  const bytes=Buffer.from(values.map(event).join(''));
  for(let index=0;index<bytes.length;index+=7){res.write(bytes.subarray(index,index+7));await new Promise(resolve=>setImmediate(resolve));}res.end();
}

test('native endpoints accept custom roots and complete paths, preserve queries and never append credentials',()=>{
  assert.equal(nativeModelUrl({provider:'anthropic',baseUrl:'https://example.test',model:'any'}),'https://example.test/v1/messages');
  assert.equal(nativeModelUrl({provider:'anthropic',baseUrl:'https://example.test/proxy/v1/messages?version=1',model:'any'}),'https://example.test/proxy/v1/messages?version=1');
  assert.equal(nativeModelUrl({provider:'gemini',baseUrl:'https://example.test',model:'models/any-model',apiKey:'fixture-only'}),'https://example.test/v1beta/models/any-model:generateContent');
  assert.equal(nativeModelUrl({provider:'gemini',baseUrl:'http://[::1]:8080/proxy/v1beta/models/old:generateContent?api-version=7',model:'any-model'},{stream:true}),'http://[::1]:8080/proxy/v1beta/models/any-model:streamGenerateContent?api-version=7&alt=sse');
  assert.equal(nativeModelUrl({provider:'gemini',baseUrl:'https://example.test/v1beta/models/old:streamGenerateContent?alt=sse&prefix=%2F',model:'custom'}),'https://example.test/v1beta/models/custom:generateContent?prefix=%2F');
  for(const baseUrl of ['file:///tmp/file','https://user:password@example.test/v1','https://example.test/v1#fragment'])assert.throws(()=>nativeModelUrl({provider:'anthropic',baseUrl,model:'any'}));
});

test('Claude native JSON uses messages/system/tools headers and round-trips tool results with exact thinking blocks',async t=>{
  const original=[{type:'thinking',thinking:'opaque fixture reasoning',signature:'fixture-signature'},{type:'text',text:'先读取。'},{type:'tool_use',id:'toolu_fixture',name:'read_file',input:{path:'README.md'}}];
  const fixture=await upstream(t,(item,res)=>json(res,{role:'assistant',content:fixture.requests.length===1?original:[{type:'text',text:'读取完成。'}]}));
  const config={provider:'anthropic',baseUrl:fixture.baseUrl+'/v1/messages?fixture=one',model:'arbitrary-claude',apiKey:'synthetic-native-key'};
  const reply=await nativeModelCompletion(config,initial,tools);
  assert.equal(reply.content,'先读取。');assert.equal(reply.tool_calls[0].id,'toolu_fixture');assert.deepEqual(reply._astrixNative.content,original);
  const sent=fixture.requests[0];assert.equal(sent.url,'/v1/messages?fixture=one');assert.equal(sent.headers['x-api-key'],config.apiKey);assert.equal(sent.headers['anthropic-version'],'2023-06-01');assert.equal(sent.headers.authorization,undefined);assert.equal(sent.body.system,initial[0].content);assert.equal(sent.body.model,config.model);assert.equal(sent.body.max_tokens,4096);assert.equal(sent.body.stream,false);assert.deepEqual(sent.body.tools[0].input_schema,tools[0].function.parameters);assert.equal(sent.body.messages.length,1);
  const followup=await nativeModelCompletion(config,[...initial,reply,{role:'tool',tool_call_id:'toolu_fixture',content:'{"content":"fixture"}'}],tools);
  assert.equal(followup.content,'读取完成。');assert.deepEqual(fixture.requests[1].body.messages[1],{role:'assistant',content:original});assert.deepEqual(fixture.requests[1].body.messages[2],{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_fixture',content:'{"content":"fixture"}'}]});
});

test('Claude native streaming decodes fragmented UTF-8, partial tool JSON and signed thinking without exposing thoughts',async t=>{
  const fixture=await upstream(t,(_,res)=>fragments(res,[{type:'message_start',message:{content:[]}},{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'fixture-thought'}},{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'fixture-signed'}},{type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:{type:'text',text:''}},{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'你好，'}},{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'世界。'}},{type:'content_block_stop',index:1},{type:'content_block_start',index:2,content_block:{type:'tool_use',id:'toolu_stream',name:'read_file',input:{}}},{type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'{"path":'}},{type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'"文档.md"}'}},{type:'content_block_stop',index:2},{type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'}]));
  const deltas=[];const result=await nativeModelCompletion({provider:'anthropic',model:'custom',baseUrl:fixture.baseUrl+'/v1'},initial,tools,undefined,text=>deltas.push(text));
  assert.equal(fixture.requests[0].body.stream,true);assert.equal(deltas.join(''),'你好，世界。');assert.equal(result.content,'你好，世界。');assert.deepEqual(JSON.parse(result.tool_calls[0].function.arguments),{path:'文档.md'});assert.deepEqual(result._astrixNative.content[0],{type:'thinking',thinking:'fixture-thought',signature:'fixture-signed'});
});

test('Gemini native JSON preserves function ids, complete signed parts and schema during multiple tool result round trips',async t=>{
  const original=[{text:'读取两个文件。',thoughtSignature:'text-signature'},{functionCall:{id:'native-id-1',name:'read_file',args:{path:'one.md'}},thoughtSignature:'function-signature'},{functionCall:{id:'native-id-2',name:'read_file',args:{path:'two.md'}}}];
  const fixture=await upstream(t,(_,res)=>json(res,{candidates:[{index:0,finishReason:'STOP',content:{role:'model',parts:fixture.requests.length===1?original:[{text:'读取完成。'}]}}]}));
  const config={provider:'gemini',baseUrl:fixture.baseUrl+'/v1beta?fixture=yes',model:'models/custom-gemini',apiKey:'synthetic-gemini-key'};
  const reply=await nativeModelCompletion(config,initial,tools);
  assert.equal(reply.tool_calls.length,2);assert.equal(reply.tool_calls[0].id,'native-id-1');assert.deepEqual(reply._astrixNative.content,original);
  const sent=fixture.requests[0];assert.equal(sent.url,'/v1beta/models/custom-gemini:generateContent?fixture=yes');assert.equal(sent.headers['x-goog-api-key'],config.apiKey);assert.equal(sent.headers.authorization,undefined);assert.equal(sent.headers['x-api-key'],undefined);assert.deepEqual(sent.body.systemInstruction,{parts:[{text:initial[0].content}]});assert.deepEqual(sent.body.tools[0].functionDeclarations[0].parametersJsonSchema,tools[0].function.parameters);assert.equal(sent.body.contents[0].role,'user');
  await nativeModelCompletion(config,[...initial,reply,{role:'tool',tool_call_id:reply.tool_calls[0].id,content:'{"content":"first"}'},{role:'tool',tool_call_id:reply.tool_calls[1].id,content:'plain second'}],tools);
  const follow=fixture.requests[1].body.contents;assert.deepEqual(follow[1],{role:'model',parts:original});assert.deepEqual(follow[2],{role:'user',parts:[{functionResponse:{id:'native-id-1',name:'read_file',response:{content:'first'}}},{functionResponse:{id:'native-id-2',name:'read_file',response:{result:'plain second'}}}]});
});

test('Gemini streaming keeps empty-text thought signatures and no-id function calls intact across tool turns',async t=>{
  const original=[{text:'隐式思考',thought:true},{text:'你好'}, {functionCall:{name:'read_file',args:{path:'README.md'}},thoughtSignature:'signed-call'},{text:'',thoughtSignature:'empty-part-signature'}];
  const fixture=await upstream(t,(_,res)=>fixture.requests.length===1?fragments(res,[{candidates:[{index:0,content:{role:'model',parts:original.slice(0,2)}}]},{candidates:[{index:0,content:{role:'model',parts:original.slice(2)},finishReason:'STOP'}]}]):json(res,{candidates:[{content:{parts:[{text:'成功'}]},finishReason:'STOP'}]}));
  const config={provider:'gemini',baseUrl:fixture.baseUrl+'/v1beta',model:'test-gemini'};const deltas=[];
  const reply=await nativeModelCompletion(config,initial,tools,undefined,part=>deltas.push(part));
  assert.equal(fixture.requests[0].url,'/v1beta/models/test-gemini:streamGenerateContent?alt=sse');assert.equal(deltas.join(''),'你好');assert.equal(reply.content,'你好');assert.match(reply.tool_calls[0].id,/^call_/);assert.deepEqual(reply._astrixNative.content,original);
  await nativeModelCompletion(config,[...initial,reply,{role:'tool',tool_call_id:reply.tool_calls[0].id,content:'[]'}],tools);
  const sent=fixture.requests[1].body.contents;assert.deepEqual(sent[1].parts,original);assert.deepEqual(sent[2].parts,[{functionResponse:{name:'read_file',response:{result:[]}}}]);
});

test('native text JSON fallback emits one visible delta and preserves serializable metadata',async t=>{
  const fixture=await upstream(t,(_,res)=>json(res,{candidates:[{finishReason:'STOP',content:{parts:[{text:'a'},{text:'b'}]}}]}));const deltas=[];
  const result=await nativeModelCompletion({provider:'gemini',baseUrl:fixture.baseUrl,model:'any'},initial,undefined,undefined,value=>deltas.push(value));
  assert.deepEqual(deltas,['ab']);assert.equal(JSON.parse(JSON.stringify(result)).content,'ab');
});

test('native stream errors and incomplete streams fail without leaking upstream messages',async t=>{
  let kind=0;const fixture=await upstream(t,(_,res)=>{
    if(kind===0)return fragments(res,[{type:'error',error:{message:'synthetic-secret-value'}}]);
    if(kind===1)return fragments(res,[{type:'content_block_start',index:0,content_block:{type:'text',text:'partial'}},{type:'content_block_stop',index:0}]);
    if(kind===2)return fragments(res,[{candidates:[{content:{parts:[{text:'partial'}]}}]}]);
    return fragments(res,[{candidates:[{finishReason:'SAFETY',content:{parts:[{text:'partial'}]}}]}]);
  });
  for(kind=0;kind<4;kind++)await assert.rejects(nativeModelCompletion({provider:kind<2?'anthropic':'gemini',baseUrl:fixture.baseUrl,model:'test'},initial,undefined,undefined,()=>{}),error=>!error.message.includes('synthetic-secret-value')&&/错误|完整结束|正常完成/.test(error.message));
});

test('native malformed JSON/tool arguments, missing content and HTTP errors do not report success',async t=>{
  let response;const fixture=await upstream(t,(_,res)=>{if(response==='http'){res.statusCode=401;res.end('synthetic-secret-value');}else if(response==='invalid'){res.setHeader('content-type','application/json');res.end('{bad');}else json(res,response);});
  const config={provider:'anthropic',baseUrl:fixture.baseUrl,model:'test'};
  for(response of ['http','invalid',{}, {content:[{type:'tool_use',name:'read_file',id:'id',input:[]}]}])await assert.rejects(nativeModelCompletion(config,initial),error=>!error.message.includes('synthetic-secret-value'));
});

test('native output limits reject tool calls even when their arguments parse, while partial text remains usable',async t=>{
  let provider,stream,tool;
  const fixture=await upstream(t,(_,res)=>{
    if(provider==='anthropic'){
      const content=tool?[{type:'tool_use',id:'toolu_limit',name:'read_file',input:{path:'one.md'}}]:[{type:'text',text:'partial text'}];
      return stream?fragments(res,[{type:'content_block_start',index:0,content_block:content[0]},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'max_tokens'}},{type:'message_stop'}]):json(res,{content,stop_reason:'max_tokens'});
    }
    const content={parts:tool?[{functionCall:{name:'read_file',args:{path:'one.md'}}}]:[{text:'partial text'}]};
    const body={candidates:[{index:0,content,finishReason:'MAX_TOKENS'}]};return stream?fragments(res,[body]):json(res,body);
  });
  for(provider of ['anthropic','gemini'])for(stream of [false,true])for(tool of [false,true]){
    const promise=nativeModelCompletion({provider,baseUrl:fixture.baseUrl,model:'test'},initial,undefined,undefined,stream?()=>{}:undefined);
    if(tool)await assert.rejects(promise,/被截断/);else assert.equal((await promise).content,'partial text');
  }
});

test('native provider key headers never follow redirects to another server',async t=>{
  let leaked=0;const sink=await upstream(t,(_,res)=>{leaked++;json(res,{content:[{type:'text',text:'must not happen'}]});});
  const fixture=await upstream(t,(_,res)=>{res.statusCode=307;res.setHeader('location',sink.baseUrl+'/target');res.end();});
  for(const provider of ['anthropic','gemini'])await assert.rejects(nativeModelCompletion({provider,baseUrl:fixture.baseUrl,model:'test',apiKey:'synthetic-only'},initial));
  assert.equal(leaked,0);
});

test('native pending requests honor cancellation and close their upstream connection',async t=>{
  let close;const closed=new Promise(resolve=>{close=resolve;});let ready;const received=new Promise(resolve=>{ready=resolve;});
  const fixture=await upstream(t,(_,res)=>{res.on('close',close);ready();});const abort=new AbortController();
  const promise=nativeModelCompletion({provider:'gemini',baseUrl:fixture.baseUrl,model:'test'},initial,undefined,abort.signal);
  await received;abort.abort();await assert.rejects(promise,/abort|cancel/i);await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('upstream stayed open')),1500))]);
});

test('native JSON and SSE responses enforce the per-turn byte bound',async t=>{
  let stream=false;const fixture=await upstream(t,(_,res)=>{
    res.setHeader('content-type',stream?'text/event-stream':'application/json');
    const prefix=stream?'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"':'{"content":[{"type":"text","text":"';res.write(prefix);res.end('x'.repeat(8*1024*1024));
  });
  for(stream of [false,true])await assert.rejects(nativeModelCompletion({provider:'anthropic',baseUrl:fixture.baseUrl,model:'test'},initial,undefined,undefined,stream?()=>{}:undefined),/超过 8 MB/);
});

test('native text-only translation fails clearly on unsupported multimodal inputs instead of dropping them',async()=>{
  for(const provider of ['anthropic','gemini'])await assert.rejects(nativeModelCompletion({provider,baseUrl:'http://127.0.0.1:1',model:'test'},[{role:'user',content:[{type:'image_url',image_url:{url:'https://example.test/image.png'}}]}]),/仅支持文本/);
});
