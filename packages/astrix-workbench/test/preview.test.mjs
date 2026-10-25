import {getLayout} from '../layout.cjs';
const layout=getLayout();
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=layout.webRoot;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let temp,workspaceA,workspaceB,distWorkspace,emptyWorkspace,base,child;

async function fetchPreview(url,options={}){return fetch(base+url,{redirect:'manual',...options});}
async function selectWorkspace(directory){
  const response=await fetchPreview('/__local/workspace',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({path:directory})});
  assert.equal(response.status,200);assert.equal((await response.json()).path,directory);
}
async function mint(){
  const response=await fetchPreview('/__local/preview',{headers:{origin:base}});
  assert.equal(response.status,302);
  const location=response.headers.get('location');
  assert.match(location,/^\/__local\/preview\/[a-f0-9]{48}\/index\.html$/);
  return {location,prefix:location.slice(0,-'index.html'.length)};
}

before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'m0-preview-test-'));
  workspaceA=path.join(temp,'project-a');workspaceB=path.join(temp,'project-b');distWorkspace=path.join(temp,'dist-project');emptyWorkspace=path.join(temp,'no-html-project');
  for(const directory of [workspaceA,workspaceB,path.join(distWorkspace,'dist'),emptyWorkspace])await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(workspaceA,'index.html'),'<!doctype html><title>Project A</title><link rel="stylesheet" href="/style.css"><h1>Project A</h1><script type="module" src="/module.mjs"></script>');
  await fs.writeFile(path.join(workspaceA,'style.css'),"body{color:purple;background-image:url('/logo.svg')}");
  await fs.writeFile(path.join(workspaceA,'module.mjs'),"import {value} from './dependency.js'; document.body.dataset.value=value;");
  await fs.writeFile(path.join(workspaceA,'dependency.js'),"export const value='local-module';");
  await fs.writeFile(path.join(workspaceA,'logo.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(path.join(workspaceA,'component.ts'),'export const value: string = "not-built";');
  await fs.writeFile(path.join(workspaceA,'.env'),'SYNTHETIC_SECRET=must-not-be-served');
  await fs.mkdir(path.join(workspaceA,'node_modules'));await fs.writeFile(path.join(workspaceA,'node_modules','private.js'),'private dependency');
  const outside=path.join(temp,'outside.txt');await fs.writeFile(outside,'OUTSIDE_PREVIEW_ROOT');await fs.symlink(outside,path.join(workspaceA,'escape.txt'));
  await fs.writeFile(path.join(workspaceB,'index.html'),'<!doctype html><h1>Project B</h1>');
  await fs.writeFile(path.join(distWorkspace,'dist','index.html'),'<!doctype html><h1>Built dist preview</h1><link rel="stylesheet" href="/style.css">');
  await fs.writeFile(path.join(distWorkspace,'dist','style.css'),'body{color:green}');
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));base=`http://127.0.0.1:${port}`;
  let output='';
  child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,ASTRIX_PORT:String(port),ASTRIX_DATA_DIR:path.join(temp,'data'),ASTRIX_WORKSPACE:workspaceA,FIGMA_OAUTH_CLIENT_ID:'',FIGMA_OAUTH_CLIENT_SECRET:'',FIGMA_OAUTH_REDIRECT_URI:''},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',chunk=>output=(output+String(chunk)).slice(-4000));
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/__local/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await delay(50);}
  assert.ok(ready,'preview test server started: '+output);
  const oauth=await fetch(base+'/api/auth/figma/session');assert.equal(oauth.status,200);
  assert.deepEqual(await oauth.json(),{configured:false,authenticated:false,user:null},'preview fixture must not use application OAuth credentials or sessions');
});
after(async()=>{child?.kill('SIGTERM');await delay(100);await fs.rm(temp,{recursive:true,force:true});});

