import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import layoutModule from '../layout.cjs';

const {getLayout,getStatePaths}=layoutModule;
const envKeys=['ASTRIX_BUNDLE_ROOT','ASTRIX_RECOVERY_ROOT','ASTRIX_PUBLIC_ROOT','ASTRIX_STATE_ROOT','ASTRIX_DATA_DIR','ASTRIX_PROFILE_ROOT','ASTRIX_WORKSPACE','ASTRIX_DIAGNOSTICS_DIR','M0_LOCAL_DATA_DIR','M0_LOCAL_WORKSPACE'];
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrix-layout-'));
  const saved=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  for(const key of envKeys)delete process.env[key];
  t.after(()=>{for(const key of envKeys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'packages/astrix-workbench'),{recursive:true});
  fs.writeFileSync(path.join(root,'packages/astrix-workbench/package.json'),JSON.stringify({version:'0.7.0'}));
  return {root,layout:getLayout({repositoryRoot:root})};
}

test('a packaged resource tree resolves both platform sources and native runtime without a source checkout',t=>{
  const {root}=fixture(t);process.env.ASTRIX_BUNDLE_ROOT=root;
  process.env.ASTRIX_RECOVERY_ROOT=path.join(root,'Resources/recovered');
  const layout=getLayout();
  assert.equal(layout.webRoot,path.join(root,'网页端/workbench'));
  assert.equal(layout.desktopRoot,path.join(root,'客户端/workbench'));
  assert.equal(layout.recoveryRoot,path.join(root,'Resources/recovered'));
  assert.equal(layout.version,'0.7.0');
});

test('packaged profiles, working files and diagnostics stay in writable user data, never the resource tree',t=>{
  const {root,layout}=fixture(t),userData=path.join(root,'user-data');
  fs.mkdirSync(path.join(layout.legacyRoot,'.local-data'),{recursive:true});
  const result=getStatePaths({surface:'desktop',packaged:true,userData,layout});
  for(const value of Object.values(result))assert.ok(value.startsWith(userData),value);
  assert.throws(()=>getStatePaths({profile:'../other',layout}),/profile/);
});

test('desktop keeps existing development state while web uses separate data and explicit overrides remain supported',t=>{
  const {root,layout}=fixture(t);
  fs.mkdirSync(path.join(layout.legacyRoot,'.local-data'),{recursive:true});
  fs.mkdirSync(path.join(layout.legacyRoot,'.data/electron'),{recursive:true});
  const desktop=getStatePaths({surface:'desktop',layout}),web=getStatePaths({surface:'web',layout});
  assert.equal(desktop.dataDir,path.join(layout.legacyRoot,'.local-data'));
  assert.equal(desktop.profileDir,path.join(layout.legacyRoot,'.data/electron'));
  assert.notEqual(web.dataDir,desktop.dataDir);
  process.env.ASTRIX_STATE_ROOT=path.join(root,'explicit-state');
  const isolated=getStatePaths({surface:'desktop',layout});
  assert.ok(isolated.dataDir.startsWith(process.env.ASTRIX_STATE_ROOT));
  assert.ok(isolated.profileDir.startsWith(process.env.ASTRIX_STATE_ROOT));
  process.env.ASTRIX_DATA_DIR=path.join(root,'explicit-data');
  process.env.ASTRIX_WORKSPACE=path.join(root,'explicit-workspace');
  const explicit=getStatePaths({surface:'web',layout});
  assert.equal(explicit.dataDir,process.env.ASTRIX_DATA_DIR);
  assert.equal(explicit.workspaceRoot,process.env.ASTRIX_WORKSPACE);
});
