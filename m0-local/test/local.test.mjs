import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createFiles} from '../server/files.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let temp,child,base,mock,mockURL;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(url,method='GET',body,headers={}) {
  const response=await fetch(base+url,{method,headers:{...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {response,data:await response.json()};
}
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'m0-local-test-'));
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,M0_LOCAL_PORT:String(port),M0_LOCAL_DATA_DIR:path.join(temp,'data'),M0_LOCAL_WORKSPACE:path.join(temp,'workspace')},stdio:['ignore','ignore','pipe']});
  let startupError='';child.stderr.on('data',chunk=>{startupError=(startupError+String(chunk)).slice(-3000);});
  let ready=false;
  for(let i=0;i<60;i++){try{if((await fetch(base+'/__local/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await delay(50);}
  assert.ok(ready,'test server started'+(startupError?'\n'+startupError:''));
  mock=http.createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const input=JSON.parse(text);assert.equal(input.model,'local-test');res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'模型连接测试成功'}}]}));});
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));mockURL=`http://127.0.0.1:${mock.address().port}/v1`;
});
after(async()=>{child?.kill('SIGTERM');if(mock)await new Promise(resolve=>mock.close(resolve));await delay(100);await fs.rm(temp,{recursive:true,force:true});});
test('original UI assets and local settings are served',async()=>{
  const html=await(await fetch(base+'/home')).text();assert.match(html,/index-8tYpB-jE\.js/);assert.match(html,/local-runtime/);
  const settings=await(await fetch(base+'/__local/settings')).text();assert.match(settings,/界面演示/);
});
test('project/session creation and chat history use original frontend contract',async()=>{
  const {data:project}=await request('/devops-api/project/v2/create','POST',{type:'cli',mode:'code',projectName:'本地测试'});assert.equal(typeof project.id,'number');
  const {data:session}=await request('/api/session/v2/create','POST',{projectId:project.id,sessionId:'ses_integration'});assert.equal(session.sessionId,'ses_integration');
  const response=await fetch(base+'/api/agent/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({humanMessage:'你好，本地工作台',sessionId:session.sessionId,projectId:project.id})});
  const text=await response.text();assert.match(text,/TEXT_MESSAGE_CONTENT/);assert.match(text,/chunkDetailId/);assert.match(text,/本地界面演示/);assert.match(text,/RUN_FINISHED/);
  const {data:history}=await request('/devops-api/session/history_message?sessionId='+session.sessionId);assert.equal(history.length,2);assert.equal(history[0].messageContent,'你好，本地工作台');assert.ok(history[0].messageContext);assert.ok(history[1].messageEvents.some(e=>e.type==='RUN_FINISHED'));
});
test('file persistence blocks traversal and symlink escape',async()=>{
  await request('/__local/file','PUT',{path:'src/test.txt',content:'可编辑文件'});
  const {data:file}=await request('/__local/file?path=src/test.txt');assert.equal(file.content,'可编辑文件');
  const {response}=await request('/__local/file?path=../../outside');assert.equal(response.status,400);
  const {data:currentWorkspace}=await request('/__local/rpc','POST',{method:'cli.getCwd',args:[]});
  const outside=path.join(temp,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.txt'),'private');await fs.symlink(outside,path.join(currentWorkspace,'escape'));
  const files=createFiles(currentWorkspace);await assert.rejects(()=>files.read('escape/secret.txt'),/工作区/);await assert.rejects(()=>files.write('escape/no.txt','bad'),/工作区/);
});
test('cross-origin writes are refused',async()=>{
  const {response}=await request('/__local/model','PUT',{mode:'demo'},{origin:'https://unrelated.example'});assert.equal(response.status,403);
});
test('configured model is called, secret stays out of public config',async()=>{
  const {response}=await request('/__local/model','PUT',{mode:'compatible',baseUrl:mockURL,model:'local-test',apiKey:'synthetic-test-key'});assert.equal(response.status,200);
  const {data:config}=await request('/__local/model');assert.equal(config.hasKey,true);assert.equal(config.apiKey,undefined);
  const {data:result}=await request('/__local/model/test','POST');assert.equal(result.message,'模型连接测试成功');
  const stored=await fs.stat(path.join(temp,'data','model.json'));assert.equal(stored.mode&0o777,0o600);
});
test('editor context follows project switching and management keeps project files',async()=>{
  const {data:first}=await request('/devops-api/project/v2/create','POST',{mode:'spark',projectName:'上下文项目 A'});
  const {data:firstContext}=await request('/__local/editor-context');
  assert.equal(firstContext.workspace,first.projectPath);assert.equal(firstContext.project.id,first.id);assert.ok(firstContext.entryFiles.includes('README.md'));
  const {data:same}=await request('/__local/editor-context');assert.equal(same.revision,firstContext.revision,'read-only context does not alter revision');
  await request('/api/session/v2/create','POST',{projectId:first.id,sessionId:'ses_manage'});
  await request('/api/message/create','POST',{sessionId:'ses_manage',messageRole:'user',messageContent:'可保留的上下文'});
  const {data:renamed}=await request('/devops-api/session/v2/update?sessionId=ses_manage','POST',{title:'已重命名会话'});assert.equal(renamed.title,'已重命名会话');
  const {data:renamedProject}=await request('/devops-api/project/v2/update?projectId='+first.id,'POST',{projectName:'新项目名称'});assert.equal(renamedProject.projectName,'新项目名称');
  const {data:second}=await request('/devops-api/project/v2/create','POST',{mode:'spark',projectName:'上下文项目 B'});
  const {data:secondContext}=await request('/__local/editor-context');assert.equal(secondContext.workspace,second.projectPath);assert.ok(secondContext.revision>firstContext.revision);
  await request('/devops-api/project/v2/info?sessionId=ses_manage');
  const {data:restored}=await request('/__local/editor-context');assert.equal(restored.workspace,first.projectPath);assert.equal(restored.project.id,first.id);
  const {data:history}=await request('/devops-api/session/history_message?sessionId=ses_manage');assert.equal(history[0].messageContent,'可保留的上下文');
  await request('/devops-api/session/v2/delete?sessionId=ses_manage','DELETE');
  const {data:empty}=await request('/devops-api/session/history_message?sessionId=ses_manage');assert.deepEqual(empty,[]);
  const {response:deleteResponse}=await request('/devops-api/project/v2/delete?projectId='+first.id,'DELETE');assert.equal(deleteResponse.status,200);
  const {data:afterDelete}=await request('/__local/editor-context');assert.notEqual(afterDelete.project?.id,first.id);assert.notEqual(afterDelete.workspace,first.projectPath);
  assert.ok((await fs.readFile(path.join(first.projectPath,'README.md'),'utf8')).includes('上下文项目 A'),'project files survive record deletion');
  const manager=await(await fetch(base+'/__local/projects')).text();assert.match(manager,/重命名项目/);assert.match(manager,/session\/v2\/update/);
});
test('file management and text-package import/export stay within the active project',async()=>{
  const {data:project}=await request('/devops-api/project/v2/create','POST',{mode:'spark',projectName:'文件管理'});
  await request('/__local/directory','POST',{path:'src/views'});
  await request('/__local/file','PUT',{path:'src/views/old.txt',content:'原文件'});
  const {response:renamed,data:rename}=await request('/__local/file/rename','POST',{path:'src/views/old.txt',newPath:'src/views/new.txt'});assert.equal(renamed.status,200);assert.equal(rename.path,'src/views/new.txt');
  const {data:file}=await request('/__local/file?path=src/views/new.txt');assert.equal(file.content,'原文件');
  await request('/__local/file','PUT',{path:'existing.txt',content:'不得覆盖'});
  const {response:collision}=await request('/__local/project/import','POST',{files:[{path:'must-not-be-created.txt',content:'new'},{path:'existing.txt',content:'replacement'}]});assert.equal(collision.status,409);
  await assert.rejects(()=>fs.access(path.join(project.projectPath,'must-not-be-created.txt')));
  const {response:imported}=await request('/__local/project/import','POST',{files:[{path:'generated/index.js',content:'export const local = true;'}]});assert.equal(imported.status,200);
  const {data:exported}=await request('/__local/project/export');assert.equal(exported.format,'m0-local-text-project-v1');assert.ok(exported.files.some(item=>item.path==='generated/index.js'));
  const {data:deleted}=await request('/__local/file?path=src/views','DELETE');assert.ok(deleted.trashId);await assert.rejects(()=>fs.access(path.join(project.projectPath,'src/views')));
  const {response:restored}=await request('/__local/file/restore','POST',{trashId:deleted.trashId});assert.equal(restored.status,200);assert.equal(await fs.readFile(path.join(project.projectPath,'src/views/new.txt'),'utf8'),'原文件');
  const {response:escape}=await request('/__local/file/rename','POST',{path:'existing.txt',newPath:'../outside.txt'});assert.equal(escape.status,400);
  const {response:rootDelete}=await request('/__local/file?path=.','DELETE');assert.equal(rootDelete.status,400);
  const {response:outsideImport}=await request('/__local/project/import','POST',{files:[{path:'../outside.txt',content:'bad'}]});assert.equal(outsideImport.status,400);
  assert.equal(await fs.readFile(path.join(project.projectPath,'existing.txt'),'utf8'),'不得覆盖');
});
