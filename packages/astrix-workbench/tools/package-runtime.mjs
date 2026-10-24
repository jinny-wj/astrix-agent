#!/usr/bin/env node
import {getLayout} from '../layout.cjs';
// Package only the recovered distributions used by the local adapters. This
// deliberately does not copy the original application's main process or config.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const here=path.dirname(fileURLToPath(import.meta.url));
const defaultRoot=path.resolve(here,'..');
const slash=value=>value.split(path.sep).join('/');
const under=(candidate,root)=>candidate===root||candidate.startsWith(root+path.sep);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const exists=async file=>fs.access(file).then(()=>true,()=>false);
export const promptFiles=[
  'node_modules/@m0/devops-common/src/agents-common/react-common/prompt/plan.ts',
  'node_modules/@m0/cli/dist/index-CvE2jyW2.js',
  'node_modules/@m0/cli/dist/graph-CmkX4wC1.js',
  'node_modules/@m0/devops-common/src/agents-common/react-common/prompt/summary.ts',
];
const resourceRoots=['extracted/resources/editor','extracted/resources/opencode-darwin-arm64','extracted/resources/skills'];
const forbidden=relative=>relative.split('/').some(part=>['.git','.data','.local-data','.aws','.ssh','diagnostics','__pycache__','.DS_Store'].includes(part)||/^\.env(?:\.|$)/i.test(part)||/^\.(?:npmrc|netrc)$/i.test(part)||/^(?:credentials|cookies|login-data|login data)$/i.test(part)||/\.(?:pem|key|p12|pfx)$/i.test(part));
const secretPatterns=[
  // A compiled crypto library contains the BEGIN marker as an ordinary parser
  // constant. A secret requires a complete encoded block, not that marker alone.
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\s|\\[rn])*(?:[A-Za-z0-9+/=]|\s|\\[rn]){64,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token',/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}/],
  ['openai-key',/(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['aws-key',/(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/],
];
const textExtensions=new Set(['.js','.cjs','.mjs','.ts','.cts','.mts','.json','.md','.txt','.yaml','.yml','.html','.xml','.sh']);

export function sanitizeRuntimeBytes(bytes,relative){
  const isText=textExtensions.has(path.extname(relative).toLowerCase()),redactions=[];
  let text=bytes.toString(isText?'utf8':'latin1');
  for(const [kind,pattern] of secretPatterns){
    if(!pattern.test(text))continue;
    if(!isText||kind==='private-key')throw new Error('Possible '+kind+' in runtime input: '+relative+' (value withheld)');
    const global=new RegExp(pattern.source,'g');let count=0;
    text=text.replace(global,()=>{count++;return '';});redactions.push({kind,count});
  }
  if(isText){
    const fields=/((?:["']?(?:authorization|apiKey|api_key|accessToken|access_token|secretKey|secret_key|clientSecret|client_secret)["']?)\s*:\s*)(["'])([^"'\r\n]{12,})\2/gi;
    let count=0;
    text=text.replace(fields,(_match,prefix,quote)=>{count++;return prefix+quote+quote;});
    if(count)redactions.push({kind:'static-credential-field',count});
    if(redactions.length&&path.extname(relative)==='.json')JSON.parse(text);
    if(relative==='extracted/resources/editor/package.json'){
      const metadata=JSON.parse(text);
      if(Object.hasOwn(metadata.scripts||{},'postinstall')){
        delete metadata.scripts.postinstall;
        redactions.push({kind:'unused-editor-postinstall-script',count:1});
        text=JSON.stringify(metadata,null,2)+'\n';
      }
    }
  }
  return {bytes:redactions.length?Buffer.from(text):bytes,redactions};
}

async function resolvePackage(name,from,appRoot){
  if(!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name))throw new Error('Invalid dependency name: '+name);
  // resolve.paths follows Node's nested node_modules lookup even if the package
  // export map intentionally hides package.json or has no root export.
  const require=createRequire(path.join(from,'package.json'));
  for(const base of require.resolve.paths(name)||[]){
    const candidate=path.join(base,name);
    if(!await exists(path.join(candidate,'package.json')))continue;
    const root=await fs.realpath(candidate);
    if(!under(root,path.join(appRoot,'node_modules')))throw new Error('Dependency escapes recovered node_modules: '+name);
    return root;
  }
  return null;
}

export async function dependencyClosure(appRoot,seeds=['@langchain/langgraph','@langchain/core']){
  appRoot=await fs.realpath(appRoot);
  const queue=seeds.map(name=>({name,from:appRoot,kind:'root',optional:false}));
  const packages=new Map(),omitted=[];
  while(queue.length){
    const request=queue.shift(),root=await resolvePackage(request.name,request.from,appRoot);
    if(!root){
      const typeOnly=request.name.startsWith('@types/');
      if(!request.optional&&!typeOnly)throw new Error('Missing required runtime dependency: '+request.name+' from '+slash(path.relative(appRoot,request.from)));
      omitted.push({name:request.name,from:slash(path.relative(appRoot,request.from)),kind:request.kind,reason:typeOnly?'type-declarations-not-installed':'optional-not-installed'});
      continue;
    }
    if(packages.has(root))continue;
    const metadata=await json(path.join(root,'package.json'));
    packages.set(root,{root,path:slash(path.relative(appRoot,root)),name:metadata.name||request.name,version:metadata.version||'unknown',exports:metadata.exports!==undefined});
    const dependencies={...metadata.dependencies,...metadata.optionalDependencies};
    for(const name of Object.keys(dependencies||{}).sort())queue.push({name,from:root,kind:'dependency',optional:Object.hasOwn(metadata.optionalDependencies||{},name)});
    for(const name of Object.keys(metadata.peerDependencies||{}).sort())queue.push({name,from:root,kind:'peer',optional:metadata.peerDependenciesMeta?.[name]?.optional===true});
  }
  return {packages:[...packages.values()].sort((a,b)=>a.path.localeCompare(b.path)),omitted};
}

export async function collectRuntime({sourceRoot,version}){
  version??=(await json(path.join(defaultRoot,'package.json'))).version;
  sourceRoot=await fs.realpath(sourceRoot);
  const files=new Map(),excluded=[];
  async function addFile(file,category,boundary){
    const relative=slash(path.relative(sourceRoot,file));
    if(!under(file,sourceRoot))throw new Error('Source path escapes recovered root');
    if(forbidden(relative)){excluded.push({path:relative,reason:'private-or-cache-path'});return;}
    const stat=await fs.lstat(file);
    if(stat.isSymbolicLink()){
      const target=await fs.readlink(file),resolved=await fs.realpath(file);
      if(path.isAbsolute(target)||!under(resolved,boundary))throw new Error('Unsafe symlink: '+relative);
      files.set(relative,{source:file,path:relative,category,kind:'symlink',target,bytes:Buffer.byteLength(target),sha256:sha(target)});
    }else if(stat.isFile()){
      files.set(relative,{source:file,path:relative,category,kind:'file',mode:stat.mode&0o777});
    }else if(stat.isDirectory()){
      for(const entry of (await fs.readdir(file)).sort())await addFile(path.join(file,entry),category,boundary);
    }else throw new Error('Unsupported source file type: '+relative);
  }
  for(const relative of resourceRoots){const directory=path.join(sourceRoot,relative);await addFile(directory,relative,await fs.realpath(directory));}
  const appRoot=path.join(sourceRoot,'extracted/app'),closure=await dependencyClosure(appRoot);
  async function addPackage(directory,boundary){
    for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(entry.name==='node_modules')continue; // Each nested dependency has its own closure entry.
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await addPackage(file,boundary);else await addFile(file,'workflow-dependency',boundary);
    }
  }
  for(const pkg of closure.packages)await addPackage(pkg.root,pkg.root);
  for(const relative of promptFiles)await addFile(path.join(appRoot,relative),'workflow-prompt',appRoot);
  const packageCache=new Map();
  async function sourcePackage(file){
    let directory=path.dirname(file);
    while(under(directory,sourceRoot)){
      if(!packageCache.has(directory)){
        const packageFile=path.join(directory,'package.json');
        const value=await exists(packageFile)?await json(packageFile):null;
        packageCache.set(directory,value?{name:value.name||path.basename(directory),version:value.version||'unknown',path:slash(path.relative(sourceRoot,packageFile))}:null);
      }
      if(packageCache.get(directory))return packageCache.get(directory);
      if(directory===sourceRoot)break;
      directory=path.dirname(directory);
    }
    return null;
  }
  for(const record of files.values()){
    record.sourcePackage=await sourcePackage(record.source);
    if(record.kind==='file'){
      const bytes=await fs.readFile(record.source);
      const sanitized=sanitizeRuntimeBytes(bytes,record.path);
      record.sourceSha256=sha(bytes);record.bytes=sanitized.bytes.length;record.sha256=sha(sanitized.bytes);
      if(sanitized.redactions.length)record.redactions=sanitized.redactions;
    }
  }
  const records=[...files.values()].sort((a,b)=>a.path.localeCompare(b.path));
  // Refuse links to files omitted by policy. No archive link may leave its tree.
  for(const record of records)if(record.kind==='symlink'){
    const target=slash(path.relative(sourceRoot,path.resolve(path.dirname(record.source),record.target)));
    if(!files.has(target))throw new Error('Symlink target was not selected: '+record.path);
  }
  return {sourceRoot,version,records,packages:closure.packages.map(({root,...rest})=>rest),omittedDependencies:closure.omitted,excluded};
}

function run(command,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],...options});let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',reject);child.on('exit',code=>code===0?resolve({stdout,stderr}):reject(new Error(command+' failed ('+code+'): '+stderr.slice(0,3000))));
  });
}

