import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {changedPaths,publicationLayout,publishVersion,rewriteReleaseNotes,runtimeAssetNames,validatePublicationFiles,publicationPathspecs,isProjectPath,validateApplicationVersions,publicationStagePaths} from '../tools/publish-version.mjs';

function fixture(t,{dirty=true,existingTag=false,runtimeAssets=true}={}){
  const repositoryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'m0-publication-')),projectRoot=path.join(repositoryRoot,'sample-workbench');
  t.after(()=>fs.rmSync(repositoryRoot,{recursive:true,force:true}));
  const write=(name,value)=>{const file=path.join(projectRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file;};
  write('package.json',{version:'0.6.1'});write('package-lock.json',{version:'0.6.1',packages:{'':{version:'0.6.1'}}});
  write('CHANGELOG.md','# 0.6.1');write('versions/index.json',{currentVersion:'0.6.1',versions:[{version:'0.6.1',recordType:'source-release',tag:'m0/v0.6.1'}]});
  write('versions/v0.6.1.md','# M0 0.6.1\n\n[Guide](../docs/接入指南.md) · [Evidence](evidence/result.json)');
  write('source.mjs','export const value=42;');
  const assetNames=['M0-AI-recovered-runtime-v0.6.1.tar.gz','M0-local-resources-v0.6.1.manifest.json'];
  if(runtimeAssets){for(const name of assetNames)write('.release-assets/'+name,'fixture runtime resource');write('.release-assets/Astrix-installer-v0.6.1.dmg','excluded');write('.release-assets/M0-local-resources-v0.6.0.tar.gz','other version');}
  const state={dirty,tag:existingTag,head:'a'.repeat(40),outside:'',staged:[],releases:new Map(),calls:[],authError:false,afterTest:null};
  const runner=(command,argv,options={})=>{
    state.calls.push({command,argv:[...argv],cwd:options.cwd});
    if(command==='npm'){assert.deepEqual(argv,['test']);state.afterTest?.();return '';}
    if(command==='git'){
      if(argv.join(' ')==='rev-parse --show-toplevel')return repositoryRoot+'\n';
      assert.equal(options.cwd,repositoryRoot,'Git commands must use the repository root');
      if(argv[0]==='branch')return 'main\n';
      if(argv[0]==='remote')return 'https://github.com/jinny-wj/astrix-agent.git\n';
      if(argv[0]==='status')return (state.dirty?' M sample-workbench/source.mjs\0':'')+state.outside;
      if(argv[0]==='ls-files'){assert.deepEqual(argv.slice(-2),['--','sample-workbench']);return ['package.json','package-lock.json','CHANGELOG.md','versions/index.json','versions/v0.6.1.md','source.mjs'].map(name=>'sample-workbench/'+name).join('\0')+'\0';}
      if(argv[0]==='rev-parse'&&argv[1]==='--verify'){
        if(argv.at(-1).startsWith('refs/remotes/origin/'))return state.head+'\n';
        if(!state.tag)throw Error('no tag');return state.head+'\n';
      }
      if(argv[0]==='rev-parse'&&argv[1]==='HEAD')return state.head+'\n';
      if(argv[0]==='rev-list')return state.head+'\n';
      if(argv[0]==='fetch'||argv[0]==='merge-base'||argv[0]==='push')return '';
      if(argv[0]==='add'){state.staged=state.dirty?['sample-workbench/source.mjs']:[];return '';}
      if(argv[0]==='diff')return state.staged.join('\0')+(state.staged.length?'\0':'');
      if(argv[0]==='commit'){state.dirty=false;state.staged=[];state.head='b'.repeat(40);return '';}
      if(argv[0]==='tag'){state.tag=true;return '';}
    }
    if(command==='gh'){
      assert.equal(argv[0],'release');const action=argv[1],tag=argv[2];
      if(action==='view'){
        if(state.authError){const error=Error('GitHub authentication failed');error.stderr='HTTP 401';throw error;}
        const release=state.releases.get(tag);if(!release){const error=Error('release not found');error.stderr='release not found';throw error;}return JSON.stringify(release);
      }
      if(action==='create'){
        const target=argv.includes('--target')?argv[argv.indexOf('--target')+1]:state.head;
        state.releases.set(tag,{isDraft:argv.includes('--draft'),assets:[],targetCommitish:target});return '';
      }
      if(action==='edit'){state.releases.get(tag).isDraft=false;return '';}
      if(action==='upload'){
        const file=argv[3];state.releases.get(tag).assets.push({name:path.basename(file),size:fs.statSync(file).size});return '';
      }
    }
    throw Error('Unexpected command: '+command+' '+argv.join(' '));
  };
  const publish=args=>publishVersion({projectRoot,args,runner,log(){}});
  return {repositoryRoot,projectRoot,write,state,publish,assetNames};
}

