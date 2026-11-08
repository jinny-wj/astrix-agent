import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {codexChildEnv,createCodexCliGateway,isCodexModelUnavailable} from '../../../网页端/workbench/server/codex-cli.mjs';

const messages=[{role:'system',content:'只操作指定工作区。'},{role:'user',content:'帮我读取项目说明。'}];
const tools=[{type:'function',function:{name:'read_file',description:'读取工作区文件',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}}];

async function fixture(t,options={}) {
  const directory=await fs.mkdtemp(path.join(tmpdir(),'astrix codex fixture '));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const binary=path.join(directory,'fake-codex.mjs'),trace=path.join(directory,'trace.jsonl');
  const script=`#!${process.execPath}\n`+String.raw`
import fs from 'node:fs';
const args=process.argv.slice(2),phase=args[0]==='login'?'status':args[0]==='app-server'?'config':'exec';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const log=value=>fs.appendFileSync(process.env.FIXTURE_TRACE,JSON.stringify(value)+'\n');
if(phase==='status'){
  log({phase,args});
  if(process.env.FIXTURE_AUTH==='none'){process.stderr.write('Not logged in\n');process.exit(1);}
  if(process.env.FIXTURE_AUTH==='api')process.stderr.write('Logged in using an API key - sk-synthetic-do-not-return\n');
  else if(process.env.FIXTURE_AUTH==='unknown')process.stderr.write('Logged in using fixture authentication\n');
  else process.stderr.write('Logged in using ChatGPT\n');
  process.exit(0);
}
if(phase==='config'){
  let pending='';const methods=[];
  for await(const chunk of process.stdin){
    pending+=chunk;let index;
    while((index=pending.indexOf('\n'))>=0){
      const request=JSON.parse(pending.slice(0,index));pending=pending.slice(index+1);methods.push(request.method);
      if(request.method==='initialize')emit({id:request.id,result:{userAgent:'fixture'}});
      if(request.method==='config/read'){
        if(process.env.FIXTURE_MODE==='config-error')emit({id:request.id,error:{code:-1,message:'private sk-synthetic-do-not-return'}});
        else emit({id:request.id,result:{config:{model:process.env.FIXTURE_CONFIG_MODEL||null,model_provider:'must-not-inherit-provider',model_providers:{private:{base_url:'https://must-not-inherit.example',api_key:'sk-synthetic-do-not-return'}}}}});
      }
    }
  }
  log({phase,args,cwd:process.cwd(),methods});process.exit(0);
}
let input='';for await(const chunk of process.stdin)input+=chunk;
const schemaPath=args[args.indexOf('--output-schema')+1];
log({phase,args,input,cwd:process.cwd(),schema:JSON.parse(fs.readFileSync(schemaPath,'utf8')),env:{
  apiKeyPresent:Boolean(process.env.OPENAI_API_KEY||process.env.CODEX_API_KEY),
  routePresent:Boolean(process.env.OPENAI_BASE_URL||process.env.CODEX_BASE_URL),
  accessTokenPresent:Boolean(process.env.CODEX_ACCESS_TOKEN),
  parentPresent:Boolean(process.env.CODEX_THREAD_ID||process.env.CODEX_SANDBOX||process.env.CODEX_CI),
  home:process.env.HOME,codexHome:process.env.CODEX_HOME,managed:process.env.CODEX_MANAGED_FIXTURE,
}});
switch(process.env.FIXTURE_MODE){
  case 'hang':setInterval(()=>{},1000);break;
  case 'native-tool':emit({type:'item.started',item:{type:'command_execution',command:'must not execute'}});setInterval(()=>{},1000);break;
  case 'quota':emit({type:'turn.failed',error:{message:"You've hit your usage limit. sk-synthetic-do-not-return"}});break;
  case 'failure':process.stderr.write('provider failure contains sk-synthetic-do-not-return');process.exitCode=1;break;
  case 'permission':process.stderr.write('failed to initialize in-process app-server client: Operation not permitted (os error 1)');process.exitCode=1;break;
  case 'model-unavailable':emit({type:'error',message:JSON.stringify({type:'error',status:400,error:{type:'invalid_request_error',message:"The 'fixture-model' model is not supported when using Codex with a ChatGPT account.",code:'model_not_found'}})});break;
  case 'schema':emit({type:'turn.failed',error:{message:'The model response format has an invalid_json_schema: maxItems is not supported.'}});break;
  case 'mention-model':process.stderr.write('模型服务返回未知错误，诊断信息不应公开 sk-synthetic-do-not-return');process.exitCode=1;break;
  case 'overflow':process.stdout.write('x'.repeat(65536));break;
  case 'malformed':process.stdout.write('{bad json}\n');break;
  default:
    emit({type:'thread.started',thread_id:'fixture-thread'});
    emit({type:'item.completed',item:{type:'reasoning',text:'private fixture thought'}});
    emit({type:'item.completed',item:{type:'agent_message',text:process.env.FIXTURE_REPLY||'{"content":"连接正常。","tool_calls":[]}'}});
    if(process.env.FIXTURE_MODE!=='incomplete')emit({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}});
}
`;
  await fs.writeFile(binary,script,{mode:0o700});
  const environment={...process.env,FIXTURE_TRACE:trace,FIXTURE_MODE:options.mode||'',FIXTURE_AUTH:options.auth||'chatgpt',
    FIXTURE_CONFIG_MODEL:options.configModel||'',
    OPENAI_API_KEY:'synthetic-openai-key',CODEX_API_KEY:'synthetic-codex-key',OPENAI_BASE_URL:'https://wrong.example/v1',CODEX_BASE_URL:'https://wrong.example',CODEX_ACCESS_TOKEN:'synthetic-access',
    CODEX_THREAD_ID:'parent-fixture',CODEX_SANDBOX:'parent-fixture',CODEX_CI:'1',CODEX_MANAGED_FIXTURE:'preserve-policy',
    ...(options.reply===undefined?{}:{FIXTURE_REPLY:typeof options.reply==='string'?options.reply:JSON.stringify(options.reply)})};
  const gateway=createCodexCliGateway({bin:binary,environment,tempRoot:directory,timeoutMs:options.timeoutMs||3000,statusTimeoutMs:3000,maxOutputBytes:options.maxOutputBytes||1024*1024});
  return {directory,binary,trace,environment,gateway,async events(){try{return (await fs.readFile(trace,'utf8')).trim().split('\n').filter(Boolean).map(value=>JSON.parse(value));}catch{return [];}}};
}

