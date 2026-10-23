import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {collectResources,packageResources} from '../tools/package-resources.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'m0-ui-package-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const write=async(name,value)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);return file;};
  await write('package.json',JSON.stringify({version:'0.6.0'}));
  await write('public/index.html','<!doctype html><title>M0</title>');
  await write('public/runtime.js','const config={apiKey:"sample-sensitive-value"};');
  await write('plugins/recovered/manifest.json','{}');
  await write('frontend-tools/extra-assets/manifest.json','{"assets":[]}');
  await write('desktop/icon.icns',Buffer.from([0,1,2,3]));
  await write('.local-data/account.json','do not include');
  await write('server/index.mjs','do not include');
  return {root,write};
}

test('UI package uses only four resource roots, sanitizes derived text and restores the module prefix',async t=>{
  const f=await fixture(t),output=path.join(f.root,'assets');
  const packaged=await packageResources({projectRoot:f.root,sourceRoot:f.root,version:'0.6.1',outputDir:output});
  const extraction=path.join(f.root,'extract');await fs.mkdir(extraction);
  const result=spawnSync('/usr/bin/tar',['-xzf',packaged.archive,'-C',extraction],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const module=path.join(extraction,'m0-local'),manifest=JSON.parse(await fs.readFile(path.join(module,'resources-manifest.json'),'utf8'));
  assert.equal(manifest.projectVersion,'0.6.1');assert.equal(manifest.sourceVersion,'0.6.0');assert.equal(manifest.fileCount,5);
  assert.ok(!manifest.files.some(record=>record.path.startsWith('server/')||record.path.includes('.local-data')));
  for(const record of manifest.files){const bytes=await fs.readFile(path.join(module,record.path));assert.equal(bytes.length,record.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);}
  assert.ok(!(await fs.readFile(path.join(module,'public/runtime.js'),'utf8')).includes('sample-sensitive-value'));
  assert.ok((await fs.readFile(path.join(f.root,'public/runtime.js'),'utf8')).includes('sample-sensitive-value'));
  assert.ok(manifest.files.find(record=>record.path==='public/runtime.js').redactions.length);
});

test('UI package refuses symlink escapes and private paths even under an allowed resource root',async t=>{
  const f=await fixture(t),link=path.join(f.root,'public/linked.js');
  await fs.symlink('../server/index.mjs',link);await assert.rejects(collectResources({sourceRoot:f.root}),/symlinks are not permitted/);
  await fs.unlink(link);const file=await f.write('public/.env','private');await assert.rejects(collectResources({sourceRoot:f.root}),/Refusing private/);
  await fs.unlink(file);await fs.unlink(path.join(f.root,'public/index.html'));
  await assert.rejects(collectResources({sourceRoot:f.root}),/Required prepared UI resource is absent/);
});

test('binary credentials block the entire UI archive rather than entering its output',async t=>{
  const f=await fixture(t),token='ghp_'+'B'.repeat(40);
  await f.write('desktop/icon.icns',Buffer.from(token));
  await assert.rejects(packageResources({sourceRoot:f.root,projectRoot:f.root,version:'0.6.1',outputDir:path.join(f.root,'assets')}),/Possible github-token/);
  assert.equal(await fs.access(path.join(f.root,'assets/M0-local-resources-v0.6.1.tar.gz')).then(()=>true,()=>false),false);
});
