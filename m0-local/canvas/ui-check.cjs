// Integration test only: isolated sandboxed renderer, authored local canvas.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin=process.env.M0_CANVAS_TEST_URL||'http://127.0.0.1:4331';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'m0-canvas-browser-'));app.setPath('userData',profile);
const report={success:false,checks:[],errors:[]};let window;
let firstProject,secondProject,importProject;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(source){return window.webContents.executeJavaScript(source,true);}
async function until(source,label,timeout=10000){const started=Date.now();while(Date.now()-started<timeout){if(await evaluate(source))return;await sleep(40);}throw new Error('Timeout: '+label);}
async function box(selector){return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing element');if(e instanceof HTMLElement)e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);}
async function click(selector){const r=await box(selector);window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});await sleep(50);}
async function drag(from,to){window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(from.x),y:Math.round(from.y)});for(let i=1;i<=7;i++){window.webContents.sendInputEvent({type:'mouseMove',button:'left',buttons:['left'],x:Math.round(from.x+(to.x-from.x)*i/7),y:Math.round(from.y+(to.y-from.y)*i/7)});await sleep(16);}window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(to.x),y:Math.round(to.y)});await sleep(60);}
async function fill(selector,value){await click(selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await window.webContents.insertText(value);window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await sleep(60);}
async function document(){return evaluate('m0LocalCanvas.getDocument()');}
async function saved(){await until('!m0LocalCanvas.getStatus().dirty&&!!m0LocalCanvas.getStatus().revision','canvas autosave');}

app.whenReady().then(async()=>{
  for(const name of ['Canvas UI A','Canvas UI B','Canvas Import']){
    const response=await fetch(origin+'/devops-api/project/v2/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'code',projectName:name})});
    const project=await response.json();assert.ok(project.id);if(!firstProject)firstProject=project;else if(!secondProject)secondProject=project;else importProject=project;
  }
  report.projects=[firstProject,secondProject,importProject].map(({id,projectPath})=>({id,projectPath}));
  window=new BrowserWindow({width:1440,height:980,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'m0-canvas-test-'+Date.now()}});
  window.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await window.loadURL(origin+'/local-canvas/index.html?projectId='+firstProject.id);
  await until('window.m0LocalCanvas&&document.querySelector("#first-frame")&&!document.querySelector("#save").disabled','canvas load');
  assert.equal(await evaluate('typeof require'),'undefined');report.checks.push('sandboxed renderer without Node');
  await click('#first-frame');await saved();let doc=await document();const frameId=doc.pages[0].nodes[0].id;
  await click('[data-tool="rectangle"]');let rect=await box(`[data-node-id="${frameId}"] > rect`);
  await drag({x:rect.x+40,y:rect.y+70},{x:rect.x+210,y:rect.y+170});
  await fill('#prop-name','UI 矩形');await fill('#prop-fill','#5677ee');
  doc=await document();const rectangleId=doc.pages[0].nodes[0].children[0].id;assert.equal(doc.pages[0].nodes[0].children[0].fill,'#5677ee');report.checks.push('draw rectangle and edit name/fill');
  await click('[data-tool="ellipse"]');rect=await box(`[data-node-id="${frameId}"] > rect`);
  await drag({x:rect.x+50,y:rect.y+210},{x:rect.x+150,y:rect.y+300});
  await click('[data-tool="text"]');window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(rect.x+45),y:Math.round(rect.y+350)});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(rect.x+45),y:Math.round(rect.y+350)});await sleep(100);
  await fill('#prop-text','本地画布 UI 验证');await saved();
  doc=await document();assert.deepEqual(doc.pages[0].nodes[0].children.map(node=>node.type),['rectangle','ellipse','text']);assert.equal(doc.pages[0].nodes[0].children[2].text,'本地画布 UI 验证');report.checks.push('draw ellipse and edit actual text');
  await click(`[data-layer-id="${rectangleId}"]`);const before=(await document()).pages[0].nodes[0].children[0];rect=await box(`[data-node-id="${rectangleId}"] > rect`);
  await drag({x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:rect.x+rect.width/2+35,y:rect.y+rect.height/2+25});
  const moved=(await document()).pages[0].nodes[0].children[0];assert.ok(moved.x>before.x);report.checks.push('drag selected nested layer');
  rect=await box('[data-handle="se"]');const resizeWidth=moved.width;
  await drag({x:rect.x+rect.width/2,y:rect.y+rect.height/2},{x:rect.x+rect.width/2+40,y:rect.y+rect.height/2+20});assert.ok((await document()).pages[0].nodes[0].children[0].width>resizeWidth);
  const resizedWidth=(await document()).pages[0].nodes[0].children[0].width;
  await click('#undo');assert.equal((await document()).pages[0].nodes[0].children[0].width,resizeWidth);await click('#redo');assert.equal((await document()).pages[0].nodes[0].children[0].width,resizedWidth);report.checks.push('resize, undo and redo');
  const previousZoom=await evaluate('m0LocalCanvas.getStatus().zoom');await click('#zoom-in');assert.ok(await evaluate('m0LocalCanvas.getStatus().zoom')>previousZoom);await click('#fit');report.checks.push('zoom and fit');
  await saved();report.documentBeforeReload=await document();await window.webContents.reload();await until('window.m0LocalCanvas&&document.querySelectorAll("[data-layer-id]").length===4','reload persisted canvas');assert.deepEqual(await document(),report.documentBeforeReload);report.checks.push('autosave canvas.json and reload exact document');
  await click('#generate');await until('document.querySelector("#result-dialog").open','original KRN generation',20000);assert.match(await evaluate('document.querySelector("#result-code").value'),/本地画布 UI 验证/);report.checks.push('canvas -> recovered original KRN -> imported project files');
  report.generationStatus=await evaluate('document.querySelector("#result-status").textContent');await click('#close-result');
  fs.mkdirSync(path.join(root,'diagnostics'),{recursive:true});fs.writeFileSync(path.join(root,'diagnostics/canvas-ui.png'),await(await window.webContents.capturePage()).toPNG());
  await window.loadURL(origin+'/local-canvas/index.html?projectId='+secondProject.id);await until('window.m0LocalCanvas&&!document.querySelector("#save").disabled','second project');assert.equal((await document()).pages[0].nodes.length,0);report.checks.push('second project isolated blank canvas');
  window.webContents.debugger.attach('1.3');
  async function importFile(file){const{root}=await window.webContents.debugger.sendCommand('DOM.getDocument');const{nodeId}=await window.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'#import-file'});await window.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[file]});}
  const figmaFile=path.join(profile,'figma-rest.json');fs.writeFileSync(figmaFile,JSON.stringify({name:'REST UI proof',document:{type:'DOCUMENT',children:[{type:'FRAME',id:'f1',name:'REST frame',absoluteBoundingBox:{x:40,y:60,width:390,height:640},fills:[{type:'SOLID',color:{r:1,g:1,b:1}}],children:[{type:'TEXT',id:'t1',name:'REST title',characters:'REST JSON UI 导入',absoluteBoundingBox:{x:64,y:96,width:240,height:30},style:{fontSize:24},fills:[{type:'SOLID',color:{r:.1,g:.2,b:.3}}]}]}]}}));
  await importFile(figmaFile);await until('m0LocalCanvas.getDocument().pages[0].nodes[0]?.children[0]?.text==="REST JSON UI 导入"','Figma REST file input');await saved();assert.equal((await document()).pages[0].nodes[0].children[0].x,24);report.checks.push('actual file input imports Figma REST JSON with relative coordinates');
  const svgPath=path.join(profile,'export.svg');let downloadResolve;const downloaded=new Promise(resolve=>downloadResolve=resolve);window.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(svgPath);item.once('done',(_event,status)=>downloadResolve(status));});
  await click('#file-menu summary');await click('#export-svg');assert.equal(await downloaded,'completed');assert.match(fs.readFileSync(svgPath,'utf8'),/<svg[\s\S]*REST JSON UI 导入/);report.checks.push('SVG export produces actual downloadable design');
  await window.loadURL(origin+'/local-canvas/index.html?projectId='+importProject.id);await until('window.m0LocalCanvas&&!document.querySelector("#save").disabled','M0Schema project');
  const schemaFile=path.join(profile,'m0schema.json');const model=await import(path.join(root,'canvas/model.mjs'));fs.writeFileSync(schemaFile,JSON.stringify(model.documentToM0Schema(report.documentBeforeReload)));
  await importFile(schemaFile);await until('m0LocalCanvas.getDocument().pages[0].nodes[0]?.children.length===3','M0Schema file input');await saved();assert.equal((await document()).pages[0].nodes[0].children[2].text,'本地画布 UI 验证');report.checks.push('actual file input imports M0Schema');
  await window.loadURL(origin+'/local-canvas/index.html?projectId='+firstProject.id);await until('window.m0LocalCanvas&&document.querySelectorAll("[data-layer-id]").length===4','return to first project');assert.deepEqual(await document(),report.documentBeforeReload);report.checks.push('switch back restores first project');
  await window.loadURL(origin+'/aicode-v2?id='+firstProject.id+'&mode=spark&homeEntryMode=code');
  await until('document.querySelector(".channel-switch")','original project navigation',15000);
  report.outerControls=await evaluate('[...document.querySelectorAll(".channel-switch .channel-switch-item")].map(e=>({text:e.textContent,alt:e.querySelector("img")?.alt,class:e.className}))');
  const clicked=await evaluate('(()=>{const e=[...document.querySelectorAll(".channel-switch .channel-switch-item")].find(e=>["Figma","Design","设计"].includes(e.querySelector("img")?.alt)||["Design","Figma","设计"].includes(e.textContent.trim()));if(!e)return false;e.click();return true})()');
  assert.ok(clicked,'Original Design/Figma tab not found');await until('(()=>{const e=document.querySelector("[data-m0-local-canvas-frame]");return !!(e&&e.getBoundingClientRect().width>100&&e.getBoundingClientRect().height>100&&e.contentWindow?.m0LocalCanvas)})()','visible original Design canvas iframe',15000);
  report.outerCanvas=await evaluate('document.querySelector("[data-m0-local-canvas-frame]").src');assert.ok(report.outerCanvas.endsWith('projectId='+firstProject.id));report.checks.push('original Design/Figma tab hosts project-bound local canvas');
  fs.writeFileSync(path.join(root,'diagnostics/canvas-design-entry-ui.png'),await(await window.webContents.capturePage()).toPNG());
  report.success=true;
}).catch(error=>{report.errors.push(error.stack||String(error));process.exitCode=1;}).finally(()=>{
  fs.mkdirSync(path.join(root,'diagnostics'),{recursive:true});fs.writeFileSync(path.join(root,'diagnostics/canvas-ui-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({success:report.success,checks:report.checks,errors:report.errors},null,2));window?.destroy();app.quit();
});