test('Codex status distinguishes ChatGPT/API/unknown/missing login without exposing raw CLI output',async t=>{
  for(const [auth,expected] of [['chatgpt','chatgpt'],['api','api-key'],['unknown','unknown'],['none','none']]){
    const f=await fixture(t,{auth}),value=await f.gateway.getStatus();
    assert.equal(value.authMethod,expected);assert.equal(value.ready,auth==='chatgpt');assert.equal(value.installed,true);
    assert.equal(value.authenticated,auth!=='none');assert.ok(!JSON.stringify(value).includes('sk-synthetic'));
    assert.deepEqual((await f.events())[0].args,['login','status']);
  }
  const missing=await createCodexCliGateway({bin:'/does-not-exist/astrix-codex-fixture'}).getStatus();
  assert.equal(missing.installed,false);assert.equal(missing.ready,false);
});

test('billing environment removes API routes and parent sessions while preserving user login location and managed settings',()=>{
  const env=codexChildEnv({HOME:'/fixture/home',CODEX_HOME:'/fixture/codex',PATH:'/bin',OPENAI_API_KEY:'one',OPENAI_BASE_URL:'https://bad.example',OPENAI_ORG_ID:'bad-org',CODEX_API_KEY:'two',CODEX_ACCESS_TOKEN:'three',CODEX_BASE_URL:'https://bad.example',CODEX_THREAD_ID:'parent',CODEX_CI:'1',CODEX_SANDBOX:'managed-parent',CODEX_MANAGED_FIXTURE:'keep'});
  for(const key of ['OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_ORG_ID','CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_BASE_URL','CODEX_THREAD_ID','CODEX_CI','CODEX_SANDBOX'])assert.equal(env[key],undefined,key);
  assert.equal(env.HOME,'/fixture/home');assert.equal(env.CODEX_HOME,'/fixture/codex');assert.equal(env.CODEX_MANAGED_FIXTURE,'keep');
});

