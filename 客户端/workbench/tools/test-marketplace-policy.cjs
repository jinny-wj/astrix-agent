'use strict';
const {getLayout}=require('../../../packages/astrix-workbench/layout.cjs');
const layout=getLayout();
const assert=require('node:assert/strict');
const {test}=require('node:test');
const path=require('node:path');
const market=require('../desktop/marketplace-network.cjs');
test('market permits documented gallery API and official asset hosts',()=>{
  for(const [url,method] of [
    ['https://open-vsx.org/vscode/gallery/extensionquery','POST'],
    ['https://open-vsx.org/vscode/gallery/extensionquery','OPTIONS'],
    ['https://open-vsx.org/api/-/search?query=json','GET'],
    ['https://open-vsx.org/api/dracula-theme/theme-dracula/2.25.1/file/package.json','GET'],
    ['https://openvsx.eclipsecontent.org/dracula-theme/theme-dracula/2.25.1/file.vsix','GET'],
    ['https://openvsxorg.blob.core.windows.net/resources/test.vsix','HEAD'],
  ])assert.equal(market.allows(url,method),true,`${method} ${url}`);
});
test('market rejects internal APIs, writes, credentials, private hosts and lookalike domains',()=>{
  for(const [url,method] of [
    ['https://open-vsx.org/api/-/admin','GET'],
    ['https://open-vsx.org/api/-/publish','POST'],
    ['https://open-vsx.org/api/test/extension','PUT'],
    ['https://open-vsx.org.evil.example/api/-/search','GET'],
    ['http://open-vsx.org/api/-/search','GET'],
    ['https://open-vsx.org:8443/api/-/search','GET'],
    ['https://user:secret@open-vsx.org/api/-/search','GET'],
    ['https://127.0.0.1/api/-/search','GET'],
    ['https://cdnfile.corp.kuaishou.com/icon.png','GET'],
    ['https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery','POST'],
  ])assert.equal(market.allows(url,method),false,`${method} ${url}`);
});
test('a normal extension host receives neither market HTTP nor raw socket permission',async()=>{
  const editor=path.join(layout.recoveryRoot,'extracted/resources/editor');
  const guard=require('./authentic-editor-guard.cjs')({sandbox:__dirname,editor,allowLocalProcesses:true,role:'vs/workbench/api/node/extensionHostProcess'});
  assert.throws(()=>require('node:https').get('https://open-vsx.org/api/-/search'),/blocked/);
  assert.throws(()=>new(require('node:net').Socket)().connect(443,'open-vsx.org'),/blocked/);
  assert.throws(()=>require('node:child_process').spawn('/bin/sh',['-c','true']),/blocked/);
  const imported=market.create({enabled:true});
  assert.equal(imported.enabled,false);
  assert.throws(()=>imported.request('https://open-vsx.org/api/-/search'),/rejected/);
  imported.dispose();
  await guard.dispose();
});
