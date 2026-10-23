import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createFigmaBridge} from '../server/figma-bridge.mjs';
import {createFigmaWorkspace} from '../server/figma-workspace.mjs';
import {createFigmaAgentScope,createFigmaMcpGateway} from '../server/figma-agent.mjs';
import {createPluginHarness,createPluginUiHarness} from '../figma-plugin-bridge/test-harness.mjs';
import {createChatService} from '../server/chat.mjs';
import {createWorkflowService} from '../server/workflow.mjs';
import {createOriginalOpenCode,originalBinary} from '../server/opencode.mjs';
import {existsSync} from 'node:fs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await pause(5);}throw Error('Figma fixture timed out');}
async function fixture(t,options={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-figma-agent-')),project={id:1,projectPath:directory};
  const bridge=createFigmaBridge({dataDir:path.join(directory,'data'),port:4317,resolveProject:id=>String(id)==='1'?project:null,commandTimeoutMs:3000,...options});
  const server=http.createServer(async(req,res)=>{try{if(!await bridge.handle(req,res,new URL(req.url,'http://127.0.0.1'))){res.statusCode=404;res.end();}}catch(e){res.statusCode=e.status||500;res.end(JSON.stringify({error:e.message}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const plugin=createPluginHarness(),ui=await createPluginUiHarness({plugin,baseUrl:origin});
  const code=await(await fetch(origin+'/__local/figma/bridge/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'create',projectId:1})})).json();await ui.pair(code.code);
  const live=await until(async()=>{try{return await bridge.getContext({projectId:1,fileKey:plugin.figma.fileKey,sessionId:plugin.id})}catch{}});
  const workspaceService=createFigmaWorkspace({bridge,api:{findProject:()=>project,save(){}},canvas:{target:async id=>({projectId:Number(id),files:{}})},port:4317});
  await workspaceService.set(1,{url:'https://www.figma.com/design/'+plugin.figma.fileKey+'/Fixture'});
  let pumping=false,paused=false;const timer=setInterval(async()=>{if(pumping||paused)return;pumping=true;try{await ui.tick()}finally{pumping=false}},8);
  t.after(async()=>{clearInterval(timer);while(pumping)await pause(5);bridge.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const context={...live,targetNodeIds:live.nodes.map(n=>n.id)};
  return {directory,bridge,workspaceService,project,plugin,ui,context,origin,async pausePump(){paused=true;while(pumping)await pause(2);},resumePump(){paused=false;},scope:allowWrite=>createFigmaAgentScope({bridge,workspaceService,projectId:1,context,allowWrite})};
}
async function model(t,handler){const requests=[],server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push(body);let message;try{message=await handler(body)}catch(error){message={role:'assistant',content:'test error: '+error.message};}res.writeHead(200,{'content-type':body.stream?'text/event-stream':'application/json'});const base={id:'figma-test',object:'chat.completion',created:1,model:body.model,usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}};if(body.stream){res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:message,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:message.tool_calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');}else res.end(JSON.stringify({...base,choices:[{index:0,message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});return {requests,baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',mode:'compatible',model:'figma-test',allowWriteTools:false,allowFigmaWriteTools:true};}
const tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'call-'+Math.random(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('Agent writes use native receipts, continue after their own revision and reject changed user selection',async t=>{
  const f=await fixture(t),scope=await f.scope(true);
  const first=await scope.call('figma_update_nodes',{updates:[{nodeId:'1:1',text:'第一步真实插件场景修改',fill:'#3355EE'}]});assert.equal(first.acknowledged,true);assert.equal(f.plugin.text.characters,'第一步真实插件场景修改');assert.equal(f.plugin.undos,1);
  await scope.call('figma_update_nodes',{updates:[{nodeId:'1:1',width:310,height:80}]});assert.equal(f.plugin.text.width,310);assert.equal(f.plugin.undos,2);
  await assert.rejects(scope.forRole(true).call('figma_update_nodes',{updates:[{nodeId:'1:1',text:'forbidden'}]}),/只允许/);
  await assert.rejects(scope.call('figma_update_nodes',{updates:[{nodeId:'1:2',name:'outside capture'}]}),/不属于/);
  f.plugin.page.selection=[f.plugin.frame];f.plugin.figma.ui.postMessage({type:'selection-snapshot',snapshot:f.plugin.snapshot()});await pause(20);
  await assert.rejects(scope.call('figma_update_nodes',{updates:[{nodeId:'1:1',text:'stale write'}]}),/选区已变化/);assert.equal(f.plugin.text.characters,'第一步真实插件场景修改');
  const read=await scope.call('figma_get_node',{nodeId:'1:1'});assert.equal(read.acknowledged,true);
  await f.workspaceService.set(1,{url:'https://www.figma.com/design/OtherFile_456'});await assert.rejects(scope.call('figma_get_context',{}),/切换 Figma/);
});

test('read-only MCP exposes only real read tools and rejects browser calls, missing capability and forged writes',async t=>{
  const f=await fixture(t),scope=await f.scope(false),gateway=await createFigmaMcpGateway(scope);t.after(()=>gateway.close());const config=gateway.config.m0_figma;
  const request=(method,params={},headers=config.headers)=>fetch(config.url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal((await request('tools/list',{},{})).status,403);assert.equal((await request('tools/list',{},{...config.headers,origin:'null'})).status,403);
  const listed=await(await request('tools/list')).json();assert.equal(listed.result.tools.length,3);assert.ok(listed.result.tools.every(t=>!t.name.includes('update')&&!t.name.includes('create')));
  const denied=await(await request('tools/call',{name:'figma_update_nodes',arguments:{updates:[{nodeId:'1:1',text:'forged'}]}})).json();assert.equal(denied.result.isError,true);assert.equal(f.plugin.text.characters,'Initial');
  const read=await(await request('tools/call',{name:'figma_get_node',arguments:{nodeId:'1:1'}})).json();assert.equal(read.result.isError,false);assert.match(read.result.content[0].text,/acknowledged/);
});

test('compatible chat uses attached real Figma context and returns plugin ack to the model',async t=>{
  const f=await fixture(t),config=await model(t,body=>body.messages.some(m=>m.role==='tool')?{role:'assistant',content:'插件已确认修改。'}:tool('figma_update_nodes',{updates:[{nodeId:'1:1',text:'AI → HTTP → Plugin API fixture'}]}));
  const chat=createChatService({getModelConfig:()=>config,getWorkspace:()=>f.directory,dataDir:path.join(f.directory,'chat'),getFigmaIntegration:()=>({bridge:f.bridge,workspaceService:f.workspaceService})});
  const answer=await chat.respond('修改选中的文字',[],()=>{},undefined,{projectId:1,figmaContext:f.context,workspace:f.directory});assert.match(answer,/插件已确认/);assert.equal(f.plugin.text.characters,'AI → HTTP → Plugin API fixture');
  assert.ok(config.requests[0].tools.some(t=>t.function.name==='figma_update_nodes'));assert.ok(!config.requests[0].tools.some(t=>t.function.name==='write_file'));
  assert.match(config.requests[1].messages.find(m=>m.role==='tool').content,/"acknowledged":true/);
});

test('an acknowledged native creation authorizes only that new node for later writes in the same run',async t=>{
  const f=await fixture(t),scope=await f.scope(true),created=await scope.call('figma_create_frame',{name:'Agent-created frame',x:80,y:90,width:360,height:240,fill:'#3355EE'});
  assert.equal(created.acknowledged,true);const nodeId=created.data.nodeId;assert.ok(nodeId);assert.equal(f.plugin.page.selection[0].id,nodeId);assert.equal(f.plugin.undos,1);
  const updated=await scope.call('figma_update_nodes',{updates:[{nodeId,name:'Updated own frame',width:480,height:320,x:100}]});assert.equal(updated.acknowledged,true);assert.equal(f.plugin.nodes.get(nodeId).name,'Updated own frame');assert.equal(f.plugin.nodes.get(nodeId).width,480);assert.equal(f.plugin.nodes.get(nodeId).height,320);assert.equal(f.plugin.nodes.get(nodeId).x,100);assert.equal(f.plugin.undos,2);
  await assert.rejects(scope.call('figma_update_nodes',{updates:[{nodeId:'1:2',name:'Unselected old frame'}]}),/不属于|不在/);
  await assert.rejects(scope.call('figma_update_nodes',{updates:[{nodeId:'1:1',text:'Previously selected but no longer selected'}]}),/不属于|不在/);
  assert.equal(f.plugin.frame.name,'FRAME');assert.equal(f.plugin.text.characters,'Initial');assert.equal(f.plugin.undos,2);
  const read=await scope.forRole(true).call('figma_get_node',{nodeId});assert.equal(read.acknowledged,true);assert.equal(read.data.content.document.id,nodeId);
});

test('multi-Agent workflow enforces each task write policy and carries actual native receipts into the final summary',async t=>{
  const f=await fixture(t),scope=await f.scope(true),roles=new Map(),receipts=[];
  const plan={planDesc:'实际 Figma 设计修改、后续编码任务及只读复核',taskList:[
    {id:'design',name:'真实设计修改',task:'修改锁定文本并保留插件回执',agent:'m0-design-agent',readOnly:false,dependsOn:[]},
    {id:'code',name:'后续编码角色检查与调整',task:'读取设计产物后调整当前节点尺寸，保留插件回执',agent:'coding-core-agent',readOnly:false,dependsOn:['design']},
    {id:'read',name:'独立读取',task:'只读核对当前节点，不修改',agent:'explorer',readOnly:true,dependsOn:['code']},
  ]};
  const config=await model(t,body=>{
    const role=/\[M0_LOCAL_WORKFLOW_ROLE:([^\]]+)\]/.exec(body.messages.find(message=>message.role==='system')?.content||'')?.[1];assert.ok(role,'every request must identify its real workflow role');
    const requests=roles.get(role)||[];requests.push(body);roles.set(role,requests);const tools=body.messages.filter(message=>message.role==='tool'),names=(body.tools||[]).map(tool=>tool.function.name),writes=names.includes('figma_update_nodes');
    if(role==='summarizer'){
      assert.equal(names.length,0);const input=JSON.parse(body.messages.at(-1).content);assert.ok(input.outputs.find(output=>output.taskId==='design').output.includes('"acknowledged":true'));assert.ok(input.outputs.find(output=>output.taskId==='code').output.includes('"acknowledged":true'));assert.match(input.review,/只读/);
      return {role:'assistant',content:'设计与编码任务均收到真实插件成功回执；规划、探索与复核保持只读。'};
    }
    if(role==='m0-design-agent'||role==='coding-core-agent'){
      assert.equal(writes,true,'write tasks may use the separately enabled Figma tools regardless of business role name');
      if(!tools.length)return tool('figma_update_nodes',{updates:[role==='m0-design-agent'?{nodeId:'1:1',text:'Multi-Agent design → actual plugin receipt'}:{nodeId:'1:1',width:420,height:100}]});
      const acknowledged=JSON.parse(tools.at(-1).content);assert.equal(acknowledged.acknowledged,true);receipts.push({role,receipt:acknowledged});return {role:'assistant',content:role+' 实际产物 '+JSON.stringify(acknowledged)};
    }
    assert.ok(['planner','explorer','reviewer'].includes(role));assert.equal(writes,false,'read-only roles must not advertise native write tools');
    if(!tools.length)return tool('figma_update_nodes',{updates:[{nodeId:'1:1',text:'Forbidden '+role}]});
    assert.match(tools[0].content,/只允许|没有.*权限/,'forged model calls must be denied by the scoped executor');
    if(tools.length===1)return tool('figma_get_node',{nodeId:'1:1'});
    assert.equal(JSON.parse(tools[1].content).acknowledged,true);
    if(role==='planner')return {role:'assistant',content:JSON.stringify(plan)};
    return {role:'assistant',content:role+' 已只读核对真实 Figma 节点和回执，没有进行写入。'};
  });
  config.allowWriteTools=true;config.workflowMaxTasks=3;config.workflowMaxSteps=24;
  const service=createWorkflowService({getModelConfig:()=>config,getWorkspace:()=>f.directory,dataDir:path.join(f.directory,'workflow')});const steps=[],tools=[];
  const answer=await service.respond({prompt:'协作修改选中节点并分工检查',sessionId:'multi-figma-real-receipts',workspace:f.directory,figmaScope:scope,onStep:step=>steps.push({...step}),onTool:tool=>tools.push(tool)});
  assert.match(answer,/真实插件成功回执/);assert.equal(f.plugin.text.characters,'Multi-Agent design → actual plugin receipt');assert.equal(f.plugin.text.width,420);assert.equal(f.plugin.text.height,100);assert.equal(f.plugin.undos,2);assert.equal(receipts.length,2);assert.notEqual(receipts[0].receipt.commandId,receipts[1].receipt.commandId);
  for(const role of ['planner','m0-design-agent','coding-core-agent','explorer','reviewer','summarizer'])assert.ok(roles.has(role),role+' must really call the configured model');
  const run=service.getRun(service.listRuns({sessionId:'multi-figma-real-receipts'})[0].runId);assert.equal(run.status,'completed');assert.equal(run.steps.length,6);for(const step of run.steps)assert.equal(step.readOnly,!['m0-design-agent','coding-core-agent'].includes(step.role));assert.ok(run.outputs.filter(output=>['design','code'].includes(output.taskId)).every(output=>output.output.includes('"acknowledged":true')));assert.equal(f.ui.errors.length,0);
});

test('closing a scoped MCP gateway cancels its pending native write before resumed UI polling can mutate Figma',async t=>{
  const f=await fixture(t,{leaseMs:5}),scope=await f.scope(true),gateway=await createFigmaMcpGateway(scope.forRole(false));t.after(()=>gateway.close());await f.pausePump();
  const config=gateway.config.m0_figma,request=fetch(config.url,{method:'POST',headers:{'content-type':'application/json',...config.headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'figma_update_nodes',arguments:{updates:[{nodeId:'1:1',text:'Must never execute after gateway close'}]}}})}).then(response=>response.json()).catch(error=>({networkError:error.message}));
  const credentials=[...f.plugin.storage.values()][0],query=new URLSearchParams({fileKey:f.context.fileKey,sessionId:f.context.sessionId});
  // Observe the actual queued command without delivering it to the plugin
  // scene. The short lease expires before UI polling is resumed below.
  const command=await until(async()=>{const response=await fetch(f.origin+'/__local/figma/bridge/pull?'+query,{headers:{origin:'null',authorization:'Bearer '+credentials.token}});return (await response.json()).commands?.[0];});
  const resultURL=f.origin+'/__local/figma/bridge/results/'+command.id+'?'+new URLSearchParams({projectId:1,fileKey:f.context.fileKey,sessionId:f.context.sessionId});assert.equal((await(await fetch(resultURL)).json()).status,'pending');
  await gateway.close();await request;const cancelled=await(await fetch(resultURL)).json();assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.result,undefined);await pause(10);f.resumePump();await pause(40);await f.ui.tick();assert.equal(f.plugin.text.characters,'Initial');assert.equal(f.plugin.undos,0);assert.equal(f.ui.errors.length,0);
});

test('large export tool data explicitly marks its bounded preview as truncated instead of implying a complete SVG',async t=>{
  const f=await fixture(t),data={nodeId:'1:1',format:'SVG',mimeType:'image/svg+xml',encoding:'utf-8',content:'<svg>'+('x'.repeat(70000))+'</svg>'},calls=[];
  const mockBridge={getContext:f.bridge.getContext,async execute(command){calls.push(command);return {id:'large-export-receipt',ok:true,result:{ok:true,data}};}};
  const scope=await createFigmaAgentScope({bridge:mockBridge,workspaceService:f.workspaceService,projectId:1,context:f.context,allowWrite:false}),exported=await scope.call('figma_export_node',{nodeId:'1:1',format:'SVG'});
  assert.equal(exported.acknowledged,true);assert.equal(exported.commandId,'large-export-receipt');assert.equal(exported.data.truncated,true);assert.equal(exported.data.format,'SVG');assert.equal(exported.data.mimeType,'image/svg+xml');assert.equal(exported.data.nodeId,'1:1');assert.equal(exported.data.originalCharacters,JSON.stringify(data).length);assert.equal(exported.data.preview.length,32000);assert.equal(exported.data.content,undefined);assert.match(exported.data.message,/不完整/);assert.match(exported.data.message,/下载原始导出/);assert.equal(calls[0].type,'export-node');assert.equal(calls[0].fileKey,f.context.fileKey);assert.equal(calls[0].sessionId,f.context.sessionId);
});

test('recovered OpenCode discovers authenticated MCP tools and executes the real plugin bridge', {skip:process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(originalBinary),timeout:45000},async t=>{
  const f=await fixture(t),scope=await f.scope(true),gateway=await createFigmaMcpGateway(scope);t.after(()=>gateway.close());
  const config=await model(t,body=>{const name=body.tools?.find(t=>t.function.name.includes('figma_update_nodes'))?.function.name;if(name&&!body.messages.some(m=>m.role==='tool'))return tool(name,{updates:[{nodeId:'1:1',text:'Recovered OpenCode MCP → Plugin fixture'}]});return {role:'assistant',content:'原版引擎收到插件执行回执。'};});
  const engine=createOriginalOpenCode({dataDir:path.join(f.directory,'engine'),getWorkspace:()=>f.directory,timeoutMs:35000});
  const answer=await engine.run({config,agentPrompt:scope.prompt,mcpConfig:gateway.config,prompt:'修改锁定选区文字',sessionId:'figma-mcp-native'});assert.match(answer,/插件执行回执/);
  assert.ok(config.requests.some(r=>r.tools?.some(t=>t.function.name.includes('figma_update_nodes'))),'native engine must discover MCP tools');assert.equal(f.plugin.text.characters,'Recovered OpenCode MCP → Plugin fixture');assert.equal(f.plugin.undos,1);
  assert.ok(config.requests.some(r=>r.messages?.some(m=>m.role==='tool'&&JSON.stringify(m.content).includes('acknowledged'))));
});