test('completion uses saved ChatGPT login, isolated context and strict JSON; text is emitted only after validation',async t=>{
  const f=await fixture(t),deltas=[];
  const result=await f.gateway.complete({mode:'codex'},messages,undefined,undefined,value=>deltas.push(value));
  assert.deepEqual(result,{role:'assistant',content:'连接正常。'});assert.deepEqual(deltas,['连接正常。']);
  const events=await f.events(),call=events.find(value=>value.phase==='exec');
  assert.equal(events.length,3);assert.deepEqual(events.map(value=>value.phase),['status','config','exec']);assert.equal(call.env.apiKeyPresent,false);assert.equal(call.env.routePresent,false);assert.equal(call.env.accessTokenPresent,false);assert.equal(call.env.parentPresent,false);
  assert.equal(call.env.home,process.env.HOME);assert.equal(call.env.codexHome,process.env.CODEX_HOME);assert.equal(call.env.managed,'preserve-policy');
  for(const flag of ['--json','--ephemeral','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--output-schema'])assert.ok(call.args.includes(flag),flag);
  assert.equal(call.args[call.args.indexOf('--sandbox')+1],'read-only');assert.ok(call.args.includes('forced_login_method="chatgpt"'));assert.ok(call.args.includes('project_doc_max_bytes=0'));assert.ok(call.args.includes('mcp_servers={}'));assert.ok(call.args.includes('web_search="disabled"'));
  for(const feature of ['shell_tool','unified_exec','apps','plugins','hooks','multi_agent','browser_use','computer_use','image_generation'])assert.ok(call.args.some((value,index)=>value==='--disable'&&call.args[index+1]===feature),feature);
  assert.ok(!call.args.includes('--dangerously-bypass-approvals-and-sandbox'));assert.ok(!JSON.stringify(call.args).includes(messages[1].content));
  assert.deepEqual(JSON.parse(call.input).conversation,messages);assert.equal(call.schema.properties.tool_calls.maxItems,0);
  assert.ok(call.cwd.startsWith(await fs.realpath(f.directory)));await assert.rejects(fs.access(call.cwd));
});

test('automatic model reuses only the local configured identifier while inference ignores provider routes and explicit models skip discovery',async t=>{
  const f=await fixture(t,{configModel:'fixture-local-model'});
  const result=await f.gateway.complete({mode:'codex'},messages);
  assert.equal(result.content,'连接正常。');assert.ok(!JSON.stringify(result).includes('sk-synthetic'));
  const events=await f.events(),discovery=events.find(value=>value.phase==='config'),call=events.find(value=>value.phase==='exec');
  assert.deepEqual(discovery.methods,['initialize','initialized','config/read']);
  for(const override of ['mcp_servers={}','model_providers={}','model_provider="openai"','web_search="disabled"'])assert.ok(discovery.args.includes(override),override);
  assert.equal(call.args[call.args.indexOf('--model')+1],'fixture-local-model');
  assert.ok(call.args.includes('--ignore-user-config'));assert.ok(call.args.includes('model_provider="openai"'));
  assert.ok(!JSON.stringify(call).includes('must-not-inherit'));assert.equal(call.env.routePresent,false);
  await assert.rejects(fs.access(discovery.cwd));
  const explicit=await fixture(t,{mode:'config-error'});
  assert.equal(await explicit.gateway.resolveModel({model:'explicit-model'}),'explicit-model');assert.deepEqual(await explicit.events(),[]);
  await explicit.gateway.complete({codexModel:'explicit-model'},messages);
  assert.deepEqual((await explicit.events()).map(value=>value.phase),['status','exec']);
  const failed=await fixture(t,{mode:'config-error'});
  await assert.rejects(failed.gateway.complete({},messages),failure=>failure.code==='CODEX_MODEL_DISCOVERY_FAILED'&&!failure.message.includes('sk-synthetic'));
  assert.ok(!(await failed.events()).some(value=>value.phase==='exec'));
  const invalid=await fixture(t,{configModel:'not a safe model identifier'});
  await assert.rejects(invalid.gateway.complete({},messages),failure=>failure.code==='CODEX_MODEL_DISCOVERY_FAILED');
});