test('monorepo layout separates public tag, runtime draft tag and artifact version suffix',()=>{
  assert.deepEqual(publicationLayout('/repo/sample-workbench','/repo','0.6.1'),{prefix:'sample-workbench',pathspec:'sample-workbench',version:'0.6.1',versionFileSuffix:'v0.6.1',tag:'m0/v0.6.1',runtimeTag:'m0-runtime/v0.6.1'});
  assert.throws(()=>publicationLayout('/elsewhere','/repo','0.6.1'),/inside/);
  assert.throws(()=>publicationLayout('/repo/sample-workbench','/repo','0.6.1/other'),/semantic/);
});

test('porcelain parsing preserves spaces and checks both sides of renames',()=>{
  assert.deepEqual(changedPaths(' M sample-workbench/a b.mjs\0R  sample-workbench/new.mjs\0客户端/old.mjs\0?? README.md\0'),['sample-workbench/a b.mjs','sample-workbench/new.mjs','客户端/old.mjs','README.md']);
});

test('release note links use the namespaced ref and monorepo directory',()=>{
  const result=rewriteReleaseNotes('[Guide](../docs/接入.md) [Evidence](evidence/result.json) [Web](https://example.com) [Anchor](#x)',{repository:'jinny-wj/astrix-agent',tag:'m0/v0.6.1',prefix:'sample-workbench'});
  assert.match(result,/blob\/m0%2Fv0\.6\.1\/sample-workbench\/docs\/%E6%8E%A5%E5%85%A5\.md/);
  assert.match(result,/sample-workbench\/versions\/evidence\/result\.json/);
  assert.ok(result.includes('[Web](https://example.com) [Anchor](#x)'));
  assert.throws(()=>rewriteReleaseNotes('[Bad](../../../outside)',{repository:'x/y',tag:'m0/v1.0.0',prefix:'sample-workbench'}),/escapes/);
});

test('default validation reads Git but never stages, tests, tags, pushes or calls GitHub',t=>{
  const f=fixture(t),summary=f.publish([]);
  assert.equal(summary.tag,'m0/v0.6.1');assert.deepEqual(summary.runtimeAssets,[...f.assetNames].sort());
  assert.ok(f.state.calls.every(call=>call.command==='git'&&['rev-parse','branch','remote','status','ls-files'].includes(call.argv[0])));
  assert.ok(!fs.existsSync(path.join(f.projectRoot,'.release-assets/m0-v0.6.1.notes.md')));
});

test('publishing stages only scoped source, preserves unrelated tags, and keeps all runtime attachments draft-only',t=>{
  const f=fixture(t),result=f.publish(['--publish']);
  assert.equal(result.commit,'b'.repeat(40));
  assert.deepEqual(f.state.calls.find(call=>call.command==='git'&&call.argv[0]==='add').argv,['add','--all','--','sample-workbench']);
  assert.deepEqual(f.state.calls.find(call=>call.command==='git'&&call.argv[0]==='commit').argv,['commit','-m','release: Astrix v0.6.1']);
  const push=f.state.calls.find(call=>call.command==='git'&&call.argv[0]==='push');
  assert.deepEqual(push.argv,['push','--atomic','-u','origin','main','refs/tags/m0/v0.6.1']);assert.ok(!push.argv.includes('--follow-tags'));
  const creates=f.state.calls.filter(call=>call.command==='gh'&&call.argv[1]==='create');
  assert.ok(creates.every(call=>call.argv.includes('--latest=false')));
  const runtime=creates.find(call=>call.argv[2]==='m0-runtime/v0.6.1');assert.ok(runtime.argv.includes('--draft'));assert.equal(runtime.argv[runtime.argv.indexOf('--target')+1],result.commit);
  assert.deepEqual(f.state.releases.get('m0/v0.6.1').assets,[]);
  assert.equal(f.state.releases.get('m0-runtime/v0.6.1').isDraft,true);
  assert.deepEqual(f.state.releases.get('m0-runtime/v0.6.1').assets.map(asset=>asset.name),[...f.assetNames].sort());
  assert.ok(f.state.calls.filter(call=>call.command==='gh'&&call.argv[1]==='upload').every(call=>call.argv[2]==='m0-runtime/v0.6.1'));
});

