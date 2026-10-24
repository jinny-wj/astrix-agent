import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const semanticVersion=/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\s|\\[rn])*(?:[A-Za-z0-9+/=]|\s|\\[rn]){64,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{50,}/,/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/];

export function publicationLayout(projectRoot,repositoryRoot,version){
  if(!semanticVersion.test(version))throw Error('package.json needs a semantic version');
  const relative=path.relative(repositoryRoot,projectRoot);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Astrix project must be inside its Git repository');
  const prefix=relative.split(path.sep).join('/');
  return {prefix,pathspec:prefix||'.',version,versionFileSuffix:'v'+version,tag:'m0/v'+version,runtimeTag:'m0-runtime/v'+version};
}

export function changedPaths(porcelain){
  const records=porcelain.split('\0'),names=[];
  for(let index=0;index<records.length;index++){
    const record=records[index];if(!record)continue;
    if(record.length<4)throw Error('Invalid Git status response');
    names.push(record.slice(3));
    if(/[RC]/.test(record.slice(0,2))){
      const original=records[++index];if(!original)throw Error('Missing Git rename source');
      names.push(original);
    }
  }
  return [...new Set(names)];
}

function isProjectPath(name,prefix){return !prefix||name===prefix||name.startsWith(prefix+'/');}

export function rewriteReleaseNotes(notes,{repository,tag,prefix}){
  const base='https://github.com/'+repository+'/blob/'+encodeURIComponent(tag)+'/';
  return notes.replace(/\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)]+)\)/gi,(_all,target)=>{
    const resolved=path.posix.normalize(path.posix.join(prefix,'versions',target));
    if(resolved==='..'||resolved.startsWith('../'))throw Error('Release note link escapes the repository');
    return ']('+base+resolved.split('/').map(encodeURIComponent).join('/')+')';
  });
}

export function validatePublicationFiles({repositoryRoot,prefix,files}){
  for(const name of new Set(files)){
    if(!isProjectPath(name,prefix))throw Error('Git returned a file outside the Astrix project: '+name);
    const relative=prefix?name.slice(prefix.length+1):name;
    const file=path.join(repositoryRoot,name);
    // Deleted files may be removed, but a dangling link must still be rejected.
    let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(/(?:^|\/)(?:\.local-data|\.data|node_modules|diagnostics|\.release-assets|M0-AI-recovered)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/.test(relative)&&!relative.endsWith('.env.example'))throw Error('Refusing private/runtime file: '+name);
    if(/^(?:public\/|plugins\/recovered\/|frontend-tools\/extra-assets\/|desktop\/icon\.icns$)|(?:^|\/)resources-manifest\.json$/.test(relative))throw Error('Generated/native resources belong in a draft runtime Release: '+name);
    if(stat.isSymbolicLink()||!stat.isFile())throw Error('Review non-regular file before publication: '+name);
    if(stat.size>100*1024*1024)throw Error('Use a draft runtime Release for files over 100 MiB: '+name);
    const data=fs.readFileSync(file,'utf8');if(secretPatterns.some(pattern=>pattern.test(data)))throw Error('Review possible secret before publication: '+name);
  }
}

