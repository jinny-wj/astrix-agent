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
  assert.deepEqual(Object.keys(layout).sort(),['repositoryRoot','sharedRoot','webRoot','desktopRoot','recoveryRoot','publicRoot','version'].sort());
});

test('packaged profiles, working files and diagnostics stay in writable user data, never the resource tree',t=>{
  const {root,layout}=fixture(t),userData=path.join(root,'user-data');
  const result=getStatePaths({surface:'desktop',packaged:true,userData,layout});
  for(const value of Object.values(result))assert.ok(value.startsWith(userData),value);
  assert.throws(()=>getStatePaths({profile:'../other',layout}),/profile/);
});

test('desktop and web development state belongs to each application and ignores unrelated repository state',t=>{
  const {root,layout}=fixture(t);
  fs.mkdirSync(path.join(root,'.local-data'),{recursive:true});
  fs.mkdirSync(path.join(root,'.data/electron'),{recursive:true});
  fs.writeFileSync(path.join(root,'.local-data','unrelated-state.json'),'{}');
  const desktop=getStatePaths({surface:'desktop',layout}),web=getStatePaths({surface:'web',layout});
  assert.deepEqual(desktop,{
    base:layout.desktopRoot,dataDir:path.join(layout.desktopRoot,'.local-data'),
    profileDir:path.join(layout.desktopRoot,'.data/electron'),workspaceRoot:path.join(layout.desktopRoot,'.local-data/workspace'),
    diagnosticsDir:path.join(layout.desktopRoot,'diagnostics'),
  });
  assert.equal(web.base,layout.webRoot);
  assert.equal(web.dataDir,path.join(layout.webRoot,'.local-data'));
  assert.equal(web.profileDir,path.join(layout.webRoot,'.data/electron'));
  assert.equal(fs.existsSync(path.join(desktop.dataDir,'unrelated-state.json')),false);
  assert.equal(fs.readFileSync(path.join(root,'.local-data','unrelated-state.json'),'utf8'),'{}');
});

test('explicit state roots and per-directory overrides remain independent of application defaults',t=>{
  const {root,layout}=fixture(t);
  process.env.ASTRIX_STATE_ROOT=path.join(root,'explicit-state');
  const isolated=getStatePaths({surface:'desktop',layout});
  assert.equal(isolated.dataDir,path.join(process.env.ASTRIX_STATE_ROOT,'.local-data'));
  assert.equal(isolated.profileDir,path.join(process.env.ASTRIX_STATE_ROOT,'.data/electron'));
  process.env.ASTRIX_DATA_DIR=path.join(root,'explicit-data');
  process.env.ASTRIX_WORKSPACE=path.join(root,'explicit-workspace');
  process.env.ASTRIX_PROFILE_ROOT=path.join(root,'explicit-profiles');
  process.env.ASTRIX_DIAGNOSTICS_DIR=path.join(root,'explicit-diagnostics');
  const explicit=getStatePaths({surface:'web',profile:'verification',layout});
  assert.equal(explicit.dataDir,process.env.ASTRIX_DATA_DIR);
  assert.equal(explicit.workspaceRoot,process.env.ASTRIX_WORKSPACE);
  assert.equal(explicit.profileDir,path.join(process.env.ASTRIX_PROFILE_ROOT,'verification'));
  assert.equal(explicit.diagnosticsDir,process.env.ASTRIX_DIAGNOSTICS_DIR);
});

test('previous explicit environment aliases remain compatible without an automatic directory fallback',t=>{
  const {root,layout}=fixture(t);
  process.env.M0_LOCAL_DATA_DIR=path.join(root,'configured-data');
  process.env.M0_LOCAL_WORKSPACE=path.join(root,'configured-workspace');
  const result=getStatePaths({surface:'desktop',layout});
  assert.equal(result.dataDir,process.env.M0_LOCAL_DATA_DIR);
  assert.equal(result.workspaceRoot,process.env.M0_LOCAL_WORKSPACE);
  assert.equal(result.profileDir,path.join(layout.desktopRoot,'.data/electron'));
});
