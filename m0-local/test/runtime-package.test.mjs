import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {collectRuntime,dependencyClosure,packageRuntime,promptFiles,sanitizeRuntimeBytes} from '../tools/package-runtime.mjs';

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-package-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const sourceRoot=path.join(directory,'recovered'),app=path.join(sourceRoot,'extracted/app');
  const write=async(relative,value)=>{const file=path.join(sourceRoot,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value));return file;};
  await write('extracted/resources/editor/package.json',{name:'editor',version:'1.2.3',scripts:{postinstall:'unneeded command',start:'editor'}});
  await write('extracted/resources/editor/out/entry.js','module.exports = "editor";');
  await write('extracted/resources/opencode-darwin-arm64/bin/opencode','sample executable');
  await write('extracted/resources/skills/example/SKILL.md','# Example');
  await write('extracted/app/package.json',{name:'original-business-app',version:'9.9.9',main:'out/main.js'});
  await write('extracted/app/node_modules/@langchain/langgraph/package.json',{name:'@langchain/langgraph',version:'0.3.9',exports:{'.':'./index.cjs'},dependencies:{shared:'1','@types/missing':'1'},peerDependencies:{optional:'*'},peerDependenciesMeta:{optional:{optional:true}}});
  await write('extracted/app/node_modules/@langchain/langgraph/index.cjs','module.exports = require("shared");');
  await write('extracted/app/node_modules/@langchain/langgraph/node_modules/shared/package.json',{name:'shared',version:'1.0.0',main:'index.js'});
  await write('extracted/app/node_modules/@langchain/langgraph/node_modules/shared/index.js','module.exports=1;');
  await write('extracted/app/node_modules/@langchain/core/package.json',{name:'@langchain/core',version:'0.3.64',dependencies:{shared:'2'},exports:{'./callbacks/base':'./callback.cjs'}});
  await write('extracted/app/node_modules/@langchain/core/callback.cjs','module.exports={};');
  await write('extracted/app/node_modules/shared/package.json',{name:'shared',version:'2.0.0',main:'index.js'});
  await write('extracted/app/node_modules/shared/index.js','module.exports=2;');
  for(const file of promptFiles)await write('extracted/app/'+file,'const prompt = `A prompt`;');
  await write('original/installation.bin','never package');
  await write('extracted/app/out/main.js','never package');
  await write('extracted/app/node_modules/unrelated/package.json',{name:'unrelated',version:'1.0.0'});
  return {directory,sourceRoot,app,write};
}

test('closure preserves nested Node resolution, exported subpaths, and records absent optional/types packages',async t=>{
  const f=await fixture(t),result=await dependencyClosure(f.app);
  assert.equal(result.packages.length,4);
  assert.deepEqual(result.packages.filter(p=>p.name==='shared').map(p=>p.version).sort(),['1.0.0','2.0.0']);
  assert.ok(result.packages.find(p=>p.name==='@langchain/core').exports);
  assert.deepEqual(result.omitted.map(p=>p.reason).sort(),['optional-not-installed','type-declarations-not-installed']);
  await f.write('extracted/app/node_modules/shared/package.json',{name:'shared',version:'2.0.0',dependencies:{missing:'1'}});
  await assert.rejects(dependencyClosure(f.app),/Missing required runtime dependency: missing/);
});

test('allowlist excludes original app and private paths while preserving safe editor symlinks',async t=>{
  const f=await fixture(t);
  await f.write('extracted/resources/editor/.env','private-value');
  await f.write('extracted/resources/editor/.local-data/session.json','private-value');
  const link=path.join(f.sourceRoot,'extracted/resources/editor/entry-link.js');
  await fs.symlink('out/entry.js',link);
  const result=await collectRuntime({sourceRoot:f.sourceRoot});
  assert.ok(result.records.some(f=>f.kind==='symlink'&&f.path.endsWith('/entry-link.js')));
  assert.ok(result.excluded.some(f=>f.path.endsWith('/.env')));
  assert.ok(!result.records.some(f=>f.path.startsWith('original/')||f.path.endsWith('out/main.js')||f.path.includes('/unrelated/')||f.path.includes('.local-data')));
  assert.ok(result.records.find(f=>f.path.endsWith('editor/package.json')).redactions.some(r=>r.kind==='unused-editor-postinstall-script'));
  await fs.unlink(link);await fs.symlink('../../../original/installation.bin',link);
  await assert.rejects(collectRuntime({sourceRoot:f.sourceRoot}),/Unsafe symlink/);
});

test('archive contains only allowlisted files with verified hashes and a new resolution anchor',async t=>{
  const f=await fixture(t),outputDir=path.join(f.directory,'assets');
  const result=await packageRuntime({projectRoot:f.directory,sourceRoot:f.sourceRoot,version:'0.6.0',outputDir,verify:false});
  const extracted=path.join(f.directory,'extract');await fs.mkdir(extracted);
  const unpack=spawnSync('/usr/bin/tar',['-xzf',result.archive,'-C',extracted],{encoding:'utf8'});assert.equal(unpack.status,0,unpack.stderr);
  const root=path.join(extracted,'M0-AI-recovered'),manifest=JSON.parse(await fs.readFile(path.join(root,'runtime-manifest.json')));
  assert.equal(manifest.packages.length,4);assert.ok(!await fs.access(path.join(root,'original')).then(()=>true,()=>false));
  for(const record of manifest.files){
    const bytes=await fs.readFile(path.join(root,record.path));
    assert.equal(bytes.length,record.bytes,record.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,record.path);
  }
  const anchor=JSON.parse(await fs.readFile(path.join(root,'extracted/app/package.json')));
  assert.equal(anchor.name,'m0-recovered-workflow-runtime');assert.equal(anchor.main,undefined);
  const editor=JSON.parse(await fs.readFile(path.join(root,'extracted/resources/editor/package.json')));
  assert.equal(editor.scripts.postinstall,undefined);assert.equal(editor.scripts.start,'editor');
  assert.ok(result.sha256.match(/^[a-f0-9]{64}$/));
});

test('static credentials are removed only from derived text and complete private keys/binary secrets stop packaging',()=>{
  const sample='ghp_'+'A'.repeat(40),source=Buffer.from(JSON.stringify({apiKey:'sensitive-value-123',nested:sample}));
  const result=sanitizeRuntimeBytes(source,'package.json');
  assert.ok(result.redactions.length>=2);assert.ok(!result.bytes.toString().includes(sample));assert.ok(!result.bytes.toString().includes('sensitive-value-123'));
  assert.ok(source.toString().includes(sample));
  assert.throws(()=>sanitizeRuntimeBytes(Buffer.from(sample),'bin/executable'),/github-token/);
  assert.doesNotThrow(()=>sanitizeRuntimeBytes(Buffer.from('const header="-----BEGIN PRIVATE KEY-----";'),'parser.js'));
  const key='-----BEGIN PRIVATE KEY-----\n'+'A'.repeat(128)+'\n-----END PRIVATE KEY-----';
  assert.throws(()=>sanitizeRuntimeBytes(Buffer.from(key),'fixture.js'),/private-key/);
});
