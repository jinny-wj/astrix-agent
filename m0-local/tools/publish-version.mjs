import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),publish=args.includes('--publish');
if(args.some(arg=>arg!=='--publish'))throw Error('Usage: npm run release -- [--publish]');
const run=(command,args,options={})=>execFileSync(command,args,{cwd:root,encoding:'utf8',...options});
const git=(...args)=>run('git',args).trim();
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),version=pkg.version,tag='v'+version;
if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw Error('package.json needs a semantic version');
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
if(lock.version!==version||lock.packages?.['']?.version!==version)throw Error('package-lock.json root versions do not match package.json');
const note=path.join(root,'versions',tag+'.md');if(!fs.existsSync(note))throw Error('Missing versions/'+tag+'.md');
const changelog=fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8');if(!changelog.includes(version))throw Error('CHANGELOG.md does not record '+version);
const ledger=JSON.parse(fs.readFileSync(path.join(root,'versions/index.json'),'utf8'));if(!JSON.stringify(ledger).includes('"'+version+'"'))throw Error('versions/index.json does not record '+version);
const branch=git('branch','--show-current');if(!branch)throw Error('Publish from a named branch');
const remote=git('remote','get-url','origin');if(!/^(?:https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remote))throw Error('origin must identify the intended GitHub repository');
const repository=remote.replace(/^https:\/\/github\.com\/|^git@github\.com:/,'').replace(/\.git$/,'');
const publishedNotes=fs.readFileSync(note,'utf8').replace(/\]\((?!https?:|#)([^)]+)\)/g,(_all,target)=>'](https://github.com/'+repository+'/blob/'+encodeURIComponent(tag)+'/'+path.posix.normalize('versions/'+target)+')');
const changed=git('status','--porcelain');
const files=run('git',['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\s|\\[rn])*(?:[A-Za-z0-9+/=]|\s|\\[rn]){64,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{50,}/,/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/];
for(const name of new Set(files)){
  if(/(?:^|\/)(?:\.local-data|\.data|node_modules|diagnostics|\.release-assets)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/.test(name)&&!name.endsWith('.env.example'))throw Error('Refusing private/runtime file: '+name);
  const file=path.join(root,name);if(!fs.existsSync(file))continue;
  const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Review non-regular file before publication: '+name);
  if(stat.size>100*1024*1024)throw Error('Use Release assets for files over 100 MiB: '+name);
  const data=fs.readFileSync(file,'utf8');if(secretPatterns.some(pattern=>pattern.test(data)))throw Error('Review possible secret before publication: '+name);
}
let existingTag=false;try{git('rev-parse','--verify','--quiet','refs/tags/'+tag);existingTag=true;}catch{}
if(existingTag&&(changed||git('rev-list','-n','1',tag)!==git('rev-parse','HEAD')))throw Error('Version tag already exists. Keep it immutable and prepare a new version.');
console.log(JSON.stringify({repository,branch,version,tag,files:new Set(files).size,changed:Boolean(changed),mode:publish?'publish':'validate-only'},null,2));
if(!publish){console.log('Validation passed. --publish runs tests, commits, tags, pushes and creates the GitHub Release.');process.exit(0);}
if(!existingTag){
  run('npm',['test'],{stdio:'inherit'});
  run('git',['add','--all'],{stdio:'inherit'});
  if(git('status','--porcelain'))run('git',['commit','-m',`release: ${tag}`],{stdio:'inherit'});
  run('git',['tag','-a',tag,'-F',note],{stdio:'inherit'});
}
run('git',['push','--atomic','--follow-tags','-u','origin',branch,'refs/tags/'+tag],{stdio:'inherit'});
const assetsDir=path.join(root,'.release-assets');fs.mkdirSync(assetsDir,{recursive:true});const notesFile=path.join(assetsDir,tag+'.notes.md');fs.writeFileSync(notesFile,publishedNotes);
let released=false;try{run('gh',['release','view',tag,'--repo',repository],{stdio:'ignore'});released=true;}catch{}
if(!released){try{run('gh',['release','create',tag,'--repo',repository,'--verify-tag','--title',tag,'--notes-file',notesFile],{stdio:'inherit'});}catch(error){try{run('gh',['release','view',tag,'--repo',repository],{stdio:'ignore'});}catch{throw error;}}}
if(fs.existsSync(assetsDir)){
  const names=fs.readdirSync(assetsDir).filter(name=>name.endsWith('-'+tag+'.tar.gz')||name.endsWith('-'+tag+'.sha256')||name.endsWith('-'+tag+'.manifest.json'));
  const release=JSON.parse(run('gh',['release','view',tag,'--repo',repository,'--json','assets']));
  for(const name of names){if(release.assets.some(asset=>asset.name===name)){console.log('Keeping immutable existing Release asset: '+name);continue;}run('gh',['release','upload',tag,path.join(assetsDir,name),'--repo',repository],{stdio:'inherit'});}
}
console.log('Published https://github.com/'+repository+'/releases/tag/'+tag);
