'use strict';
// Exercise the actual desktop bridge and narrow, independent peer windows.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin=process.env.M0_CANVAS_TEST_URL;
if(!origin)throw Error('Use scripts/canvas-check.mjs --collaboration');
process.env.M0_LOCAL_URL=origin;process.env.M0_LOCAL_PROFILE='canvas-windows-test';
const report={success:false,checks:[],errors:[]};dialog.showErrorBox=(title,message)=>report.errors.push({title,message});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const run=(window,source)=>window.webContents.executeJavaScript(source,true);
async function until(check,label){const start=Date.now();while(Date.now()-start<20000){const value=await check();if(value)return value;await delay(60);}throw Error('Timeout: '+label);}
async function post(route,body){const response=await fetch(origin+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),value=await response.json();if(!response.ok)throw Error(value.error||JSON.stringify(value));return value;}
let started=false;
app.on('browser-window-created',(_event,window)=>{
  if(started)return;started=true;
  window.webContents.once('did-finish-load',()=>void(async()=>{
    try{
      const project=await post('/devops-api/project/v2/create',{mode:'code',projectName:'Desktop peer windows'});
      await window.loadURL(origin+'/local-canvas/index.html?projectId='+project.id);
      await until(()=>run(window,'window.m0LocalCanvas&&!document.querySelector("#save").disabled'),'host canvas');
      await run(window,'document.querySelector("#first-frame").click()');await until(()=>run(window,'!m0LocalCanvas.getStatus().dirty'),'host saved');
      await run(window,'document.querySelector("#collaboration-toggle").click();document.querySelector("#collaboration-start").click()');await until(()=>run(window,'m0LocalCanvas.getStatus().collaboration.connected'),'host room');
      await run(window,'document.querySelector("#collaboration-open-window").click()');
      const peer=await until(()=>BrowserWindow.getAllWindows().find(item=>item!==window),'desktop peer created');
      await until(()=>run(peer,'window.m0LocalCanvas?.getStatus().collaboration.connected'),'desktop peer bootstraps invite');
      assert.match(peer.webContents.getURL(),/\/local-canvas\/index.html\?invite=/);assert.equal((await run(peer,'m0LocalCanvas.getStatus().collaboration.role')),'editor');report.checks.push('actual collaboration button opens a separate invited desktop editor');
      assert.equal(await run(peer,'typeof require'),'undefined');assert.equal(await run(peer,'typeof m0LocalDesktop'),'undefined');assert.equal(await run(peer,'typeof electron'),'undefined');assert.equal(await run(peer,'fetch("/__local/model").then(()=>false,()=>true)'),true);report.checks.push('peer renderer has no Node, desktop/editor bridge, or model API network access');
      assert.equal(await run(window,'m0LocalDesktop.openCanvasWindow({invite:"bad"}).then(()=>false,()=>true)'),true);assert.equal(BrowserWindow.getAllWindows().length,2);report.checks.push('desktop bridge rejects malformed invitations');
      await run(peer,'document.querySelector("#collaboration-toggle").click();document.querySelector("#collaboration-open-window").click()');
      const second=await until(()=>BrowserWindow.getAllWindows().find(item=>item!==window&&item!==peer),'peer popup handled');await until(()=>run(second,'window.m0LocalCanvas?.getStatus().collaboration.connected'),'third participant');report.checks.push('an invited peer can open another constrained peer window');
      const peerURL=peer.webContents.getURL();await run(peer,'location.href="https://example.com"');await delay(300);assert.equal(peer.webContents.getURL(),peerURL);report.checks.push('peer navigation remains inside the invited local canvas');
      second.close();await until(()=>second.isDestroyed(),'second peer close');assert.equal(window.isDestroyed(),false);assert.equal(peer.isDestroyed(),false);report.checks.push('closing a collaboration window preserves the primary app and other peer');
      report.success=true;
    }catch(error){report.errors.push(error.stack||String(error));process.exitCode=1;}
    finally{await fs.mkdir(path.join(root,'diagnostics'),{recursive:true});await fs.writeFile(path.join(root,'diagnostics/canvas-desktop-windows.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));app.quit();}
  })());
});
require('../desktop/main.cjs');