test('API or unrecognized CLI login never starts inference or falls back to API',async t=>{
  for(const auth of ['api','unknown','none']){
    const f=await fixture(t,{auth});await assert.rejects(f.gateway.complete({mode:'codex'},messages),failure=>failure.code==='CODEX_LOGIN_REQUIRED'&&!failure.message.includes('sk-synthetic'));
    assert.deepEqual((await f.events()).map(value=>value.phase),['status']);
  }
});

test('registered tool requests are structured data for the app, with exact names and original tool history retained',async t=>{
  const f=await fixture(t,{reply:{content:'先读取说明。',tool_calls:[{name:'read_file',arguments:'{"path":"README.md"}'}]}});
  const history=[...messages,{role:'assistant',content:'',tool_calls:[{id:'original',type:'function',function:{name:'read_file',arguments:'{"path":"old.md"}'}}]},{role:'tool',tool_call_id:'original',content:'{"content":"previous"}'}];
  const result=await f.gateway.complete({mode:'codex',codexModel:'fixture-model'},history,tools);
  assert.equal(result.content,'先读取说明。');assert.equal(result.tool_calls.length,1);assert.match(result.tool_calls[0].id,/^codex_/);assert.deepEqual(JSON.parse(result.tool_calls[0].function.arguments),{path:'README.md'});
  const call=(await f.events()).find(value=>value.phase==='exec');assert.equal(call.args[call.args.indexOf('--model')+1],'fixture-model');assert.deepEqual(call.schema.properties.tool_calls.items.properties.name.enum,['read_file']);assert.deepEqual(JSON.parse(call.input).conversation,history);
});

test('invalid/unauthorized tool output, non-object arguments and empty results fail closed',async t=>{
  const replies=[
    'not json',{},
    {content:'',tool_calls:[]},
    {content:'',tool_calls:[{name:'write_file',arguments:'{"path":"README.md"}'}]},
    {content:'',tool_calls:[{name:'read_file',arguments:'[]'}]},
    {content:'',tool_calls:[{name:'read_file',arguments:'{bad'}]},
    {content:'valid',tool_calls:[],extra:'not allowed'},
    {content:'',tool_calls:Array.from({length:9},()=>({name:'read_file',arguments:'{}'}))},
  ];
  for(const reply of replies){const f=await fixture(t,{reply});const deltas=[];await assert.rejects(f.gateway.complete({},messages,tools,undefined,value=>deltas.push(value)),failure=>failure.code==='CODEX_INVALID_OUTPUT');assert.deepEqual(deltas,[]);}
  const f=await fixture(t,{reply:{content:'',tool_calls:[{name:'read_file',arguments:'{}'}]}});await assert.rejects(f.gateway.complete({},messages,[]),failure=>failure.code==='CODEX_INVALID_OUTPUT');
});