export async function verifyStagedRuntime(recoveryRoot){
  const script=`const {createRequire}=require('node:module');const path=require('node:path');
const req=createRequire(path.join(process.argv[1],'extracted/app/package.json'));
const {StateGraph,Annotation,START,END}=req('@langchain/langgraph');
const {BaseCallbackHandler}=req('@langchain/core/callbacks/base');
const state=Annotation.Root({value:Annotation({reducer:(_a,b)=>b,default:()=>0})});
const callbacks=[BaseCallbackHandler.fromMethods({name:'langchain_tracer',ignoreChain:true,ignoreLLM:true,ignoreAgent:true,ignoreRetriever:true,getRunTreeWithTracingConfig:()=>undefined})];
const graph=new StateGraph(state).addNode('increment',s=>({value:s.value+1})).addEdge(START,'increment').addEdge('increment',END).compile();
graph.invoke({value:41},{callbacks}).then(result=>{if(result.value!==42)throw Error('Unexpected graph result');console.log(JSON.stringify({graph:'passed',version:req('@langchain/langgraph/package.json').version,callback:'passed'}))}).catch(error=>{console.error(error.message);process.exitCode=1});`;
  const result=await run(process.execPath,['--input-type=commonjs','-e',script,recoveryRoot],{
    cwd:path.dirname(recoveryRoot),env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:path.dirname(recoveryRoot),LANG:'en_US.UTF-8',LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'},
  });
  return JSON.parse(result.stdout.trim());
}

