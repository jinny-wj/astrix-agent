import {getLayout} from '../layout.cjs';
const layout=getLayout();
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createOriginalOpenCode,originalBinary} from '../../../网页端/workbench/server/opencode.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const hasEngine=process.platform==='darwin'&&process.arch==='arm64'&&fs.existsSync(originalBinary);
test('recovered OpenCode runs real read/write tools, resumes sessions and serves AG-UI chat', {skip:!hasEngine,timeout:60000}, async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'m0-original-engine-'));
  const workspace=path.join(directory,'workspace');fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace,'README.md'),'M0-original-engine-read-proof-4108\n');
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const request=JSON.parse(text||'{}');requests.push(request);
    const usedTool=request.messages?.some(m=>m.role==='tool');
    const writing=request.model==='write-model';
    const toolName=writing?'write':'read';
    const isMain=Boolean(request.tools?.some(tool=>tool.function.name===toolName));
    const message=isMain&&!usedTool
      ?{role:'assistant',content:null,tool_calls:[{id:'call-read-proof',type:'function',function:{name:toolName,arguments:JSON.stringify(writing?{filePath:'generated.txt',content:'original-write-proof'}:{filePath:'README.md'})}}]}
      :{role:'assistant',content:usedTool?'原版引擎已读取测试文件。':'本地模型测试'};
    if(request.stream){
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.write('data: '+JSON.stringify({id:'test-completion',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:message,finish_reason:null}]})+'\n\n');
      res.write('data: '+JSON.stringify({id:'test-completion',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{},finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\n');
      res.end('data: [DONE]\n\n');
    }else{
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({id:'test-completion',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const engine=createOriginalOpenCode({dataDir:path.join(directory,'data'),getWorkspace:()=>workspace,timeoutMs:40000});
  const calls=[];
  const result=await engine.run({config:{model:'test-model',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'',allowWriteTools:false},prompt:'读取 README.md 并说明内容',sessionId:'test-session',onTool:call=>calls.push(call)});
  assert.match(result,/原版引擎已读取测试文件/);
  assert.ok(calls.some(call=>call.name==='read'&&call.status==='completed'),JSON.stringify(calls));
  assert.ok(requests.some(request=>request.messages?.some(m=>m.role==='tool'&&JSON.stringify(m.content).includes('M0-original-engine-read-proof-4108'))));
  assert.ok(requests.every(request=>request.model==='test-model'));
  assert.ok(requests.filter(request=>request.tools).every(request=>!request.tools.some(tool=>['bash','write','edit','task'].includes(tool.function.name))));
  assert.ok(fs.existsSync(path.join(directory,'data/opencode-runtime/local-sessions.json')));
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'data/opencode-runtime/local-sessions.json'),'utf8'));
  const continued=await engine.run({config:{model:'test-model',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'',allowWriteTools:false},prompt:'继续上一轮',sessionId:'test-session'});
  assert.match(continued,/原版引擎已读取测试文件/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'data/opencode-runtime/local-sessions.json'),'utf8'))['test-session'].engineSessionId,saved['test-session'].engineSessionId);
  await engine.run({config:{model:'test-model',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'',allowWriteTools:false},prompt:'切回原引擎后继续',history:[{role:'user',content:'local-only-history-proof'},{role:'assistant',content:'本地引擎新增的答复'}],sessionId:'test-session'});
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(directory,'data/opencode-runtime/local-sessions.json'),'utf8'))['test-session'].engineSessionId,saved['test-session'].engineSessionId);
  assert.ok(requests.some(request=>request.messages?.some(message=>message.role==='user'&&String(message.content).includes('local-only-history-proof'))));
  assert.equal(fs.readFileSync(path.join(workspace,'README.md'),'utf8'),'M0-original-engine-read-proof-4108\n');
  const writeCalls=[];
  const written=await engine.run({config:{model:'write-model',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'',allowWriteTools:true},prompt:'创建 generated.txt，内容 original-write-proof',sessionId:'write-session',onTool:call=>writeCalls.push(call)});
  assert.match(written,/原版引擎已读取测试文件/);
  assert.ok(writeCalls.some(call=>call.name==='write'&&call.status==='completed'),JSON.stringify(writeCalls));
  assert.equal(fs.readFileSync(path.join(workspace,'generated.txt'),'utf8'),'original-write-proof');
  const appData=path.join(directory,'app-data');fs.mkdirSync(appData);
  fs.writeFileSync(path.join(appData,'model.json'),JSON.stringify({mode:'compatible',engine:'original-opencode',model:'test-model',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'',allowWriteTools:false}));
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:layout.webRoot,env:{...process.env,ASTRIX_PORT:String(port),ASTRIX_DATA_DIR:appData,ASTRIX_WORKSPACE:workspace,FIGMA_OAUTH_CLIENT_ID:'',FIGMA_OAUTH_CLIENT_SECRET:'',FIGMA_OAUTH_REDIRECT_URI:''},stdio:'ignore'});
  t.after(()=>{child.kill('SIGTERM');});
  let ready=false;
  for(let i=0;i<80;i++){try{if((await fetch(origin+'/__local/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
  assert.ok(ready);
  const oauth=await fetch(origin+'/api/auth/figma/session');assert.equal(oauth.status,200);
  assert.deepEqual(await oauth.json(),{configured:false,authenticated:false,user:null},'OpenCode fixture must not use application OAuth credentials or sessions');
  const post=async(route,body)=>fetch(origin+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const project=await(await post('/api/project/v2/create',{mode:'code',projectPath:workspace,projectName:'Original engine test'})).json();
  const localSession=await(await post('/api/session/v2/create',{projectId:project.id})).json();
  const reply=await(await post('/api/agent/chat',{sessionId:localSession.sessionId,projectId:project.id,humanMessage:'读取README'})).text();
  assert.match(reply,/TEXT_MESSAGE_CONTENT/);assert.match(reply,/RUN_FINISHED/);assert.match(reply,/原版引擎已读取测试文件/);assert.doesNotMatch(reply,/RUN_ERROR/);
  const history=await(await fetch(origin+'/api/session/history_message?sessionId='+localSession.sessionId)).json();
  assert.equal(history.length,2);assert.match(history[1].messageContent,/原版引擎已读取测试文件/);
});
