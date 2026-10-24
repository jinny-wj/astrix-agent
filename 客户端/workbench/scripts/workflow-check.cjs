'use strict';
const {getLayout}=require('../../../packages/astrix-workbench/layout.cjs');
const layout=getLayout();
const {app,BrowserWindow}=require('electron');
const {fork}=require('node:child_process');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),sandbox=path.join(root,'.local-data','workflow-ui-check');
app.setPath('userData',path.join(sandbox,'electron'));app.commandLine.appendSwitch('disable-background-networking');
const report={assertions:{},roles:[],consoleErrors:[]};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<160;i++){const value=await check();if(value)return value;await delay(100);}throw Error(label+' timed out');}
let server,model,win,origin,pauseExecution=false;
function createWindow(){
  const window=new BrowserWindow({show:true,width:1450,height:980,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.on('will-prevent-unload',event=>event.preventDefault());
  window.webContents.on('console-message',event=>{if(event.level==='error')report.consoleErrors.push(event.message);});
  return window;
}
app.whenReady().then(async()=>{
  await fs.mkdir(sandbox,{recursive:true});
  const workspace=path.join(sandbox,'workspace');await fs.mkdir(workspace,{recursive:true});
  await fs.writeFile(path.join(workspace,'README.md'),'M0_MULTI_AGENT_PROOF\n');
  model=http.createServer(async(req,res)=>{
    req.setEncoding('utf8');let input='';for await(const chunk of req)input+=chunk;const body=JSON.parse(input);
    const role=body.messages?.[0]?.content?.match(/\[M0_LOCAL_WORKFLOW_ROLE:([^\]]+)\]/)?.[1]||'unknown';report.roles.push(role);
    if(pauseExecution&&['explorer','coding-core-agent'].includes(role)){
      await new Promise(resolve=>{const timer=setTimeout(resolve,20000);res.once('close',()=>{clearTimeout(timer);resolve();});});
      if(res.destroyed)return;
    }
    const tool=body.messages?.find(message=>message.role==='tool');
    if(tool){if(!String(tool.content).includes('M0_MULTI_AGENT_PROOF'))throw Error('Agent did not read the captured project file');report.assertions.realFileToolResult=true;}
    const plan={planDesc:'并行核对当前项目后独立复核',taskList:[{id:'inspect',name:'检查项目文件',task:'读取README并说明',agent:'explorer',readOnly:true,dependsOn:[]},{id:'code',name:'检查实现',task:'读取README核对实现',agent:'coding-core-agent',readOnly:true,dependsOn:[]}]};
    const message=role==='planner'?{role:'assistant',content:JSON.stringify(plan)}
      :['explorer','coding-core-agent'].includes(role)&&!tool?{role:'assistant',content:null,tool_calls:[{id:'read-'+role,type:'function',function:{name:'read_file',arguments:'{"path":"README.md"}'}}]}
      :{role:'assistant',content:role==='summarizer'?'两个任务、独立复核与总结均已完成。':role==='reviewer'?'已复核两个真实产物。':'已读取当前项目 README，证据为 M0_MULTI_AGENT_PROOF。'};
    if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:message.content},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');}
    else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message}]}));}
  });
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));origin='http://127.0.0.1:'+port;
  server=fork(path.join(layout.webRoot,'server/index.mjs'),[],{execPath:process.execPath,execArgv:[],cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',M0_LOCAL_PORT:String(port),M0_LOCAL_DATA_DIR:path.join(sandbox,'data'),M0_LOCAL_WORKSPACE:workspace},silent:true});
  await until(async()=>{try{return(await fetch(origin+'/__local/health')).ok;}catch{return false;}},'Server ready');
  const post=async(route,body,method='POST')=>{const r=await fetch(origin+route,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;};
  const project=await post('/api/project/v2/create',{projectName:'多 Agent 界面验证',mode:'code',projectPath:workspace});
  await post('/__local/model',{mode:'compatible',engine:'local',workflow:'multi',model:'workflow-test',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,allowWriteTools:false},'PUT');
  win=createWindow();
  await win.loadURL(origin+'/__local/workflow');
  await until(()=>win.webContents.executeJavaScript(`document.getElementById('project').options.length>0`),'Project selector');
  await win.webContents.executeJavaScript(`document.getElementById('prompt').value='核对项目并复核结果';document.getElementById('run').click()`);
  const page=await until(()=>win.webContents.executeJavaScript(`({answer:document.getElementById('answer').innerText,status:document.getElementById('status').innerText,steps:document.querySelectorAll('#steps .step').length})`).then(value=>value.status.includes('本轮协作完成')?value:null),'Workflow completion');
  report.assertions.actualWorkflowPage=page.answer.includes('两个任务');report.assertions.fiveStepsShown=page.steps===5;
  const runs=await(await fetch(origin+'/__local/workflow/runs?projectId='+project.id)).json();
  report.assertions.persistedCompletedRun=runs.runs[0]?.status==='completed';
  const detail=await(await fetch(origin+'/__local/workflow/runs/'+runs.runs[0].runId)).json();
  report.scheduler=detail.scheduler;report.assertions.recoveredLangGraphUsed=detail.scheduler==='original-langgraph-local-graph';
  await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics/workflow-ui.png'),(await win.webContents.capturePage()).toPNG());
  await win.loadURL(origin+'/home');
  await until(()=>win.webContents.executeJavaScript(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Code'&&e.offsetWidth)`),'Recovered home mounted');
  await until(()=>win.webContents.executeJavaScript(`Boolean(window.__M0_WORKFLOW_MONITOR__)`),'Main chat progress monitor');
  const localSession=await post('/api/session/v2/create',{projectId:project.id});
  const stream=await win.webContents.executeJavaScript(`fetch('/api/agent/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:${JSON.stringify(localSession.sessionId)},projectId:${project.id},humanMessage:'再次协作验证主界面进度'})}).then(response=>response.text())`);
  report.assertions.mainStreamUnchanged=stream.includes('RUN_FINISHED')&&stream.includes('两个任务')&&!stream.includes('RUN_ERROR');
  const monitor=await win.webContents.executeJavaScript(`({visible:!!document.querySelector('.m0-workflow-panel'),steps:document.querySelectorAll('.m0-workflow-panel article').length,text:document.querySelector('.m0-workflow-panel')?.innerText})`);
  report.assertions.mainProgressVisible=monitor.visible&&monitor.steps===5&&monitor.text.includes('协作完成');
  await fs.writeFile(path.join(root,'diagnostics/workflow-main-progress.png'),(await win.webContents.capturePage()).toPNG());
  const uiSession=await post('/api/session/v2/create',{projectId:project.id});
  // Each explicit entry gets a fresh disposable window, keeping unrelated
  // recovered SPA startup redirects from racing a test-owned navigation.
  {const previous=win;win=createWindow();previous.destroy();}
  await win.loadURL(origin+'/aicode-v2?id='+project.id+'&mode=code&sessionId='+uiSession.sessionId);
  await until(()=>win.webContents.executeJavaScript(`!![...document.querySelectorAll('[contenteditable="true"]')].find(e=>e.offsetWidth)`),'Recovered chat input');
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('[contenteditable="true"]')].find(e=>e.offsetWidth).focus()`);
  win.webContents.insertText('请协作检查 README 并复核');
  await until(()=>win.webContents.executeJavaScript(`!![...document.querySelectorAll('[role="button"]')].find(e=>e.offsetWidth&&String(e.className).includes('bg-[#4080ff]')&&!String(e.className).includes('cursor-not-allowed'))`),'Recovered chat send enabled');
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('[role="button"]')].find(e=>e.offsetWidth&&String(e.className).includes('bg-[#4080ff]')&&!String(e.className).includes('cursor-not-allowed')).click()`);
  await until(()=>win.webContents.executeJavaScript(`document.body.innerText.includes('两个任务、独立复核与总结均已完成')&&document.querySelector('.m0-workflow-panel')?.innerText.includes('协作完成')`),'Recovered chat actual multi-agent reply');
  report.assertions.recoveredChatSendAndReply=true;
  const history=await(await fetch(origin+'/api/session/history_message?sessionId='+uiSession.sessionId)).json();
  report.assertions.recoveredChatHistorySaved=history.length===2&&history[1].messageEvents.some(event=>event.type==='CUSTOM'&&event.name==='local-workflow');
  await fs.writeFile(path.join(root,'diagnostics/workflow-original-chat.png'),(await win.webContents.capturePage()).toPNG());
  {const previous=win;win=createWindow();previous.destroy();}
  await win.loadURL(origin+'/__local/workflow');
  await until(()=>win.webContents.executeJavaScript(`document.getElementById('project').options.length>0`),'Cancellation test page ready');
  pauseExecution=true;
  await win.webContents.executeJavaScript(`document.getElementById('prompt').value='测试停止运行中的协作';document.getElementById('run').click()`);
  await until(()=>win.webContents.executeJavaScript(`!![...document.querySelectorAll('#steps .step[data-state="running"] strong')].find(e=>e.textContent==='检查项目文件')`),'An executing role before cancellation');
  await win.webContents.executeJavaScript(`document.getElementById('stop').click()`);
  await until(()=>win.webContents.executeJavaScript(`document.getElementById('status').textContent==='任务已停止'&&!document.querySelector('#steps .step[data-state="running"]')`),'Cancellation reflected in workflow UI');
  report.assertions.workflowStopUpdatesUI=true;
  await until(async()=>{const value=await(await fetch(origin+'/__local/workflow/runs?projectId='+project.id)).json();return value.runs.find(run=>run.prompt==='测试停止运行中的协作')?.status==='cancelled';},'Cancelled record persisted');
  report.assertions.cancelledRunPersisted=true;
  report.assertions.allRolesCalled=['planner','explorer','coding-core-agent','reviewer','summarizer'].every(role=>report.roles.includes(role));
  report.ok=Object.values(report.assertions).every(Boolean);if(!report.ok)throw Error('Workflow UI assertions failed');
}).catch(error=>{report.ok=false;report.error=error.stack;}).finally(async()=>{
  await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics/workflow-ui-check.json'),JSON.stringify(report,null,2));
  server?.kill('SIGTERM');model?.closeAllConnections();model?.close();console.log(JSON.stringify(report));app.exit(report.ok?0:1);
});