export async function packageRuntime({projectRoot=defaultRoot,sourceRoot=getLayout({repositoryRoot:path.resolve(projectRoot,'../..')}).recoveryRoot,outputDir=path.join(projectRoot,'.release-assets'),version,verify=true}={}){
  version??=(await json(path.join(projectRoot,'package.json'))).version;
  if(!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version))throw new Error('Invalid version');
  const plan=await collectRuntime({sourceRoot,version});
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'m0-release-runtime-'));
  const stage=path.join(temporary,'M0-AI-recovered');
  try{
    await fs.mkdir(stage,{recursive:true});
    for(const record of plan.records){
      const output=path.join(stage,record.path);await fs.mkdir(path.dirname(output),{recursive:true});
      if(record.kind==='symlink')await fs.symlink(record.target,output);
      else{
        const bytes=await fs.readFile(record.source);
        if(sha(bytes)!==record.sourceSha256)throw new Error('Source changed while packaging: '+record.path);
        await fs.writeFile(output,sanitizeRuntimeBytes(bytes,record.path).bytes);await fs.chmod(output,record.mode);
        if(sha(await fs.readFile(output))!==record.sha256)throw new Error('Staged digest mismatch: '+record.path);
      }
    }
    const appPackage={name:'m0-recovered-workflow-runtime',version,private:true,type:'commonjs',description:'Minimal resolution anchor; original application main/preload/config are excluded.'};
    const appBytes=Buffer.from(JSON.stringify(appPackage,null,2)+'\n');
    await fs.writeFile(path.join(stage,'extracted/app/package.json'),appBytes);
    const generated={path:'extracted/app/package.json',category:'generated-resolution-anchor',kind:'file',mode:0o644,bytes:appBytes.length,sha256:sha(appBytes),sourcePackage:null};
    const verification=verify?await verifyStagedRuntime(stage):{graph:'skipped'};
    const files=[...plan.records.map(({source,...record})=>record),generated].sort((a,b)=>a.path.localeCompare(b.path));
    let sourceRuntime;
    const sourceManifest=path.join(plan.sourceRoot,'runtime-manifest.json');
    if(await exists(sourceManifest)){
      const bytes=await fs.readFile(sourceManifest),prior=JSON.parse(bytes);
      sourceRuntime={format:prior.format,projectVersion:prior.projectVersion,manifestSha256:sha(bytes)};
    }
    const manifest={format:'m0-recovered-runtime-v1',projectVersion:version,platform:'darwin',arch:'arm64',archiveRoot:'M0-AI-recovered',...(sourceRuntime?{sourceRuntime}:{}),dependencyPolicy:'Node nested resolution; all declared runtime dependencies and installed optional/peer packages; package contents preserved except nested node_modules handled separately.',packages:plan.packages,omittedDependencies:plan.omittedDependencies,excluded:plan.excluded,verification,fileCount:files.length,totalBytes:files.reduce((n,f)=>n+f.bytes,0),files};
    const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(stage,'runtime-manifest.json'),manifestBytes);
    await fs.mkdir(outputDir,{recursive:true});
    const base='M0-AI-recovered-runtime-v'+version,archive=path.join(outputDir,base+'.tar.gz');
    const pending=archive+'.tmp';
    await run('/usr/bin/tar',['-czf',pending,'-C',temporary,'M0-AI-recovered'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
    await fs.rename(pending,archive);
    const archiveBytes=await fs.readFile(archive),archiveSha256=sha(archiveBytes);
    await fs.writeFile(path.join(outputDir,base+'.manifest.json'),manifestBytes);
    await fs.writeFile(path.join(outputDir,base+'.sha256'),archiveSha256+'  '+path.basename(archive)+'\n');
    return {archive,manifest:path.join(outputDir,base+'.manifest.json'),sha256:archiveSha256,bytes:archiveBytes.length,fileCount:files.length,dependencyPackages:plan.packages.length,verification};
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    const name=args[i];
    if(name==='--source')options.sourceRoot=path.resolve(args[++i]);
    else if(name==='--output')options.outputDir=path.resolve(args[++i]);
    else if(name==='--version')options.version=args[++i];
    else throw new Error('Unknown argument: '+name);
  }
  console.log(JSON.stringify(await packageRuntime(options),null,2));
}
