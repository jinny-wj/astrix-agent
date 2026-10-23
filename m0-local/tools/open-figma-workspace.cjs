'use strict';
// Optional launcher: opens the latest existing project in the recovered Design
// tab. The regular desktop entry point remains desktop/main.cjs.
const {app}=require('electron');
const origin='http://127.0.0.1:'+(process.env.M0_LOCAL_PORT||4317);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.once('browser-window-created',(_event,window)=>{
  window.webContents.once('did-finish-load',async()=>{
    try{
      const response=await fetch(origin+'/api/project/v2/list');if(!response.ok)return;
      const projects=await response.json(),project=Array.isArray(projects)?[...projects].sort((a,b)=>(b.latestUpdateAt||b.updatedAt||0)-(a.latestUpdateAt||a.updatedAt||0))[0]:null;
      if(!project)return;
      const params=new URLSearchParams({id:String(project.id),mode:'spark',autoOpenFigma:'true'});if(project.latestSessionId)params.set('sessionId',project.latestSessionId);
      await window.loadURL(origin+'/aicode-v2?'+params);
      for(let attempt=0;attempt<80;attempt++){
        if(window.isDestroyed())return;
        const ready=await window.webContents.executeJavaScript(`!!document.querySelector('[data-m0-figma-workspace-frame]')`);
        if(ready){await window.webContents.executeJavaScript(`[...document.querySelectorAll('button,[role="tab"],[role="button"],div,span')].find(e=>e.innerText?.trim()==='设计'&&e.offsetWidth)?.click()`);return;}
        await pause(150);
      }
    }catch(error){console.error('Figma workspace shortcut:',error.message);}
  });
});
require('../desktop/main.cjs');