test('unrelated dirty or renamed files are rejected before any mutation',t=>{
  const f=fixture(t);f.state.outside='R  sample-workbench/moved.mjs\0客户端/old.mjs\0';
  assert.throws(()=>f.publish(['--publish']),/outside sample-workbench.*客户端\/old\.mjs/);
  assert.ok(!f.state.calls.some(call=>call.command!=='git'||['add','commit','tag','fetch','push'].includes(call.argv[0])));
});

test('new outside changes created during tests stop staging and publication',t=>{
  const f=fixture(t);f.state.afterTest=()=>{f.state.outside=' M README.md\0';};
  assert.throws(()=>f.publish(['--publish']),/outside sample-workbench.*README/);
  assert.ok(!f.state.calls.some(call=>call.command==='git'&&['add','commit','tag','push'].includes(call.argv[0])));
});

test('existing immutable tags reject source changes but allow an exact clean retry',t=>{
  const dirty=fixture(t,{existingTag:true});assert.throws(()=>dirty.publish([]),/already exists/);
  const clean=fixture(t,{existingTag:true,dirty:false,runtimeAssets:false});clean.publish(['--publish']);
  assert.ok(!clean.state.calls.some(call=>call.command==='npm'||call.command==='git'&&['add','commit','tag'].includes(call.argv[0])));
  assert.ok(!clean.state.releases.has('m0-runtime/v0.6.1'));
});

test('a published runtime Release or mismatched draft target never receives uploads',t=>{
  for(const runtime of [{isDraft:false,targetCommitish:'a'.repeat(40)},{isDraft:true,targetCommitish:'c'.repeat(40)}]){
    const f=fixture(t,{existingTag:true,dirty:false});f.state.releases.set('m0-runtime/v0.6.1',{...runtime,assets:[]});
    assert.throws(()=>f.publish(['--publish']),/unpublished draft|exact source commit/);
    assert.ok(!f.state.calls.some(call=>call.command==='gh'&&call.argv[1]==='upload'));
  }
});

test('GitHub authentication failures are not treated as missing Releases',t=>{
  const f=fixture(t,{existingTag:true,dirty:false});f.state.authError=true;
  assert.throws(()=>f.publish(['--publish']),/authentication/);
  assert.ok(!f.state.calls.some(call=>call.command==='gh'&&call.argv[1]==='create'));
});

test('source publication rejects generated resources, private paths and symlinks',t=>{
  const f=fixture(t);
  for(const name of ['public/app.js','plugins/recovered/plugin.js','frontend-tools/extra-assets/a.png','desktop/icon.icns','resources-manifest.json','.local-data/config.json','.local-archive/state.json']){
    f.write(name,'fixture');assert.throws(()=>validatePublicationFiles({repositoryRoot:f.repositoryRoot,prefix:'sample-workbench',files:['sample-workbench/'+name]}),/Generated\/native|private\/runtime/);
  }
  const link=path.join(f.projectRoot,'source-link.mjs');fs.symlinkSync('source.mjs',link);
  assert.throws(()=>validatePublicationFiles({repositoryRoot:f.repositoryRoot,prefix:'sample-workbench',files:['sample-workbench/source-link.mjs']}),/non-regular/);
  fs.symlinkSync('missing-file.mjs',path.join(f.projectRoot,'dangling.mjs'));
  assert.throws(()=>validatePublicationFiles({repositoryRoot:f.repositoryRoot,prefix:'sample-workbench',files:['sample-workbench/dangling.mjs']}),/non-regular/);
});

test('runtime allowlist excludes unrelated versions and installer files, and rejects links',t=>{
  const f=fixture(t),directory=path.join(f.projectRoot,'.release-assets');
  assert.deepEqual(runtimeAssetNames(directory,'v0.6.1'),[...f.assetNames].sort());
  fs.symlinkSync('M0-AI-recovered-runtime-v0.6.1.tar.gz',path.join(directory,'M0-local-resources-v0.6.1.tar.gz'));
  assert.throws(()=>runtimeAssetNames(directory,'v0.6.1'),/regular file/);
});

