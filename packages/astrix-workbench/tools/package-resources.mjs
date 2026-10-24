#!/usr/bin/env node
// Layout 2 restores assets directly into the two application source trees.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {getLayout} from '../layout.cjs';
import {sanitizeRuntimeBytes} from './package-runtime.mjs';

const projectDefault=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repositoryDefault=getLayout().repositoryRoot;
const slash=value=>value.split(path.sep).join('/');
const under=(candidate,root)=>candidate===root||candidate.startsWith(root+path.sep);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const resourcePaths=['网页端/workbench/public','网页端/workbench/plugins/recovered','网页端/workbench/frontend-tools/extra-assets','客户端/workbench/desktop/icon.icns'];
const privatePath=relative=>relative.split('/').some(part=>['.git','.data','.local-data','.aws','.ssh','node_modules','diagnostics','.workbench-bundle','__pycache__'].includes(part)||/^\.env(?:\.|$)/i.test(part)||/^\.(?:npmrc|netrc)$/i.test(part)||/^(?:credentials|cookies|login-data|login data)$/i.test(part)||/\.(?:pem|key|p12|pfx)$/i.test(part));

export async function collectResources({sourceRoot=repositoryDefault}={}){
  sourceRoot=await fs.realpath(sourceRoot);
  const files=[];
  async function visit(file){
    const relative=slash(path.relative(sourceRoot,file));
    if(!under(file,sourceRoot)||privatePath(relative))throw new Error('Refusing private or escaping UI resource path: '+relative);
    if(path.basename(file)==='.DS_Store')return;
    const stat=await fs.lstat(file);
    if(stat.isSymbolicLink())throw new Error('UI resource symlinks are not permitted: '+relative);
    if(stat.isDirectory())for(const name of (await fs.readdir(file)).sort())await visit(path.join(file,name));
    else if(stat.isFile()){
      const real=await fs.realpath(file);if(!under(real,sourceRoot))throw new Error('UI resource resolves outside its source: '+relative);
      const bytes=await fs.readFile(file),clean=sanitizeRuntimeBytes(bytes,relative);
      files.push({source:file,path:relative,kind:'file',mode:stat.mode&0o777,bytes:clean.bytes.length,sha256:sha(clean.bytes),sourceSha256:sha(bytes),...(clean.redactions.length?{redactions:clean.redactions}:{})});
    }else throw new Error('Unsupported UI resource type: '+relative);
  }
  for(const relative of resourcePaths)await visit(path.join(sourceRoot,relative));
  const required=['网页端/workbench/public/index.html','网页端/workbench/plugins/recovered/manifest.json','网页端/workbench/frontend-tools/extra-assets/manifest.json'];
  for(const relative of required)if(!files.some(file=>file.path===relative))throw new Error('Required prepared UI resource is absent: '+relative);
  return {sourceRoot,files:files.sort((a,b)=>a.path.localeCompare(b.path))};
}

async function tar(args){return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/tar',args,{stdio:['ignore','ignore','pipe'],env:{...process.env,COPYFILE_DISABLE:'1'}});let stderr='';
  child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('tar failed ('+code+'): '+stderr.slice(0,3000))));
});}

export async function packageResources({projectRoot=projectDefault,sourceRoot=repositoryDefault,version,outputDir=path.join(projectRoot,'.release-assets')}={}){
  version??=JSON.parse(await fs.readFile(path.join(projectRoot,'package.json'),'utf8')).version;
  if(!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version))throw new Error('Invalid version');
  const plan=await collectResources({sourceRoot});
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-ui-release-')),stage=path.join(temporary,'repository');
  try{
    for(const record of plan.files){
      const bytes=await fs.readFile(record.source);
      if(sha(bytes)!==record.sourceSha256)throw new Error('UI source changed while packaging: '+record.path);
      const clean=sanitizeRuntimeBytes(bytes,record.path).bytes;
      if(sha(clean)!==record.sha256)throw new Error('UI resource sanitization changed: '+record.path);
      const output=path.join(stage,record.path);await fs.mkdir(path.dirname(output),{recursive:true});
      await fs.writeFile(output,clean);await fs.chmod(output,record.mode);
    }
    let sourceVersion;try{sourceVersion=JSON.parse(await fs.readFile(path.join(plan.sourceRoot,'packages/astrix-workbench/package.json'),'utf8')).version;}catch{}
    const files=plan.files.map(({source,...record})=>record);
    const manifest={format:'astrix-workbench-resources-v2',layoutVersion:2,projectVersion:version,...(sourceVersion?{sourceVersion}:{}),archiveRoot:'.',roots:{web:'网页端/workbench',desktop:'客户端/workbench',shared:'packages/astrix-workbench'},allowlist:resourcePaths,fileCount:files.length,totalBytes:files.reduce((n,file)=>n+file.bytes,0),files};
    const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    const manifestPath=path.join(stage,'packages/astrix-workbench/resources-manifest.json');await fs.mkdir(path.dirname(manifestPath),{recursive:true});await fs.writeFile(manifestPath,manifestBytes);
    await fs.mkdir(outputDir,{recursive:true});
    const base='M0-local-resources-v'+version,archive=path.join(outputDir,base+'.tar.gz'),pending=archive+'.tmp';
    await tar(['-czf',pending,'-C',stage,'.']);await fs.rename(pending,archive);
    const bytes=await fs.readFile(archive),digest=sha(bytes);
    const manifestFile=path.join(outputDir,base+'.manifest.json');await fs.writeFile(manifestFile,manifestBytes);await fs.writeFile(path.join(outputDir,base+'.sha256'),digest+'  '+path.basename(archive)+'\n');
    return {archive,manifest:manifestFile,sha256:digest,bytes:bytes.length,fileCount:files.length,layoutVersion:2};
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){const name=args[i];if(name==='--source')options.sourceRoot=path.resolve(args[++i]);else if(name==='--output')options.outputDir=path.resolve(args[++i]);else if(name==='--version')options.version=args[++i];else throw new Error('Unknown argument: '+name);}
  console.log(JSON.stringify(await packageResources(options),null,2));
}