export function runtimeAssetNames(assetsDir,versionFileSuffix){
  if(!fs.existsSync(assetsDir))return [];
  const escaped=versionFileSuffix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const allowed=new RegExp('^(?:M0-AI-recovered-runtime|M0-local-resources)-'+escaped+'\\.(?:tar\\.gz|sha256|manifest\\.json)$');
  return fs.readdirSync(assetsDir).filter(name=>allowed.test(name)).sort().map(name=>{
    const stat=fs.lstatSync(path.join(assetsDir,name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('Runtime asset must be a regular file: '+name);
    return name;
  });
}

/** Tests inject a command runner, so they never mutate Git or GitHub. */
export function publishVersion({projectRoot=defaultRoot,args=process.argv.slice(2),runner=execFileSync,log=console.log}={}){
  if(args.some(arg=>arg!=='--publish')||new Set(args).size!==args.length)throw Error('Usage: npm run release -- [--publish]');
  const publish=args.includes('--publish');
  const run=(command,argv,options={})=>runner(command,argv,{cwd:projectRoot,encoding:'utf8',...options});
  const repositoryRoot=run('git',['rev-parse','--show-toplevel']).trim();
  const git=(...argv)=>run('git',argv,{cwd:repositoryRoot}).trim();
  const gitRaw=(...argv)=>run('git',argv,{cwd:repositoryRoot});
  const pkg=JSON.parse(fs.readFileSync(path.join(projectRoot,'package.json'),'utf8'));
  const layout=publicationLayout(projectRoot,repositoryRoot,pkg.version),{version,tag,runtimeTag,prefix,pathspec,versionFileSuffix}=layout;
  const lock=JSON.parse(fs.readFileSync(path.join(projectRoot,'package-lock.json'),'utf8'));
  if(lock.version!==version||lock.packages?.['']?.version!==version)throw Error('package-lock.json root versions do not match package.json');
  const note=path.join(projectRoot,'versions',versionFileSuffix+'.md');if(!fs.existsSync(note))throw Error('Missing versions/'+versionFileSuffix+'.md');
  const changelog=fs.readFileSync(path.join(projectRoot,'CHANGELOG.md'),'utf8');if(!changelog.includes(version))throw Error('CHANGELOG.md does not record '+version);
  const ledger=JSON.parse(fs.readFileSync(path.join(projectRoot,'versions/index.json'),'utf8'));
  const entry=ledger.versions?.find(entry=>entry.version===version);
  if(ledger.currentVersion!==version||entry?.tag!==tag||entry.recordType!=='source-release')throw Error('versions/index.json must record the current source version and '+tag);
  const branch=git('branch','--show-current');if(!branch)throw Error('Publish from a named branch');
  const remote=git('remote','get-url','origin');
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remote))throw Error('origin must identify the intended GitHub repository');
  const repository=remote.replace(/^https:\/\/github\.com\/|^git@github\.com:/,'').replace(/\.git$/,'');
  const assertScopedChanges=()=>{
    const names=changedPaths(gitRaw('status','--porcelain=v1','-z','--untracked-files=all'));
    const outside=names.filter(name=>!isProjectPath(name,prefix));
    if(outside.length)throw Error('Commit or set aside changes outside '+(prefix||'Astrix')+' before publishing: '+outside.join(', '));
    return names;
  };
  const changes=assertScopedChanges();
  const files=gitRaw('ls-files','--cached','--others','--exclude-standard','--full-name','-z','--',pathspec).split('\0').filter(Boolean);
  validatePublicationFiles({repositoryRoot,prefix,files});
  const publishedNotes=rewriteReleaseNotes(fs.readFileSync(note,'utf8'),{repository,tag,prefix});
  let existingTag=false;try{git('rev-parse','--verify','--quiet','refs/tags/'+tag);existingTag=true;}catch{}
  if(existingTag&&(changes.length||git('rev-list','-n','1',tag)!==git('rev-parse','HEAD')))throw Error('Version tag already exists. Keep it immutable and prepare a new version.');
  const assetsDir=path.join(projectRoot,'.release-assets'),assets=runtimeAssetNames(assetsDir,versionFileSuffix);
  const summary={repository,branch,version,tag,runtimeTag,prefix,files:new Set(files).size,changed:Boolean(changes.length),runtimeAssets:assets,mode:publish?'publish':'validate-only'};
  log(JSON.stringify(summary,null,2));
  if(!publish){log('Validation passed. --publish tests and publishes source notes; runtime assets remain in an unpublished draft.');return summary;}

  // Refresh origin first. Divergence needs explicit integration, never a force push.
  run('git',['fetch','origin'],{cwd:repositoryRoot,stdio:'inherit'});
  let remoteBranch=false;try{git('rev-parse','--verify','--quiet','refs/remotes/origin/'+branch);remoteBranch=true;}catch{}
  if(remoteBranch)run('git',['merge-base','--is-ancestor','refs/remotes/origin/'+branch,'HEAD'],{cwd:repositoryRoot,stdio:'inherit'});
  if(!existingTag){
    run('npm',['test'],{stdio:'inherit'});
    assertScopedChanges();
    const latestFiles=gitRaw('ls-files','--cached','--others','--exclude-standard','--full-name','-z','--',pathspec).split('\0').filter(Boolean);
    validatePublicationFiles({repositoryRoot,prefix,files:latestFiles});
    run('git',['add','--all','--',pathspec],{cwd:repositoryRoot,stdio:'inherit'});
    const staged=gitRaw('diff','--cached','--name-only','-z').split('\0').filter(Boolean);
    if(staged.some(name=>!isProjectPath(name,prefix)))throw Error('Refusing to commit staged changes outside the Astrix project');
    if(staged.length)run('git',['commit','-m','release: '+tag],{cwd:repositoryRoot,stdio:'inherit'});
    assertScopedChanges();
    run('git',['tag','-a',tag,'-F',note],{cwd:repositoryRoot,stdio:'inherit'});
  }
  const commit=git('rev-list','-n','1',tag);
  run('git',['push','--atomic','-u','origin',branch,'refs/tags/'+tag],{cwd:repositoryRoot,stdio:'inherit'});
  fs.mkdirSync(assetsDir,{recursive:true});
  const notesFile=path.join(assetsDir,'m0-'+versionFileSuffix+'.notes.md');fs.writeFileSync(notesFile,publishedNotes);
  const viewRelease=releaseTag=>{
    try{return JSON.parse(run('gh',['release','view',releaseTag,'--repo',repository,'--json','isDraft,assets,targetCommitish']));}
    catch(error){
      // A failed login or network request is not a missing Release.
      const detail=String(error.stderr||'')+' '+String(error.message||'');
      if(/not found|HTTP 404|release not found/i.test(detail))return null;
      throw error;
    }
  };
  let release=viewRelease(tag);
  if(!release){
    try{run('gh',['release','create',tag,'--repo',repository,'--verify-tag','--title','Astrix '+versionFileSuffix,'--notes-file',notesFile,'--latest=false'],{stdio:'inherit'});}
    catch(error){if(!viewRelease(tag))throw error;}
    release=viewRelease(tag);
  }
  if(!release)throw Error('Source Release was not created');
  if(release.assets?.length)throw Error('The public source Release has attachments; review it before continuing. Runtime files must remain draft-only.');
  if(release.isDraft)run('gh',['release','edit',tag,'--repo',repository,'--draft=false','--latest=false'],{stdio:'inherit'});

  if(assets.length){
    const runtimeNotes=path.join(assetsDir,'m0-runtime-'+versionFileSuffix+'.notes.md');
    fs.writeFileSync(runtimeNotes,'# Astrix '+versionFileSuffix+' 私有运行资源\n\n仅为未发布草稿，供仓库有权限的维护者下载。不得将此草稿发布为公开安装包。\n\n对应源码：'+commit+'\n公开版本记录：https://github.com/'+repository+'/releases/tag/'+encodeURIComponent(tag)+'\n\n这些附件与公开源码分开保存，不含个人项目、登录状态或模型配置。准备步骤和适用平台以源码文档与清单为准。\n');
    let draft=viewRelease(runtimeTag);
    if(!draft){
      try{run('gh',['release','create',runtimeTag,'--repo',repository,'--draft','--target',commit,'--title','Astrix runtime '+versionFileSuffix+' · draft only','--notes-file',runtimeNotes,'--latest=false'],{stdio:'inherit'});}
      catch(error){if(!viewRelease(runtimeTag))throw error;}
      draft=viewRelease(runtimeTag);
    }
    const assertDraft=value=>{
      if(!value?.isDraft)throw Error('Runtime Release must remain an unpublished draft; refusing to upload: '+runtimeTag);
      if(value.targetCommitish!==commit)throw Error('Runtime draft target does not match the exact source commit');
    };
    assertDraft(draft);
    for(const name of assets){
      draft=viewRelease(runtimeTag);assertDraft(draft);
      const existing=draft.assets?.find(asset=>asset.name===name);
      if(existing){
        if(existing.size!==undefined&&existing.size!==fs.statSync(path.join(assetsDir,name)).size)throw Error('Existing runtime asset differs in size: '+name);
        log('Keeping immutable existing draft asset: '+name);continue;
      }
      run('gh',['release','upload',runtimeTag,path.join(assetsDir,name),'--repo',repository],{stdio:'inherit'});
    }
    assertDraft(viewRelease(runtimeTag));
  }
  log('Published source notes https://github.com/'+repository+'/releases/tag/'+encodeURIComponent(tag));
  if(assets.length)log('Runtime assets remain in unpublished draft '+runtimeTag);
  return {...summary,commit};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))publishVersion();
