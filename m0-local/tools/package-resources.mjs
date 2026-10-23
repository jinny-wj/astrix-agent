#!/usr/bin/env node
// Generated UI assets are distributed separately from the Astrix source tree.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {sanitizeRuntimeBytes} from './package-runtime.mjs';

const projectDefault=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const slash=value=>value.split(path.sep).join('/');
const under=(candidate,root)=>candidate===root||candidate.startsWith(root+path.sep);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const resourcePaths=['public','plugins/recovered','frontend-tools/extra-assets','desktop/icon.icns'];
const privatePath=relative=>relative.split('/').some(part=>['.git','.data','.local-data','.aws','.ssh','node_modules','diagnostics','__pycache__'].includes(part)||/^\.env(?:\.|$)/i.test(part)||/^\.(?:npmrc|netrc)$/i.test(part)||/^(?:credentials|cookies|login-data|login data)$/i.test(part)||/\.(?:pem|key|p12|pfx)$/i.test(part));

export async function collectResources({sourceRoot=projectDefault}){
  sourceRoot=await fs.realpath(sourceRoot);
  const files=[];
  async function visit(file){
    const relative=slash(path.relative(sourceRoot,file));
    if(!under(file,sourceRoot)||privatePath(relative))throw new Error('Refusing private or escaping UI resource path: '+relative);
    if(path.basename(file)==='.DS_Store')return;
    const stat=await fs.lstat(file);
    if(stat.isSymbolicLink())throw new Error('UI resource symlinks are not permitted: '+relative);
    if(stat.isDirectory()){
      for(const name of (await fs.readdir(file)).sort())await visit(path.join(file,name));
    }else if(stat.isFile()){
      const real=await fs.realpath(file);if(!under(real,sourceRoot))throw new Error('UI resource resolves outside its source: '+relative);
      const bytes=await fs.readFile(file),clean=sanitizeRuntimeBytes(bytes,relative);
      files.push({source:file,path:relative,kind:'file',mode:stat.mode&0o777,bytes:clean.bytes.length,sha256:sha(clean.bytes),sourceSha256:sha(bytes),...(clean.redactions.length?{redactions:clean.redactions}:{})});
    }else throw new Error('Unsupported UI resource type: '+relative);
  }
  for(const relative of resourcePaths)await visit(path.join(sourceRoot,relative));
  const required=['public/index.html','plugins/recovered/manifest.json','frontend-tools/extra-assets/manifest.json'];
  for(const relative of required)if(!files.some(file=>file.path===relative))throw new Error('Required prepared UI resource is absent: '+relative);
  return {sourceRoot,files:files.sort((a,b)=>a.path.localeCompare(b.path))};
}

async function tar(args,options){
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/tar',args,{stdio:['ignore','ignore','pipe'],env:{...process.env,COPYFILE_DISABLE:'1'},...options});let stderr='';
    child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('tar failed ('+code+'): '+stderr.slice(0,3000))));
  });
}

export async function packageResources({projectRoot=projectDefault,sourceRoot=projectRoot,version,outputDir=path.join(projectRoot,'.release-assets')}={}){
  version??=JSON.parse(await fs.readFile(path.join(projectRoot,'package.json'),'utf8')).version;
  if(!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version))throw new Error('Invalid version');
  const plan=await collectResources({sourceRoot});
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'m0-ui-release-')),stage=path.join(temporary,'m0-local');
  try{
    for(const record of plan.files){
      const bytes=await fs.readFile(record.source);
      if(sha(bytes)!==record.sourceSha256)throw new Error('UI source changed while packaging: '+record.path);
      const clean=sanitizeRuntimeBytes(bytes,record.path).bytes;
      if(sha(clean)!==record.sha256)throw new Error('UI resource sanitization changed: '+record.path);
      const output=path.join(stage,record.path);await fs.mkdir(path.dirname(output),{recursive:true});
      await fs.writeFile(output,clean);await fs.chmod(output,record.mode);
    }
    let sourceVersion;
    try{sourceVersion=JSON.parse(await fs.readFile(path.join(plan.sourceRoot,'package.json'),'utf8')).version;}catch{}
    const files=plan.files.map(({source,...record})=>record);
    const manifest={format:'m0-ui-resources-v1',projectVersion:version,...(sourceVersion?{sourceVersion}:{}),archiveRoot:'m0-local',allowlist:resourcePaths,fileCount:files.length,totalBytes:files.reduce((n,file)=>n+file.bytes,0),files};
    const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(stage,'resources-manifest.json'),manifestBytes);
    await fs.mkdir(outputDir,{recursive:true});
    const base='M0-local-resources-v'+version,archive=path.join(outputDir,base+'.tar.gz'),pending=archive+'.tmp';
    await tar(['-czf',pending,'-C',temporary,'m0-local']);await fs.rename(pending,archive);
    const archiveBytes=await fs.readFile(archive),archiveSha256=sha(archiveBytes);
    await fs.writeFile(path.join(outputDir,base+'.manifest.json'),manifestBytes);
    await fs.writeFile(path.join(outputDir,base+'.sha256'),archiveSha256+'  '+path.basename(archive)+'\n');
    return {archive,manifest:path.join(outputDir,base+'.manifest.json'),sha256:archiveSha256,bytes:archiveBytes.length,fileCount:files.length};
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--source-root')options.sourceRoot=path.resolve(args[++i]);
    else if(args[i]==='--output')options.outputDir=path.resolve(args[++i]);
    else if(args[i]==='--version')options.version=args[++i];
    else throw new Error('Unknown argument: '+args[i]);
  }
  console.log(JSON.stringify(await packageResources(options),null,2));
}