test('root workflow is limited to M0 source tags and has valid shell syntax',()=>{
  const projectRoot=path.resolve(import.meta.dirname,'..');
  const workflow=fs.readFileSync(path.join(projectRoot,'../../.github/workflows/m0-release.yml'),'utf8');
  assert.match(workflow,/'m0\/v\[0-9\]\*'/);assert.match(workflow,/contents\/packages\/astrix-workbench\/versions\//);
  assert.ok(workflow.includes('--latest=false'));assert.ok(!workflow.includes('release upload'));
  assert.ok(!fs.existsSync(path.join(projectRoot,'.github/workflows/release.yml')));
  const script=workflow.slice(workflow.indexOf('        run: |\n')+'        run: |\n'.length).split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
  const result=spawnSync('bash',['-n'],{input:script,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});

test('workflow rewrites notes and tolerates concurrent source publication without uploading resources',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'m0-workflow-publication-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const bin=path.join(directory,'bin');fs.mkdirSync(bin);
  const fakeGh=path.join(bin,'gh');
  fs.writeFileSync(fakeGh,'#!'+process.execPath+'\n'+String.raw`
const fs=require('node:fs');
const path=require('node:path');
const args=process.argv.slice(2),base=process.env.STUB_DIRECTORY;
fs.appendFileSync(path.join(base,'calls.jsonl'),JSON.stringify(args)+'\n');
if(args[0]==='api'){
  if(!args[1].includes('contents/packages/astrix-workbench/versions/v0.6.1.md?ref='))throw Error('Wrong source path');
  process.stdout.write(Buffer.from('[Guide](../docs/接入.md)').toString('base64')+'\n');
}else if(args[0]==='release'&&args[1]==='view'){
  if(process.env.STUB_MODE==='auth'){process.stderr.write('HTTP 401: authentication failed\n');process.exit(1);}
  if(!fs.existsSync(path.join(base,'created'))){process.stderr.write('release not found\n');process.exit(1);}
  process.stdout.write(JSON.stringify({isDraft:false,assets:[]}));
}else if(args[0]==='release'&&args[1]==='create'){
  if(!args.includes('--latest=false')||args.includes('--draft'))throw Error('Wrong public release flags');
  fs.writeFileSync(path.join(base,'created'),'1');
  if(process.env.STUB_MODE==='race'){process.stderr.write('Release already exists\n');process.exit(1);}
}else throw Error('Unexpected command '+args.join(' '));
`);fs.chmodSync(fakeGh,0o755);
  const workflow=fs.readFileSync(path.resolve(import.meta.dirname,'../../../.github/workflows/m0-release.yml'),'utf8');
  const script=workflow.slice(workflow.indexOf('        run: |\n')+'        run: |\n'.length).split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
  for(const mode of ['normal','race','auth']){
    const runDirectory=path.join(directory,mode);fs.mkdirSync(runDirectory);
    const result=spawnSync('bash',['-c',script],{cwd:runDirectory,encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,STUB_DIRECTORY:runDirectory,STUB_MODE:mode,GH_REPO:'jinny-wj/astrix-agent',TAG:'m0/v0.6.1',COMMIT:'a'.repeat(40)}});
    const calls=fs.readFileSync(path.join(runDirectory,'calls.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    if(mode==='auth'){
      assert.notEqual(result.status,0);assert.ok(!calls.some(args=>args[1]==='create'));
    }else{
      assert.equal(result.status,0,result.stderr);
      assert.match(fs.readFileSync(path.join(runDirectory,'release-notes.md'),'utf8'),/blob\/m0%2Fv0\.6\.1\/packages\/astrix-workbench\/docs\/%E6%8E%A5%E5%85%A5\.md/);
      assert.ok(calls.some(args=>args[1]==='create'&&args[2]==='m0/v0.6.1'));
    }
    assert.ok(!calls.some(args=>args[1]==='upload'||args[2]?.startsWith('m0-runtime/')));
  }
});


test('split layout publication explicitly scopes both applications and excludes the retired application directory',t=>{
  const repositoryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'astrix-split-publication-'));t.after(()=>fs.rmSync(repositoryRoot,{recursive:true,force:true}));
  const projectRoot=path.join(repositoryRoot,'packages/astrix-workbench');
  const layout=publicationLayout(projectRoot,repositoryRoot,'0.7.0');
  assert.deepEqual(layout.pathspec,publicationPathspecs);assert.throws(()=>publicationLayout(repositoryRoot,repositoryRoot,'0.7.0'),/entire repository/);
  const write=(name)=>{const file=path.join(repositoryRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'source');return name;};
  for(const name of ['网页端/workbench/server/application.mjs','客户端/workbench/desktop/main.cjs','网页端/src/pages/WorkbenchPage.tsx','客户端/desktop/main.ts','客户端/.env.example','packages/astrix-workbench/versions/v0.7.0.md','README.md']){
    write(name);assert.ok(isProjectPath(name,layout.prefix));validatePublicationFiles({repositoryRoot,prefix:layout.prefix,files:[name]});
  }
  for(const name of ['m0-local/server/index.mjs','m0-local/.local-data/account.json']){
    assert.ok(!isProjectPath(name,layout.prefix));
    assert.throws(()=>validatePublicationFiles({repositoryRoot,prefix:layout.prefix,files:[name]}),/outside/);
    write(name);assert.throws(()=>validatePublicationFiles({repositoryRoot,prefix:layout.prefix,files:[name]}),/outside/);
  }
  assert.ok(!publicationPathspecs.includes('m0-local'));
  assert.ok(publicationStagePaths(repositoryRoot,publicationPathspecs,['m0-local/server/index.mjs']).every(name=>!name.startsWith('m0-local')));
  for(const name of ['网页端/workbench/public/index.html','客户端/workbench/desktop/icon.icns','网页端/workbench/.local-data/account.json','客户端/workbench/diagnostics/report.json','packages/astrix-workbench/.release-assets/archive.tar.gz','客户端/.env','客户端/.env.local','网页端/.env.local','客户端/src/.env','客户端/.workbench-bundle/workbench/public/index.html']){
    write(name);assert.throws(()=>validatePublicationFiles({repositoryRoot,prefix:layout.prefix,files:[name]}),/private\/runtime|Generated\/native|outside/);
  }
  assert.throws(()=>validatePublicationFiles({repositoryRoot,prefix:layout.prefix,files:['docs/reference/private.pdf']}),/outside/);
  assert.ok(!publicationPathspecs.includes('.'));
});