test('capabilities have fresh random tokens and serve rewritten HTML/CSS/modules with confined headers',async()=>{
  const first=await mint(),second=await mint();assert.notEqual(first.prefix,second.prefix);
  const html=await fetchPreview(first.location,{headers:{origin:'null'}});assert.equal(html.status,200);
  assert.match(html.headers.get('content-type'),/^text\/html/);
  assert.equal(html.headers.get('access-control-allow-origin'),'null');assert.equal(html.headers.get('cross-origin-resource-policy'),'cross-origin');
  assert.equal(html.headers.get('x-content-type-options'),'nosniff');assert.equal(html.headers.get('referrer-policy'),'no-referrer');assert.equal(html.headers.get('cache-control'),'no-store');
  const policy=html.headers.get('content-security-policy');assert.match(policy,/sandbox allow-scripts/);assert.doesNotMatch(policy,/allow-same-origin/);assert.ok(policy.includes('connect-src '+base+first.prefix));assert.match(policy,/frame-src 'none'/);
  const text=await html.text();assert.ok(text.includes('href="'+first.prefix+'style.css"'));assert.ok(text.includes('src="'+first.prefix+'module.mjs"'));
  const css=await fetchPreview(first.prefix+'style.css',{headers:{origin:'null'}});assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/^text\/css/);assert.ok((await css.text()).includes("url('"+first.prefix+'logo.svg'));
  for(const file of ['module.mjs','dependency.js']){const response=await fetchPreview(first.prefix+file,{headers:{origin:'null'}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/javascript/);assert.equal(response.headers.get('access-control-allow-origin'),'null');}
  const head=await fetchPreview(first.location,{method:'HEAD',headers:{origin:'null'}});assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('opaque Origin null can use a valid preview capability but cannot mint one or call app APIs',async()=>{
  const capability=await mint();
  for(const url of ['/__local/preview','/__local/preview/']){const denied=await fetchPreview(url,{headers:{origin:'null'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);}
  const allowed=await fetchPreview(capability.location,{headers:{origin:'null'}});assert.equal(allowed.status,200);
  const foreign=await fetchPreview(capability.location,{headers:{origin:'https://unrelated.example'}});assert.equal(foreign.status,403);
  const invalid=await fetchPreview('/__local/preview/'+('0'.repeat(48))+'/index.html',{headers:{origin:'null'}});assert.equal(invalid.status,404);
  for(const url of ['/__local/model','/__local/editor-context','/api/session/list']){const denied=await fetchPreview(url,{headers:{origin:'null'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);}
  const write=await fetchPreview(capability.location,{method:'POST',headers:{origin:'null'}});assert.equal(write.status,405);
});

test('preview rejects encoded traversal, hidden files, dependencies, unsupported files and escaping symlinks',async()=>{
  const capability=await mint();
  for(const relative of ['%2e%2e%2foutside.txt','%2e%2e%5coutside.txt','.env','node_modules/private.js','escape.txt']){
    const response=await fetchPreview(capability.prefix+relative,{headers:{origin:'null'}});assert.equal(response.status,403,relative);assert.doesNotMatch(await response.text(),/OUTSIDE_PREVIEW_ROOT|SYNTHETIC_SECRET=/);
  }
  const unsupported=await fetchPreview(capability.prefix+'component.ts',{headers:{origin:'null'}});assert.equal(unsupported.status,415);
  const missing=await fetchPreview(capability.prefix+'missing.js',{headers:{origin:'null'}});assert.equal(missing.status,404);
});

test('a capability remains bound to its captured project when the active workspace changes',async()=>{
  const original=await mint();await selectWorkspace(workspaceB);
  const next=await mint();assert.notEqual(next.prefix,original.prefix);
  const first=await fetchPreview(original.location,{headers:{origin:'null'}}),second=await fetchPreview(next.location,{headers:{origin:'null'}});
  assert.match(await first.text(),/Project A/);assert.match(await second.text(),/Project B/);
  await selectWorkspace(workspaceA);
});

test('dist is a real static fallback, root index wins, and projects without HTML get a friendly inert notice',async()=>{
  await selectWorkspace(distWorkspace);const built=await mint();
  assert.match(await(await fetchPreview(built.location,{headers:{origin:'null'}})).text(),/Built dist preview/);
  const style=await fetchPreview(built.prefix+'style.css',{headers:{origin:'null'}});assert.equal(style.status,200);assert.match(await style.text(),/green/);
  await fs.writeFile(path.join(distWorkspace,'index.html'),'<!doctype html><h1>Root entry wins</h1>');const rootEntry=await mint();
  assert.match(await(await fetchPreview(rootEntry.location,{headers:{origin:'null'}})).text(),/Root entry wins/);
  await selectWorkspace(emptyWorkspace);const notice=await fetchPreview('/__local/preview',{headers:{origin:base}});assert.equal(notice.status,200);assert.equal(notice.headers.get('location'),null);
  assert.match(await notice.text(),/还没有 HTML 预览入口/);const policy=notice.headers.get('content-security-policy');assert.match(policy,/sandbox/);assert.doesNotMatch(policy,/allow-scripts/);assert.equal(notice.headers.get('access-control-allow-origin'),null);
  await selectWorkspace(workspaceA);
});