test('native tools are blocked and error/limit/incomplete output never becomes a successful response',async t=>{
  for(const [mode,code] of [['native-tool','CODEX_NATIVE_TOOL_BLOCKED'],['quota','CODEX_USAGE_LIMIT'],['failure','CODEX_CLI_ERROR'],['permission','CODEX_PROCESS_RESTRICTED'],['model-unavailable','CODEX_MODEL_UNAVAILABLE'],['schema','CODEX_SCHEMA_UNSUPPORTED'],['mention-model','CODEX_CLI_ERROR'],['malformed','CODEX_INVALID_OUTPUT'],['incomplete','CODEX_INCOMPLETE'],['overflow','CODEX_OUTPUT_LIMIT']]){
    const f=await fixture(t,{mode,maxOutputBytes:mode==='overflow'?1024:1024*1024});
    await assert.rejects(f.gateway.complete({},messages),failure=>failure.code===code&&!failure.message.includes('sk-synthetic'));
    const call=(await f.events()).find(value=>value.phase==='exec');await assert.rejects(fs.access(call.cwd));
  }
});

test('model errors are precise and never silently substitute a model or switch billing routes',async t=>{
  for(const value of ["The 'gpt-example' model is not supported when using Codex with a ChatGPT account.",'model_not_found','unsupported_model',new Error("Model 'example' is not available"),{code:'CODEX_MODEL_UNAVAILABLE'}])assert.equal(isCodexModelUnavailable(value),true);
  for(const value of ['模型返回错误','The model response format has an invalid_json_schema: maxItems is not supported.','authentication failed','usage limit reached','unsupported schema',undefined])assert.equal(isCodexModelUnavailable(value),false);
  for(const model of ['', 'explicit-model']){
    const f=await fixture(t,{mode:'model-unavailable'});
    await assert.rejects(f.gateway.complete({mode:'codex',codexModel:model},messages),failure=>failure.code==='CODEX_MODEL_UNAVAILABLE'&&failure.message.includes('未切换到 API'));
    const events=await f.events();assert.deepEqual(events.map(value=>value.phase),model?['status','exec']:['status','config','exec']);
    const call=events.find(value=>value.phase==='exec');assert.equal(call.args.includes('--model'),Boolean(model));assert.equal(call.env.apiKeyPresent,false);
  }
});

test('a timed out or cancelled process is stopped and its temporary directory is removed',async t=>{
  let f=await fixture(t,{mode:'hang',timeoutMs:150});
  await assert.rejects(f.gateway.complete({},messages),failure=>failure.code==='CODEX_TIMEOUT');
  // A busy host can time out Node before the fixture writes its exec trace.
  // Both early startup cancellation and a running fixture must clean up.
  let call=(await f.events()).find(value=>value.phase==='exec');if(call)await assert.rejects(fs.access(call.cwd));
  assert.deepEqual((await fs.readdir(f.directory)).filter(name=>name.startsWith('astrix-codex-')),[]);
  f=await fixture(t,{mode:'hang'});const controller=new AbortController();
  const promise=f.gateway.complete({},messages,undefined,controller.signal);const rejection=assert.rejects(promise,failure=>failure.name==='AbortError');
  for(let attempt=0;attempt<300;attempt++){if((await f.events()).some(value=>value.phase==='exec'))break;await delay(10);}
  controller.abort();await rejection;call=(await f.events()).find(value=>value.phase==='exec');assert.ok(call);await assert.rejects(fs.access(call.cwd));
  const before=await f.events();const already=new AbortController();already.abort();await assert.rejects(f.gateway.complete({},messages,undefined,already.signal),failure=>failure.name==='AbortError');assert.deepEqual(await f.events(),before);
});

test('input bounds and multimodal errors are rejected before running the CLI',async t=>{
  const f=await fixture(t);
  for(const input of [[],[{role:'unknown',content:'text'}],[{role:'user',content:[{type:'image_url',image_url:{url:'https://example.test/image.png'}}]}],[{role:'user',content:'x'.repeat(2*1024*1024)}]])await assert.rejects(f.gateway.complete({},input));
  await assert.rejects(f.gateway.complete({codexModel:'bad\nmodel'},messages));
  await assert.rejects(f.gateway.complete({codexModel:'--dangerously-bypass-approvals-and-sandbox'},messages));
  await assert.rejects(f.gateway.complete({},messages,[...tools,...tools]));
  assert.deepEqual(await f.events(),[]);
});
