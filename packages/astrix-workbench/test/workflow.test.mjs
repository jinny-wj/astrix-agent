import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWorkflowService} from '../../../网页端/workbench/server/workflow.mjs';
import {originalBinary} from '../../../网页端/workbench/server/opencode.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function roleOf(request){return request.messages.map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n').match(/M0_LOCAL_WORKFLOW_ROLE:([^\]]+)/)?.[1];}
async function fixture(t,handler,config={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'m0-workflow-test-'));
  const workspace=path.join(directory,'workspace'),other=path.join(directory,'other');fs.mkdirSync(workspace);fs.mkdirSync(other);
  fs.writeFileSync(path.join(workspace,'README.md'),'fixed-workspace-proof');fs.writeFileSync(path.join(other,'README.md'),'WRONG_WORKSPACE');
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    try{
      let text='';for await(const bytes of req)text+=bytes;const request=JSON.parse(text);requests.push(request);
      const message=await handler(request,requests);
      if(res.destroyed)return;
      if(request.stream){
        res.writeHead(200,{'content-type':'text/event-stream'});
        res.write('data: '+JSON.stringify({id:'workflow-test',choices:[{index:0,delta:message,finish_reason:null}]})+'\n\n');
        res.write('data: '+JSON.stringify({id:'workflow-test',choices:[{index:0,delta:{},finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\n');res.end('data: [DONE]\n\n');
      }else{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message}]}));}
    }catch(error){if(!res.destroyed){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let activeWorkspace=workspace;
  const configuration={mode:'compatible',engine:'local',model:'workflow-mock',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'synthetic-workflow-key',allowWriteTools:true,...config};
  const dataDir=path.join(directory,'data');
  const service=createWorkflowService({getModelConfig:()=>configuration,getWorkspace:()=>activeWorkspace,dataDir});
  return {service,workspace,other,directory,dataDir,requests,config:configuration,setWorkspace:value=>activeWorkspace=value};
}
const text=content=>({role:'assistant',content});
const tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'call-'+Math.random(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('actual planner, independent readers, serial writers, reviewer and summary pass context through recovered LangGraph',async t=>{
  const plan={planDesc:'先独立检查代码和设计，再串行写入并复核',taskList:[
    {id:'inspect-code',name:'检查代码',task:'读取 README',agent:'explorer',readOnly:true,dependsOn:[]},
    {id:'inspect-design',name:'检查设计',task:'读取 README 并分析设计',agent:'m0-design-agent',readOnly:true,dependsOn:[]},
    {id:'implement-a',name:'写入 A',task:'实现 A',agent:'coding-core-agent',readOnly:false,dependsOn:['inspect-code','inspect-design']},
    {id:'implement-b',name:'写入 B',task:'实现 B',agent:'coding-core-agent',readOnly:false,dependsOn:['inspect-code','inspect-design']},
  ]};
  let activeReaders=0,maxReaders=0,activeWriters=0,maxWriters=0;const completedReaders=new Set();
  const f=await fixture(t,async request=>{
    const role=roleOf(request),input=JSON.parse(request.messages.findLast(message=>message.role==='user').content);
    if(role==='planner')return text(JSON.stringify(plan));
    const used=request.messages.filter(message=>message.role==='tool');
    if(role==='explorer'||role==='m0-design-agent'){
      if(!used.length)return tool('read_file',{path:'README.md'});
      assert.match(used[0].content,/fixed-workspace-proof/);assert.doesNotMatch(used[0].content,/WRONG_WORKSPACE/);
      activeReaders++;maxReaders=Math.max(maxReaders,activeReaders);await delay(60);activeReaders--;completedReaders.add(input.task.id);
      return text(input.task.id+' read-proof');
    }
    if(role==='coding-core-agent'){
      assert.equal(completedReaders.size,2,'writes wait for both independent readers');
      assert.equal(input.dependencies.length,2);assert.ok(input.dependencies.every(item=>item.output.includes('read-proof')));
      activeWriters++;maxWriters=Math.max(maxWriters,activeWriters);await delay(30);activeWriters--;
      if(!used.length)return tool('write_file',{path:input.task.id+'.txt',content:input.task.id+' actual-file-proof'});
      assert.match(used[0].content,/success/);return text(input.task.id+' written');
    }
    if(role==='reviewer'){
      assert.equal(input.outputs.length,4);assert.ok(request.tools.every(item=>item.function.name!=='write_file'));
      if(!used.length)return tool('read_file',{path:'implement-a.txt'});
      assert.match(used[0].content,/actual-file-proof/);return text('独立复核确认实际文件，未运行终端测试');
    }
    assert.equal(role,'summarizer');assert.match(input.review,/独立复核/);assert.equal(input.outputs.length,4);
    return text('真实规划、分工、写入和复核已完成。');
  });
  const events=[],deltas=[];
  const result=await f.service.respond({prompt:'检查项目并实现两个独立文件',sessionId:'workflow-session',onStep:event=>{events.push(event);if(event.role==='planner'&&event.status==='completed')f.setWorkspace(f.other);},onText:delta=>deltas.push(delta)});
  assert.equal(result,'真实规划、分工、写入和复核已完成。');assert.equal(deltas.join(''),result);
  assert.equal(maxReaders,2,'independent read-only model work overlaps');assert.equal(maxWriters,1,'write-capable roles stay serial');
  for(const name of ['implement-a.txt','implement-b.txt']){assert.match(fs.readFileSync(path.join(f.workspace,name),'utf8'),/actual-file-proof/);assert.equal(fs.existsSync(path.join(f.other,name)),false);}
  const summary=f.service.listRuns({sessionId:'workflow-session'})[0],run=f.service.getRun(summary.runId);
  assert.equal(run.status,'completed');assert.equal(run.scheduler,'original-langgraph-local-graph');assert.equal(run.langGraphVersion,'0.3.9');assert.equal(run.businessGraphReused,false);
  assert.equal(run.steps.filter(step=>step.status==='completed').length,7);assert.equal(run.outputs.length,4);assert.ok(run.budget.usedSteps<=24);
  assert.ok(Object.values(run.promptSources).every(source=>source.available&&source.promptSha256));
  assert.ok(events.some(event=>event.role==='m0-design-agent'&&event.status==='running'));assert.ok(events.every(event=>event.workspace===fs.realpathSync(f.workspace)));
  assert.ok(!fs.readFileSync(path.join(f.dataDir,'workflow-runs',run.runId+'.json'),'utf8').includes('synthetic-workflow-key'));
  assert.ok(f.requests.some(request=>request.messages[0].content.includes('当前没有连接真实 Figma 文件')));
});

test('demo records a truthful skip without requesting models or creating child-agent progress',async t=>{
  const f=await fixture(t,()=>{throw new Error('Demo must not request a model');},{mode:'demo',engine:'original-opencode'});const events=[];
  const reply=await f.service.respond({prompt:'执行多人任务',sessionId:'demo',onStep:event=>events.push(event)});
  assert.match(reply,/均未运行/);assert.equal(events.length,0);assert.equal(f.requests.length,0);
  const run=f.service.getRun(f.service.listRuns()[0].runId);assert.equal(run.status,'skipped');assert.equal(run.steps.length,0);assert.equal(run.budget.usedSteps,0);
});

test('project history filters before its limit despite many newer runs in another workspace',async t=>{
  const f=await fixture(t,()=>{throw new Error('History listing must not request a model');});
  const records=path.join(f.dataDir,'workflow-runs');
  const record=(workspace,sessionId,startedAt)=>{
    const runId=randomUUID();
    fs.writeFileSync(path.join(records,runId+'.json'),JSON.stringify({runId,sessionId,workspace,prompt:'history-proof',title:'history-proof',status:'completed',startedAt,steps:[]}));
    return runId;
  };
  const oldest=record(f.workspace,'session-old','2026-01-01T00:00:00.000Z');
  const newest=record(f.workspace,'session-new','2026-01-02T00:00:00.000Z');
  for(let i=0;i<60;i++)record(f.other,'other-session',new Date(Date.UTC(2026,1,i+1)).toISOString());
  assert.equal(f.service.listRuns({limit:50}).length,50);
  assert.deepEqual(f.service.listRuns({workspace:f.workspace,limit:50}).map(run=>run.runId),[newest,oldest]);
  assert.deepEqual(f.service.listRuns({workspace:f.workspace,sessionId:'session-old',limit:1}).map(run=>run.runId),[oldest]);
  assert.equal(f.requests.length,0);
});

test('read-only roles cannot write even when a model requests an unadvertised tool',async t=>{
  const f=await fixture(t,request=>{
    const role=roleOf(request);
    if(role==='planner')return text(JSON.stringify({taskList:[{id:'inspect',task:'只读检查',agent:'explorer',readOnly:true}]}));
    if(role==='explorer'){
      const used=request.messages.find(message=>message.role==='tool');
      if(!used)return tool('write_file',{path:'must-not-exist.txt',content:'bad'});
      assert.match(used.content,/没有该工具权限/);return text('写入被拒绝，已保持只读');
    }
    return text(role==='reviewer'?'没有写入':'只读分析结束');
  });
  await f.service.respond({prompt:'只读检查',sessionId:'readonly'});assert.equal(fs.existsSync(path.join(f.workspace,'must-not-exist.txt')),false);
});

test('external cancellation aborts active role requests and never runs queued writers or summary',async t=>{
  const controller=new AbortController();
  const f=await fixture(t,async request=>{
    const role=roleOf(request);
    if(role==='planner')return text(JSON.stringify({taskList:[{id:'inspect',task:'检查',agent:'explorer',readOnly:true},{id:'write',task:'写入',agent:'coding-core-agent',readOnly:false,dependsOn:['inspect']}]}));
    if(role==='explorer'){setTimeout(()=>controller.abort(),15);await delay(250);return text('too late');}
    throw new Error('Cancelled workflow must not reach '+role);
  });
  await assert.rejects(()=>f.service.respond({prompt:'会取消的任务',sessionId:'cancelled',signal:controller.signal}),error=>error.name==='AbortError');
  const run=f.service.getRun(f.service.listRuns()[0].runId);assert.equal(run.status,'cancelled');assert.ok(run.steps.some(step=>step.role==='explorer'&&step.status==='cancelled'));
  assert.deepEqual(f.requests.map(roleOf),['planner','explorer']);assert.equal(run.result,'');
});

test('step budget stops a real tool loop and invalid plans never start an executor',async t=>{
  const f=await fixture(t,request=>roleOf(request)==='planner'?text(JSON.stringify({taskList:[{id:'inspect',task:'读取项目',agent:'explorer',readOnly:true}]})):tool('read_file',{path:'README.md'}),{workflowMaxSteps:4,workflowMaxTasks:1});
  await assert.rejects(()=>f.service.respond({prompt:'预算测试',sessionId:'budget'}),/步骤预算/);
  const run=f.service.getRun(f.service.listRuns()[0].runId);assert.equal(run.status,'failed');assert.equal(run.budget.usedSteps,4);assert.equal(f.requests.length,4);assert.ok(!f.requests.some(request=>roleOf(request)==='summarizer'));
  const invalid=await fixture(t,()=>text('this is not a plan'));
  await assert.rejects(()=>invalid.service.respond({prompt:'坏规划',sessionId:'invalid'}),/有效 JSON/);assert.deepEqual(invalid.requests.map(roleOf),['planner']);
});

const hasEngine=process.platform==='darwin'&&process.arch==='arm64'&&fs.existsSync(originalBinary);
test('recovered original OpenCode runs independent native agent sessions with real role prompts',{skip:!hasEngine,timeout:60000},async t=>{
  const f=await fixture(t,request=>{
    const role=roleOf(request);
    if(role==='planner')return text(JSON.stringify({planDesc:'原引擎独立会话',taskList:[{id:'native-inspect',task:'提供本地检查建议',agent:'coding-core-agent',readOnly:true}]}));
    if(role==='coding-core-agent'){
      if(!request.messages.some(message=>message.role==='tool'))return tool('read',{filePath:'README.md'});
      return text('native-coding-output-proof');
    }
    if(role==='reviewer'){assert.ok(JSON.stringify(request.messages).includes('native-coding-output-proof'));return text('native-review-output-proof');}
    if(role==='summarizer'){assert.ok(JSON.stringify(request.messages).includes('native-review-output-proof'));return text('native-summary-output-proof');}
    return text('background title');
  },{engine:'original-opencode',allowWriteTools:false});
  const result=await f.service.respond({prompt:'原版多 Agent 验证',sessionId:'native-workflow',signal:t.signal});assert.match(result,/native-summary-output-proof/);
  const run=f.service.getRun(f.service.listRuns()[0].runId);assert.equal(run.status,'completed');assert.equal(run.steps.length,4);assert.ok(run.steps.every(step=>step.maxStepsAllocated===3));
  const sessions=JSON.parse(fs.readFileSync(path.join(f.dataDir,'workflow-engine','opencode-runtime','local-sessions.json'),'utf8'));
  assert.equal(Object.keys(sessions).length,4);assert.equal(new Set(Object.values(sessions).map(session=>session.engineSessionId)).size,4);
  for(const role of ['planner','coding-core-agent','reviewer','summarizer'])assert.ok(f.requests.some(request=>roleOf(request)===role),role+' made an actual model request');
  assert.ok(f.requests.filter(request=>roleOf(request)==='coding-core-agent').length<=3,'native agent respects its allocated model-step cap');
  assert.equal(run.budget.forwardedRequests,f.requests.length);assert.equal(run.budget.deniedRequests,0);
  assert.ok(run.steps.every(step=>step.modelRequests.forwardedRequests<=step.maxStepsAllocated));
  assert.ok(f.requests.every(request=>roleOf(request)),'background title and summary models are disabled');
  assert.ok(f.requests.some(request=>request.messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('fixed-workspace-proof'))),'native role uses the actual captured file tool');
  assert.ok(f.requests.filter(request=>request.tools).every(request=>!request.tools.some(item=>['bash','task','write','edit'].includes(item.function.name))));
});

test('recovered native tool loops hit the gateway hard cap without completing later workflow roles',{skip:!hasEngine,timeout:20000},async t=>{
  const f=await fixture(t,request=>{
    const role=roleOf(request);
    if(role==='planner')return text(JSON.stringify({taskList:[{id:'loop',task:'重复读取工作区',agent:'explorer',readOnly:true}]}));
    if(role==='explorer')return tool('read',{filePath:'README.md'});
    throw new Error('Budget failure must not reach '+role);
  },{engine:'original-opencode',allowWriteTools:false,workflowMaxSteps:8,workflowMaxTasks:1});
  await assert.rejects(()=>f.service.respond({prompt:'原引擎预算回归',sessionId:'native-budget',signal:t.signal}),/模型请求预算/);
  const run=f.service.getRun(f.service.listRuns()[0].runId),step=run.steps.find(step=>step.role==='explorer');
  assert.equal(run.status,'failed');assert.equal(run.result,'');assert.equal(step.status,'error');assert.equal(step.maxStepsAllocated,2);
  assert.equal(step.modelRequests.forwardedRequests,2);assert.ok(step.modelRequests.deniedRequests>=1);
  assert.equal(f.requests.filter(request=>roleOf(request)==='explorer').length,2,'the upstream only receives permitted model requests');
  assert.equal(run.budget.forwardedRequests,f.requests.length);assert.ok(run.budget.deniedRequests>=1);
  assert.ok(f.requests.every(request=>['planner','explorer'].includes(roleOf(request))));
});