test('both application package versions and lockfiles must match the shared release',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrix-version-sync-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const surface of ['客户端','网页端']){fs.mkdirSync(path.join(root,surface));fs.writeFileSync(path.join(root,surface,'package.json'),JSON.stringify({version:'0.7.0'}));fs.writeFileSync(path.join(root,surface,'pnpm-lock.yaml'),'lockfileVersion: 9.0');}
  validateApplicationVersions(root,'0.7.0');
  fs.writeFileSync(path.join(root,'客户端/package.json'),JSON.stringify({version:'0.6.2'}));assert.throws(()=>validateApplicationVersions(root,'0.7.0'),/must match/);
  fs.writeFileSync(path.join(root,'客户端/package.json'),JSON.stringify({version:'0.7.0'}));fs.unlinkSync(path.join(root,'网页端/pnpm-lock.yaml'));assert.throws(()=>validateApplicationVersions(root,'0.7.0'),/lockfile/);
});


test('publication staging omits nonexistent optional configuration but retains tracked deletions',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrix-stage-paths-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'客户端/workbench'),{recursive:true});
  assert.deepEqual(publicationStagePaths(root,['客户端/workbench','package.json','README.md'],['README.md']),['客户端/workbench','README.md']);
});

test('migrated generator verification output is ignored and rejected even if explicitly selected for publication',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrix-verification-output-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const name='网页端/workbench/plugins/verification-output/generated-view.tsx';
  fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),'generated test output');
  assert.throws(()=>validatePublicationFiles({repositoryRoot:root,prefix:'packages/astrix-workbench',files:[name]}),/Generated\/native/);
  const repositoryRoot=path.resolve(import.meta.dirname,'../../..');
  const ignored=spawnSync('git',['check-ignore','--no-index','-z','--stdin'],{cwd:repositoryRoot,encoding:'utf8',input:name+'\0'});
  assert.equal(ignored.status,0,ignored.stderr);assert.equal(ignored.stdout,name+'\0');
});
