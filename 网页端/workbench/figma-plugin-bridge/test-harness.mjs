import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('./code.js',import.meta.url),'utf8');
export function createPluginHarness(fileKey="FigmaFile_123",{storage=new Map()}={}){
  const nodes=new Map(),messages=[],loadedFonts=[],documentWrites={relaunchData:0,createFrame:0,createText:0,commitUndo:0};let counter=0,undos=0;
  const page={id:'0:1',type:'PAGE',name:'Page 1',selection:[],children:[],appendChild(node){if(node.parent?.children)node.parent.children=node.parent.children.filter(value=>value!==node);node.parent=this;this.children.push(node);}};
  function make(type,id){const node={id:id||'new-'+(++counter),type,name:type,x:10,y:20,width:100,height:80,opacity:1,visible:true,locked:false,fills:[{type:'SOLID',color:{r:1,g:1,b:1},opacity:1}],strokes:[],effects:[],rotation:0,children:[],layoutMode:'NONE',cornerRadius:0,characters:'Initial',fontName:{family:'Inter',style:'Regular'},fontSize:16,textAlignHorizontal:'LEFT',resize(w,h){this.width=w;this.height=h;},getRangeAllFontNames(){return [this.fontName]},appendChild:page.appendChild,remove(){nodes.delete(this.id);if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this)},async exportAsync(settings){if(settings.format==='JSON_REST_V1')return {document:{id:this.id,type:this.type,name:this.name,children:[]}};if(settings.format==='SVG_STRING')return '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="80"/></svg>';return new Uint8Array([137,80,78,71,13,10,26,10]);}};nodes.set(node.id,node);return node;}
  const text=make('TEXT','1:1'),frame=make('FRAME','1:2');page.appendChild(text);page.appendChild(frame);page.selection=[text];
  const figma={fileKey,mixed:Symbol('mixed'),root:{name:'Real file fixture',setRelaunchData(){documentWrites.relaunchData++}},currentPage:page,showUI(){},ui:{postMessage(value){messages.push(value)}},on(){},notify(){},viewport:{scrollAndZoomIntoView(){}},base64Encode:value=>Buffer.from(value).toString('base64'),clientStorage:{async getAsync(key){return storage.get(key)},async setAsync(key,value){storage.set(key,value)},async deleteAsync(key){storage.delete(key)}},async getNodeByIdAsync(id){return id===page.id?page:nodes.get(id)},async loadFontAsync(font){loadedFonts.push(font)},createFrame:()=>{documentWrites.createFrame++;return make('FRAME')},createText:()=>{documentWrites.createText++;return make('TEXT')},commitUndo(){undos++;documentWrites.commitUndo++},async setCurrentPageAsync(value){figma.currentPage=value}};
  const context=vm.createContext({figma,__html__:'',setTimeout(){},console});new vm.Script(source+'\nglobalThis.testBridge={executeCommand,selectionSnapshot,publishSelection,id:BRIDGE_SESSION_ID};').runInContext(context);
  const bridge=context.testBridge;const snapshot=()=>JSON.parse(JSON.stringify(bridge.selectionSnapshot()));
  const execute=async command=>JSON.parse(JSON.stringify(await bridge.executeCommand(command)));
  return {figma,nodes,text,frame,page,messages,loadedFonts,storage,documentWrites,snapshot,execute,publish:()=>bridge.publishSelection(),id:bridge.id,get undos(){return undos;}};
}

/** Runs the actual plugin iframe script against a caller's real local HTTP
 * server. The Figma scene is the explicit fixture above, never a real account. */
export async function createPluginUiHarness({plugin,baseUrl,endpoints=[baseUrl,'http://127.0.0.1:5273'],fetchImpl=fetch}){
  const html=await fs.readFile(new URL('./ui.html',import.meta.url),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements=new Map(['base','code','status','log','pair','disconnect','base-web','code-web','status-web','pair-web','disconnect-web'].map(id=>[id,{value:id==='base'?baseUrl:id==='base-web'?(endpoints[1]||''):'',textContent:'',disabled:false}]));
  const errors=[],intervals=[],parent={postMessage(message){Promise.resolve(plugin.figma.ui.onmessage(message.pluginMessage)).catch(error=>errors.push(error));}};
  const window={},context=vm.createContext({__ASTRIX_BRIDGE_ENDPOINTS__:endpoints,document:{getElementById:id=>elements.get(id)},window,parent,URL,URLSearchParams,crypto:globalThis.crypto,AbortController,AbortSignal,setTimeout,clearTimeout,console,setInterval(fn){intervals.push(fn)},fetch:(url,options={})=>fetchImpl(url,{...options,headers:{...options.headers,origin:'null'}})});
  plugin.figma.ui.postMessage=value=>queueMicrotask(()=>{try{window.onmessage({source:parent,data:{pluginMessage:value}})}catch(error){errors.push(error)}});
  new vm.Script(script,{filename:'actual-figma-plugin-ui.js'}).runInContext(context);
  await new Promise(resolve=>setTimeout(resolve,0));
  function card(endpoint=baseUrl){return elements.get('base-web').value===endpoint?'-web':'';}
  return {elements,errors,async pair(code,{endpoint=baseUrl}={}){const suffix=card(endpoint);elements.get('base'+suffix).value=endpoint;await elements.get('base'+suffix).onchange?.();elements.get('code'+suffix).value=code;await elements.get('pair'+suffix).onclick();},async tick(){for(const fn of intervals)await fn()},async disconnect({endpoint=baseUrl}={}){await elements.get('disconnect'+card(endpoint)).onclick();},statusFor:endpoint=>elements.get('status'+card(endpoint)).textContent,get log(){return elements.get('log').textContent},get status(){return elements.get('status').textContent}};
}
