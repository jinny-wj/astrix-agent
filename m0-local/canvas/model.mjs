/* Authored local canvas model. Output targets the recovered original M0 KRN plugin. */
import {validatePath,validateGradient,pathToSVGData,nodeTransformSVG,transformLocalPoint} from './vector-core.mjs';
import {shapeToPath,normalizeVectorNode,booleanGeometry,compoundGeometry,flattenGeometry,geometryBounds,pathFromSVGData,transformPath} from './vector-geometry.mjs';
import {gradientSVG,vectorNodeSVG,vectorAssetBounds,parseSVG} from './vector-svg.mjs';
export * from './vector-core.mjs';
export {pathFromSVGData,pathArea,GEOMETRY_ENGINE} from './vector-geometry.mjs';
export const FORMAT = 'm0-local-canvas-v1';
const TYPES = new Set(['frame','rectangle','ellipse','text','group','image','path']);
const limit = (n,min,max,fallback=0) => Number.isFinite(Number(n)) ? Math.min(max,Math.max(min,Number(n))) : fallback;
const number = (n,fallback=0) => typeof n === 'number' ? limit(n,-100000,100000,fallback) : typeof n === 'string' && /^-?\d+(?:\.\d+)?(?:px)?$/.test(n.trim()) ? limit(parseFloat(n),-100000,100000,fallback) : fallback;
const color = (value,fallback='#dbe7ff') => typeof value === 'string' && (/^#[\da-f]{3,8}$/i.test(value) || /^(?:rgba?|hsla?)\([\d\s.,%+-]+\)$/.test(value) || ['none','transparent'].includes(value)) ? value : fallback;
const text = (value,max=500) => String(value ?? '').slice(0,max);
export const newId = () => globalThis.crypto?.randomUUID?.() || `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const createPage=(name='Page 1')=>({id:newId(),name,nodes:[]});
export const emptyDocument = (name='Untitled') => {const page=createPage();return{format:FORMAT,version:2,name,activePageId:page.id,pages:[page],components:[]};};
export const getActivePage=(document,pageId)=>document.pages?.find(page=>page.id===(pageId||document.activePageId))||document.pages?.[0]||{id:'page-legacy',name:'Page 1',nodes:document.nodes||[]};
export const pageNodes=(document,pageId)=>getActivePage(document,pageId).nodes;

export function validateImage(data) {
  if(!data)return'';
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if(!match||match[2].length>700000)throw new Error('图片只支持不超过 512 KB 的 PNG、JPEG 或 WebP 数据。');
  const bytes=atob(match[2]);if(bytes.length>512*1024)throw new Error('单张图片不能超过 512 KB。');
  const valid=match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP';
  if(!valid)throw new Error('图片内容与格式不匹配。');return data;
}

export function validateDocument(input) {
  if (!input || typeof input !== 'object' || input.format !== FORMAT || ![1,2].includes(input.version) || (input.version===1?!Array.isArray(input.nodes):!Array.isArray(input.pages)||!input.pages.length)) throw new Error('不是有效的本地画布文档。');
  if (new TextEncoder().encode(JSON.stringify(input)).length > 2*1024*1024) throw new Error('画布文档不能超过 2 MB。');
  let count=0; const ids=new Set();
  function node(value,depth) {
    if (++count>3000 || depth>50) throw new Error('画布最多 3000 个图层、50 层嵌套。');
    if (!value || typeof value!=='object' || !TYPES.has(value.type)) throw new Error('不支持的画布图层类型。');
    if (typeof value.id!=='string' || !value.id || value.id.length>200 || ids.has(value.id)) throw new Error('图层 id 缺失或重复。');
    ids.add(value.id);
    if (value.children!==undefined && !Array.isArray(value.children)) throw new Error('图层 children 应为数组。');
    const layout=value.layout||{};
    return {
      id:value.id,type:value.type,name:text(value.name || value.type,200),
      x:limit(value.x,-100000,100000),y:limit(value.y,-100000,100000),
      width:limit(value.width,1,100000,100),height:limit(value.height,1,100000,100),
      fill:color(value.fill,value.type==='text'?'#202735':value.type==='frame'?'#ffffff':'#dbe7ff'),
      stroke:color(value.stroke,'none'),strokeWidth:limit(value.strokeWidth,0,100,0),
      radius:limit(value.radius,0,50000,0),opacity:limit(value.opacity,0,1,1),
      rotation:limit(value.rotation,-360000,360000,0),flipX:Boolean(value.flipX),flipY:Boolean(value.flipY),gradient:validateGradient(value.gradient),
      ...(value.type==='path'?{path:validatePath(value.path,{width:value.width,height:value.height})}:{}),
      text:text(value.text,30000),fontSize:limit(value.fontSize,1,1000,20),fontFamily:text(value.fontFamily || 'Inter, sans-serif',200),fontWeight:String(value.fontWeight || '400').replace(/[^\d]/g,'').slice(0,3)||'400',
      textAlign:['left','center','right'].includes(value.textAlign)?value.textAlign:'left',lineHeight:limit(value.lineHeight,1,3000,(value.fontSize||20)*1.25),letterSpacing:limit(value.letterSpacing,-100,100,0),
      imageData:value.type==='image'?validateImage(value.imageData||''):'',imageFit:value.imageFit==='contain'?'contain':'cover',
      layout:{mode:['horizontal','vertical'].includes(layout.mode)?layout.mode:'none',gap:limit(layout.gap,0,10000,16),padding:limit(layout.padding,0,10000,16),align:['start','center','end','stretch'].includes(layout.align)?layout.align:'start',justify:['start','center','end','space-between'].includes(layout.justify)?layout.justify:'start'},
      componentId:typeof value.componentId==='string'?text(value.componentId,200):'',componentRole:['main','instance'].includes(value.componentRole)?value.componentRole:'',
      prototype:{targetId:text(value.prototype?.targetId||'',200),trigger:'click'},
      hidden:Boolean(value.hidden),locked:Boolean(value.locked),
      children:(value.children||[]).map(child=>node(child,depth+1)),
    };
  }
  const sourcePages=input.version===1?[{id:'page-legacy',name:'Page 1',nodes:input.nodes}]:input.pages;
  if(sourcePages.length>30)throw new Error('最多 30 个页面。');
  const pageIds=new Set();
  const pages=sourcePages.map(page=>{if(!page||typeof page.id!=='string'||!page.id||page.id.length>200||pageIds.has(page.id)||!Array.isArray(page.nodes))throw new Error('页面 id 或图层数组无效。');pageIds.add(page.id);return{id:page.id,name:text(page.name||'Page',200),nodes:page.nodes.map(value=>node(value,0))};});
  if(input.components!==undefined&&!Array.isArray(input.components))throw new Error('组件列表无效。');
  const components=(input.components||[]).slice(0,100).map(component=>({id:text(component.id,200),name:text(component.name||'Component',200),mainNodeId:text(component.mainNodeId,200)}));
  const document={format:FORMAT,version:2,name:text(input.name||'Untitled',200),activePageId:pageIds.has(input.activePageId)?input.activePageId:pages[0].id,pages,components};
  const frames=new Set();walkDocument(document,node=>{if(node.type==='frame')frames.add(node.id);});
  walkDocument(document,node=>{if(!frames.has(node.prototype.targetId))node.prototype.targetId='';});return document;
}

export function findNode(document,id,{pageId}={}) {
  let result;
  function walk(nodes,parent=null,offset={x:0,y:0}) {
    for (let index=0;index<nodes.length;index++) {
      const node=nodes[index],absolute={x:offset.x+node.x,y:offset.y+node.y};
      if (node.id===id) {result={node,parent,siblings:nodes,index,absolute};return true;}
      if (walk(node.children||[],node,absolute)) return true;
    }
  }
  walk(pageNodes(document,pageId));return result;
}
export function findNodeAllPages(document,id){for(const page of document.pages||[{id:'page-legacy',nodes:document.nodes||[]}]){const found=findNode(document,id,{pageId:page.id});if(found)return{...found,page};}}

export function documentBounds(document,{pageId}={}) {
  const nodes=pageNodes(document,pageId).filter(node=>!node.hidden);
  if(!nodes.length)return{x:0,y:0,width:800,height:600};
  const boxes=nodes.map(node=>{const points=[{x:0,y:0},{x:node.width,y:0},{x:0,y:node.height},{x:node.width,y:node.height}].map(p=>transformLocalPoint(node,p));const x=node.x+Math.min(...points.map(p=>p.x)),y=node.y+Math.min(...points.map(p=>p.y));return{x,y,width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))};});
  const x=Math.min(...boxes.map(n=>n.x)),y=Math.min(...boxes.map(n=>n.y));
  return{x,y,width:Math.max(1,Math.max(...boxes.map(n=>n.x+n.width))-x),height:Math.max(1,Math.max(...boxes.map(n=>n.y+n.height))-y)};
}

export function createNode(type,x=0,y=0) {
  const names={frame:'Frame',rectangle:'Rectangle',ellipse:'Ellipse',text:'Text',group:'Group',image:'Image'};
  return {id:newId(),type,name:names[type]||'Path',x,y,width:type==='frame'?390:type==='text'?220:160,height:type==='frame'?640:type==='text'?36:100,fill:type==='frame'?'#ffffff':type==='group'?'none':type==='text'?'#202735':'#8fa8ff',stroke:'none',strokeWidth:0,radius:type==='rectangle'?0:0,opacity:1,rotation:0,flipX:false,flipY:false,gradient:null,...(type==='path'?{path:{width:160,height:100,fillRule:'nonzero',contours:[{closed:false,points:[]}]}}:{}),text:type==='text'?'Text':'',fontSize:24,fontFamily:'Inter, sans-serif',fontWeight:'400',textAlign:'left',lineHeight:30,letterSpacing:0,imageData:'',imageFit:'cover',layout:{mode:'none',gap:16,padding:16,align:'start',justify:'start'},componentId:'',componentRole:'',prototype:{targetId:'',trigger:'click'},hidden:false,locked:false,children:[]};
}

export function normalizePathBounds(document,id){const entry=findNode(document,id);if(!entry||entry.node.type!=='path')throw new Error('请选择矢量路径。');Object.assign(entry.node,normalizeVectorNode(entry.node));return id;}
export function convertNodeToPath(document,id){const entry=findNode(document,id);if(!entry)throw new Error('图层不存在。');if(!['rectangle','ellipse','frame','path'].includes(entry.node.type)||entry.node.children.length)throw new Error('请先选择没有子图层的矩形、椭圆或路径。');entry.node.path=shapeToPath(entry.node);entry.node.type='path';return id;}
export function flattenNode(document,id,{tolerance=.5}={}){convertNodeToPath(document,id);const node=findNode(document,id).node;node.path=flattenGeometry(node,{tolerance});return normalizePathBounds(document,id);}
export function booleanNodes(document,ids,operation){const entries=selectedRoots(document,ids);if(entries.length<2||entries.length>100||entries.some(e=>e.parent!==entries[0].parent))throw new Error('请选择同一父图层下 2–100 个形状。');if(entries.some(e=>e.node.locked||e.node.children.length))throw new Error('请先解锁或取消嵌套形状。');const result=(operation==='flatten'?compoundGeometry:booleanGeometry)(entries.map(e=>e.node),operation);if(!result.path.contours.length)throw new Error('布尔运算结果为空；原图层已保留。');const first=entries[0].node,node=normalizeVectorNode({...createNode('path'),name:`${operation} · ${first.name}`,x:0,y:0,width:1,height:1,path:result.path,fill:first.fill,gradient:first.gradient,stroke:first.stroke,strokeWidth:first.strokeWidth,opacity:first.opacity});const index=Math.min(...entries.map(e=>e.index)),siblings=entries[0].siblings;for(const e of [...entries].sort((a,b)=>b.index-a.index))siblings.splice(e.index,1);siblings.splice(index,0,node);return node.id;}
export function importSVG(source){const result=parseSVG(source);return{document:validateDocument({format:FORMAT,version:1,name:result.name,nodes:result.nodes}),warnings:result.warnings};}

export function walkDocument(document,visit){function walk(nodes,parent=null,page){for(const node of nodes){visit(node,parent,page);walk(node.children||[],node,page);}}for(const page of document.pages||[{id:'page-legacy',nodes:document.nodes||[]}])walk(page.nodes,null,page);}
export function applyLayouts(document){
  function layout(node){const config=node.layout||{};if(config.mode==='none'||!config.mode){node.children.forEach(layout);return;}
    const horizontal=config.mode==='horizontal',children=node.children.filter(child=>!child.hidden),padding=config.padding??16,gap=config.gap??16;
    const size=horizontal?'width':'height',cross=horizontal?'height':'width',axis=horizontal?'x':'y',crossAxis=horizontal?'y':'x';
    const occupied=children.reduce((sum,child)=>sum+child[size],0),available=node[size]-padding*2,free=available-occupied-gap*Math.max(0,children.length-1);
    const spacing=config.justify==='space-between'&&children.length>1?(available-occupied)/(children.length-1):gap;
    let cursor=padding+(config.justify==='center'?free/2:config.justify==='end'?free:0);
    for(const child of children){child[axis]=cursor;if(config.align==='stretch'){child[cross]=Math.max(1,node[cross]-padding*2);child[crossAxis]=padding;}else child[crossAxis]=padding+(config.align==='center'?(node[cross]-padding*2-child[cross])/2:config.align==='end'?node[cross]-padding*2-child[cross]:0);cursor+=child[size]+spacing;}node.children.forEach(layout);
  }for(const page of document.pages||[])page.nodes.forEach(layout);return document;
}
export const getResolvedDocument=input=>applyLayouts(validateDocument(input));
export function selectedRoots(document,ids){const selected=new Set(ids);return[...selected].map(id=>findNode(document,id)).filter(Boolean).filter(entry=>{let parent=entry.parent;while(parent){if(selected.has(parent.id))return false;parent=findNode(document,parent.id)?.parent;}return true;});}
export function selectionBounds(document,ids){const entries=selectedRoots(document,ids);if(!entries.length)return null;const x=Math.min(...entries.map(e=>e.absolute.x)),y=Math.min(...entries.map(e=>e.absolute.y));return{x,y,width:Math.max(...entries.map(e=>e.absolute.x+e.node.width))-x,height:Math.max(...entries.map(e=>e.absolute.y+e.node.height))-y};}
export function groupNodes(document,ids){const entries=selectedRoots(document,ids);if(entries.length<2)throw new Error('请选择至少两个图层。');if(entries.some(entry=>entry.parent!==entries[0].parent))throw new Error('组合需要同一父图层下的图层。');const bounds=selectionBounds(document,ids),parent=entries[0].parent,origin=parent?findNode(document,parent.id).absolute:{x:0,y:0},group=createNode('group',bounds.x-origin.x,bounds.y-origin.y);group.width=bounds.width;group.height=bounds.height;const siblings=entries[0].siblings,index=Math.min(...entries.map(e=>e.index));for(const entry of [...entries].sort((a,b)=>a.index-b.index)){entry.node.x-=group.x;entry.node.y-=group.y;group.children.push(entry.node);}for(const entry of [...entries].sort((a,b)=>b.index-a.index))siblings.splice(entry.index,1);siblings.splice(index,0,group);return group.id;}
export function ungroupNode(document,id){const entry=findNode(document,id);if(!entry||entry.node.type!=='group')throw new Error('请选择一个组合。');const nodes=entry.node.children;for(const node of nodes){node.x+=entry.node.x;node.y+=entry.node.y;}entry.siblings.splice(entry.index,1,...nodes);return nodes.map(node=>node.id);}
export function alignNodes(document,ids,mode){const entries=selectedRoots(document,ids).filter(e=>!e.node.locked),bounds=selectionBounds(document,entries.map(e=>e.node.id));if(entries.length<2||!bounds)return;const horizontal=['left','hcenter','right','horizontal'].includes(mode);if(['horizontal','vertical'].includes(mode)){if(entries.length<3)throw new Error('分布至少需要三个图层。');const axis=horizontal?'x':'y',size=horizontal?'width':'height';entries.sort((a,b)=>a.absolute[axis]-b.absolute[axis]);const available=bounds[size]-entries.reduce((sum,e)=>sum+e.node[size],0),gap=available/(entries.length-1);let cursor=bounds[axis];for(const entry of entries){entry.node[axis]+=cursor-entry.absolute[axis];cursor+=entry.node[size]+gap;}return;}for(const entry of entries){if(horizontal)entry.node.x+=(mode==='left'?bounds.x:mode==='right'?bounds.x+bounds.width-entry.node.width:bounds.x+(bounds.width-entry.node.width)/2)-entry.absolute.x;else entry.node.y+=(mode==='top'?bounds.y:mode==='bottom'?bounds.y+bounds.height-entry.node.height:bounds.y+(bounds.height-entry.node.height)/2)-entry.absolute.y;}}
export function createComponent(document,id){const entry=findNode(document,id);if(!entry)throw new Error('请选择图层。');if(entry.node.componentRole)throw new Error('此图层已属于组件。');const component={id:newId(),name:entry.node.name,mainNodeId:id};document.components.push(component);entry.node.componentId=component.id;entry.node.componentRole='main';return component.id;}
export function insertInstance(document,componentId,{x,y}={}){const component=document.components.find(c=>c.id===componentId),main=component&&findNodeAllPages(document,component.mainNodeId)?.node;if(!main)throw new Error('主组件已删除。');const node=JSON.parse(JSON.stringify(main));const assign=value=>{value.id=newId();value.children.forEach(assign);};assign(node);node.componentId=componentId;node.componentRole='instance';node.name=component.name+' / Instance';node.x=x??main.x+main.width+40;node.y=y??main.y;pageNodes(document).push(node);return node.id;}
export function syncComponent(document,componentId){const component=document.components.find(c=>c.id===componentId),main=component&&findNodeAllPages(document,component.mainNodeId)?.node;if(!main)throw new Error('主组件已删除。');let count=0;walkDocument(document,node=>{if(node.componentRole!=='instance'||node.componentId!==componentId)return;const keep={id:node.id,name:node.name,x:node.x,y:node.y,componentRole:'instance',componentId};Object.assign(node,JSON.parse(JSON.stringify(main)),keep);const assign=value=>{value.id=newId();value.children.forEach(assign);};node.children.forEach(assign);count++;});return count;}
export function detachInstance(document,id){const node=findNode(document,id)?.node;if(!node||node.componentRole!=='instance')throw new Error('请选择组件实例。');node.componentId='';node.componentRole='';}

// Synchronous SHA-256 keeps browser/schema and server asset filenames identical.
export function sha256(value){const bytes=new TextEncoder().encode(value),length=bytes.length,words=[],hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];for(let i=0;i<length;i++)words[i>>2]=(words[i>>2]||0)|(bytes[i]<<(24-i%4*8));words[length>>2]=(words[length>>2]||0)|(0x80<<(24-length%4*8));const blocks=Math.ceil((length+9)/64);words[blocks*16-1]=length*8;const rotate=(n,b)=>(n>>>b)|(n<<(32-b));for(let offset=0;offset<blocks*16;offset+=16){const w=new Array(64);for(let i=0;i<16;i++)w[i]=words[offset+i]||0;for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))|0;}let[a,b,c,d,e,f,g,h]=hash;for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}[a,b,c,d,e,f,g,h].forEach((value,index)=>hash[index]=(hash[index]+value)|0);}return hash.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');}
function imageInfo(data){validateImage(data);const[mime,base64]=data.slice(5).split(';base64,'),id=sha256(data),extension=mime==='image/jpeg'?'jpg':mime.split('/')[1];return{id,fileName:`canvas-image-${id}.${extension}`,mime,base64};}
function needsVectorAsset(node){return node.type==='path'||['rectangle','ellipse','frame'].includes(node.type)&&(node.gradient||node.rotation||node.flipX||node.flipY);}
function vectorInfo(node){const svg=vectorNodeSVG(node),id=sha256(svg),base64=btoa(Array.from(new TextEncoder().encode(svg),c=>String.fromCharCode(c)).join(''));return{id,fileName:`canvas-vector-${id}.svg`,mime:'image/svg+xml',base64,dataURL:`data:image/svg+xml;base64,${base64}`,bounds:vectorAssetBounds(node)};}
export function extractCanvasAssets(input,{nodeId,pageId}={}){const document=getResolvedDocument(input),root=nodeId&&findNodeAllPages(document,nodeId)?.node,assets=new Map();function collect(node){if(node.hidden)return;if(node.type==='image'&&node.imageData||needsVectorAsset(node)){const info=needsVectorAsset(node)?vectorInfo(node):imageInfo(node.imageData);assets.set(info.id,{fileName:info.fileName,mime:info.mime,base64:info.base64});}node.children.forEach(collect);}if(root)collect(root);else{const nodes=pageNodes(document,pageId),frame=nodes.find(node=>node.type==='frame'&&!node.hidden);(frame?[frame]:nodes).forEach(collect);}return[...assets.values()];}

export function documentToM0Schema(input,{nodeId,pageId}={}) {
  const document=getResolvedDocument(input);
  const selected=nodeId&&findNodeAllPages(document,nodeId)?.node;
  const nodes=pageNodes(document,pageId),frame=selected || nodes.find(node=>node.type==='frame'&&!node.hidden),imageMap={};
  let serial=0;
  function convert(node,isRoot=false) {
    if((node.rotation||node.flipX||node.flipY)&&(!['path','rectangle','ellipse','frame'].includes(node.type)||node.children.length))throw new Error(`原 KRN 暂不支持图层「${node.name}」的容器/文字/图片变换；请先导出 SVG，避免静默丢失旋转或翻转。`);
    if(node.gradient&&!['path','rectangle','ellipse','frame'].includes(node.type))throw new Error(`原 KRN 暂不支持图层「${node.name}」的渐变；请先导出 SVG，避免静默丢失填充。`);
    const index=serial++;
    const styles={width:`${node.width}px`,height:`${node.height}px`,opacity:node.opacity};
    if(!isRoot)Object.assign(styles,{position:'absolute',left:`${node.x}px`,top:`${node.y}px`});
    if(node.type==='text')Object.assign(styles,{color:node.fill==='none'?'transparent':node.fill,fontSize:`${node.fontSize}px`,fontWeight:node.fontWeight,fontFamily:node.fontFamily,textAlign:node.textAlign,lineHeight:`${node.lineHeight}px`,letterSpacing:`${node.letterSpacing}px`});
    else styles.backgroundColor=node.fill==='none'?'transparent':node.fill;
    if(node.type==='ellipse')styles.borderRadius=`${Math.max(node.width,node.height)/2}px`;
    else if(node.radius)styles.borderRadius=`${node.radius}px`;
    if(node.stroke!=='none'&&node.strokeWidth)Object.assign(styles,{borderColor:node.stroke,borderWidth:`${node.strokeWidth}px`,borderStyle:'solid'});
    let imageId,assetBounds;if(node.type==='image'&&node.imageData||needsVectorAsset(node)){const info=needsVectorAsset(node)?vectorInfo(node):imageInfo(node.imageData);imageId=info.id;assetBounds=info.bounds;imageMap[imageId]={fileName:info.fileName,dataURL:info.dataURL||node.imageData};if(needsVectorAsset(node)){styles.backgroundColor='transparent';styles.width=`${info.bounds.width}px`;styles.height=`${info.bounds.height}px`;if(!isRoot){styles.left=`${node.x+info.bounds.x}px`;styles.top=`${node.y+info.bounds.y}px`;}delete styles.borderRadius;delete styles.borderColor;delete styles.borderWidth;delete styles.borderStyle;}}
    const children=node.children.filter(child=>!child.hidden).map(child=>convert(child));
    if(imageId&&children.length){styles.width=`${node.width}px`;styles.height=`${node.height}px`;if(!isRoot){styles.left=`${node.x}px`;styles.top=`${node.y}px`;}children.unshift({id:node.id+'-vector-background',nodeType:'image',name:'Vector background',uniqueStyleName:`layer${serial++}`,imageId,styles:{position:'absolute',left:`${assetBounds?.x||0}px`,top:`${assetBounds?.y||0}px`,width:`${assetBounds?.width||node.width}px`,height:`${assetBounds?.height||node.height}px`},props:[],children:[]});imageId=undefined;}
    return{id:node.id,nodeType:node.type==='text'?'text':imageId?'image':'view',name:node.name,uniqueStyleName:`layer${index}`,styles,props:[],...(imageId?{imageId}:{}),characters:node.type==='text'?node.text:undefined,children};
  }
  let nodeTree;
  if(frame)nodeTree=convert(frame,true);
  else {
    const bounds=documentBounds(document,{pageId});
    nodeTree=convert({...createNode('frame'),id:'m0-local-export-root',name:document.name,width:bounds.width,height:bounds.height,fill:'none',children:nodes.filter(node=>!node.hidden).map(node=>({...node,x:node.x-bounds.x,y:node.y-bounds.y}))},true);
  }
  return {nodeTree,imageMap,componentsMap:{},metadata:{source:'m0-local-canvas',formatVersion:2,pageId:getActivePage(document,pageId).id,...(Object.values(imageMap).some(i=>i.fileName.endsWith('.svg'))?{vectorAssets:'Local generated SVG; target platform must support SVG image assets.'}:{})}};
}

const escape = value => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
export function documentToSVG(input,{pageId}={}) {
  const document=getResolvedDocument(input),bounds=documentBounds(document,{pageId});
  function render(node) {
    if(node.hidden)return'';
    const gradientId='gradient-'+node.id.replace(/[^\w-]/g,'_');
    const attrs=`fill="${escape(node.gradient?'url(#'+gradientId+')':node.fill)}" stroke="${escape(node.stroke)}" stroke-width="${node.strokeWidth}"`;
    let shape='';
    if(node.type==='path')shape=`<path d="${escape(pathToSVGData(node))}" fill-rule="${node.path.fillRule}" ${attrs}/>`;
    else if(node.type==='ellipse')shape=`<ellipse cx="${node.width/2}" cy="${node.height/2}" rx="${node.width/2}" ry="${node.height/2}" ${attrs}/>`;
    else if(node.type==='image'&&node.imageData)shape=`<defs><clipPath id="clip-${escape(node.id)}"><rect width="${node.width}" height="${node.height}" rx="${node.radius}"/></clipPath></defs><image href="${escape(node.imageData)}" width="${node.width}" height="${node.height}" preserveAspectRatio="xMidYMid ${node.imageFit==='contain'?'meet':'slice'}" clip-path="url(#clip-${escape(node.id)})"/>`;
    else if(node.type==='text'){const x=node.textAlign==='center'?node.width/2:node.textAlign==='right'?node.width:0;shape=`<text x="${x}" y="${node.fontSize}" text-anchor="${node.textAlign==='center'?'middle':node.textAlign==='right'?'end':'start'}" letter-spacing="${node.letterSpacing}" font-family="${escape(node.fontFamily)}" font-size="${node.fontSize}" font-weight="${node.fontWeight}" ${attrs}>${node.text.split('\n').map((line,i)=>`<tspan x="${x}" dy="${i?node.lineHeight:0}">${escape(line)}</tspan>`).join('')}</text>`;}
    else shape=`<rect width="${node.width}" height="${node.height}" rx="${node.radius}" ${attrs}/>`;
    return `<g id="${escape(node.id)}" data-name="${escape(node.name)}" transform="translate(${node.x} ${node.y}) ${nodeTransformSVG(node)}" opacity="${node.opacity}">${node.gradient?'<defs>'+gradientSVG(node.gradient,gradientId)+'</defs>':''}${shape}${node.children.map(render).join('')}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><title>${escape(document.name)} · ${escape(getActivePage(document,pageId).name)}</title>${pageNodes(document,pageId).map(render).join('')}</svg>`;
}

export function importDesignJSON(input) {
  if(input?.format===FORMAT)return{document:validateDocument(input),warnings:[]};
  const warnings=new Set();let count=0;
  function check(depth){if(++count>3000||depth>50)throw new Error('导入最多支持 3000 个图层、50 层嵌套。');}
  const freshId=(id)=>`import-${text(id||newId(),100)}-${count}`;
  function m0(value,depth=0) {
    check(depth);const s=value.styles||{};
    const imageData=input.imageMap?.[value.imageId]?.dataURL;
    if(value.nodeType==='image'&&typeof imageData==='string'&&imageData.startsWith('data:image/svg+xml;base64,')){
      const encoded=imageData.slice(26);if(encoded.length>700000||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('M0Schema 的 SVG 素材无效或过大。');
      const source=new TextDecoder().decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))),parsed=parseSVG(source),width=number(s.width,160),height=number(s.height,100),rootWidth=number(/<svg[^>]*\bwidth="([^"]+)"/.exec(source)?.[1],width),rootHeight=number(/<svg[^>]*\bheight="([^"]+)"/.exec(source)?.[1],height),sx=width/rootWidth,sy=height/rootHeight;
      const group={...createNode('group'),id:freshId(value.id),name:value.name||'SVG vector',x:number(s.left),y:number(s.top),width,height,opacity:limit(s.opacity,0,1,1),children:parsed.nodes.map(node=>({...node,id:newId(),x:node.x*sx,y:node.y*sy,width:node.width*sx,height:node.height*sy}))};
      return group;
    }
    const type=value.nodeType==='text'?'text':value.nodeType==='image'&&imageData?'image':depth===0||value.children?.length?'frame':'rectangle';
    if(!['view','text'].includes(value.nodeType)&&type!=='image')warnings.add('缺少本地图片数据的图片和企业组件按边界占位导入，不下载远端素材。');
    const node={...createNode(type),id:freshId(value.id),name:value.name||value.nodeType,x:number(s.left??s.x),y:number(s.top??s.y),width:Math.max(1,number(s.width,200)),height:Math.max(1,number(s.height,type==='text'?36:100)),fill:color(type==='text'?s.color:s.backgroundColor,type==='text'?'#202735':'none'),stroke:color(s.borderColor,'none'),strokeWidth:number(s.borderWidth),radius:number(s.borderRadius),opacity:limit(s.opacity,0,1,1),text:value.characters||'',fontSize:number(s.fontSize,20),fontFamily:s.fontFamily||'Inter, sans-serif',fontWeight:s.fontWeight||'400',children:[]};
    if(s.gradient?.length)warnings.add('渐变暂使用底色显示；没有复原完整 Figma 填充系统。');
    if(type==='image')node.imageData=validateImage(imageData);
    Object.assign(node,{textAlign:['left','center','right'].includes(s.textAlign)?s.textAlign:'left',lineHeight:number(s.lineHeight,node.fontSize*1.25),letterSpacing:number(s.letterSpacing)});
    if(s.display==='flex')warnings.add('M0Schema 的自动布局按已有 left/top 导入；纯 flex 布局需要手动调整位置。');
    node.children=(value.children||[]).map(child=>m0(child,depth+1));return node;
  }
  function paint(paints,fallback='none') {
    const p=paints?.find(p=>p.visible!==false);if(!p)return fallback;
    if(p.type==='SOLID'&&p.color){const c=p.color;return`rgba(${Math.round(limit(c.r,0,1)*255)},${Math.round(limit(c.g,0,1)*255)},${Math.round(limit(c.b,0,1)*255)},${limit((c.a??1)*(p.opacity??1),0,1,1)})`;}
    if(p.type==='GRADIENT_LINEAR')return'#e2e8f5';
    warnings.add('图片、径向渐变和其他特殊填充尚未导入，不调用远端 Figma 服务。');return'#e2e8f5';
  }
  function figmaGradient(paints){const p=paints?.find(p=>p.visible!==false);if(p?.type!=='GRADIENT_LINEAR')return null;const handles=p.gradientHandlePositions||[{x:0,y:0},{x:1,y:0}],rgba=c=>`rgba(${Math.round(limit(c.r,0,1)*255)},${Math.round(limit(c.g,0,1)*255)},${Math.round(limit(c.b,0,1)*255)},${limit((c.a??1)*(p.opacity??1),0,1,1)})`;return validateGradient({type:'linear',from:handles[0],to:handles[1],stops:(p.gradientStops||[]).map(s=>({offset:s.position,color:rgba(s.color)}))});}
  function figma(value,parentOrigin={x:0,y:0},depth=0) {
    check(depth);
    if(['DOCUMENT','CANVAS'].includes(value.type))return(value.children||[]).flatMap(child=>figma(child,{x:0,y:0},depth+1));
    const geometries=Array.isArray(value.fillGeometry)&&value.fillGeometry.length?value.fillGeometry:Array.isArray(value.strokeGeometry)&&value.strokeGeometry.length?value.strokeGeometry:null;
    const supported=['FRAME','GROUP','COMPONENT','INSTANCE','COMPONENT_SET','SECTION','RECTANGLE','ELLIPSE','TEXT'];
    if(!supported.includes(value.type)&&!geometries)warnings.add('缺少 fillGeometry/strokeGeometry 的复杂矢量仍按边界导入；Figma REST 需 geometry=paths。');
    const b=value.absoluteBoundingBox||value.absoluteRenderBounds||{x:value.x||0,y:value.y||0,width:value.size?.x||160,height:value.size?.y||100};
    const type=geometries?'path':value.type==='TEXT'?'text':value.type==='ELLIPSE'?'ellipse':['FRAME','GROUP','COMPONENT','INSTANCE','COMPONENT_SET','SECTION'].includes(value.type)?'frame':'rectangle';
    const s=value.style||{};
    const node={...createNode(type),id:freshId(value.id),name:value.name||value.type,x:number(b.x)-parentOrigin.x,y:number(b.y)-parentOrigin.y,width:Math.max(1,number(b.width,160)),height:Math.max(1,number(b.height,100)),fill:paint(value.fills,type==='text'?'#202735':'none'),stroke:paint(value.strokes),strokeWidth:number(value.strokeWeight),radius:number(value.cornerRadius),opacity:limit(value.opacity,0,1,1),text:value.characters||'',fontSize:number(s.fontSize,20),fontFamily:s.fontFamily||'Inter, sans-serif',fontWeight:String(s.fontWeight||400),hidden:value.visible===false,locked:Boolean(value.locked),children:[]};
    node.gradient=figmaGradient(value.fills);
    if(geometries){const localWidth=number(value.size?.x,node.width),localHeight=number(value.size?.y,node.height),parsed=geometries.map(g=>pathFromSVGData(g.path,{width:localWidth,height:localHeight,fillRule:g.windingRule==='EVENODD'?'evenodd':'nonzero'}));node.path={width:localWidth,height:localHeight,fillRule:parsed[0].fillRule,contours:parsed.flatMap(p=>p.contours)};node.width=localWidth;node.height=localHeight;if(!value.fillGeometry?.length){node.fill=paint(value.strokes);node.gradient=figmaGradient(value.strokes);node.stroke='none';node.strokeWidth=0;}}
    if(value.rotation){node.rotation=number(value.rotation);if(!geometries)warnings.add('Figma rotation 已保留；缺少局部尺寸/transform 的节点仍沿 REST 边界定位。');}
    if(value.effects?.length)warnings.add('阴影和模糊效果尚未导入。');
    Object.assign(node,{textAlign:String(s.textAlignHorizontal||'LEFT').toLowerCase(),lineHeight:number(s.lineHeightPx,node.fontSize*1.25),letterSpacing:number(s.letterSpacing)});
    if(['HORIZONTAL','VERTICAL'].includes(value.layoutMode))node.layout={mode:value.layoutMode.toLowerCase(),gap:number(value.itemSpacing,0),padding:number(value.paddingLeft??value.paddingTop,0),align:value.counterAxisAlignItems==='CENTER'?'center':value.counterAxisAlignItems==='MAX'?'end':'start',justify:value.primaryAxisAlignItems==='SPACE_BETWEEN'?'space-between':value.primaryAxisAlignItems==='CENTER'?'center':value.primaryAxisAlignItems==='MAX'?'end':'start'};
    node.children=geometries?[]:(value.children||[]).flatMap(child=>figma(child,{x:number(b.x),y:number(b.y)},depth+1));
    const rt=value.relativeTransform;
    if(Array.isArray(rt)&&rt.length===2&&rt.every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite))){
      const [a,c,tx]=rt[0],[b,d,ty]=rt[1],sx=Math.hypot(a,b),sy=sx?(a*d-b*c)/sx:0;
      if(node.type==='path'){
        const oldWidth=node.width,oldHeight=node.height;node.path=transformPath(node.path,[a,b,c,d,tx,ty]);node.x=0;node.y=0;node.width=1;node.height=1;node.rotation=0;
        const box=geometryBounds(node);if(node.gradient){const transform=p=>({x:(a*p.x*oldWidth+c*p.y*oldHeight+tx-box.x)/Math.max(.001,box.width),y:(b*p.x*oldWidth+d*p.y*oldHeight+ty-box.y)/Math.max(.001,box.height)});node.gradient={...node.gradient,from:transform(node.gradient.from),to:transform(node.gradient.to)};}Object.assign(node,normalizeVectorNode(node));
      }else if(sx&&sy&&Math.abs(a*c+b*d)<1e-5){node.width=Math.max(1,number(value.size?.x,node.width)*sx);node.height=Math.max(1,number(value.size?.y,node.height)*Math.abs(sy));node.rotation=Math.atan2(b,a)*180/Math.PI;node.flipY=sy<0;const origin=transformLocalPoint(node,{x:0,y:0});node.x=tx-origin.x;node.y=ty-origin.y;}
      else warnings.add('非矢量节点的倾斜 transform 尚未完整导入。');
    }
    return[node];
  }
  let nodes,name=input?.name||'导入的设计';
  if(input?.document?.type==='DOCUMENT'&&input.document.children?.some(page=>page.type==='CANVAS')){
    const pages=input.document.children.filter(page=>page.type==='CANVAS').map((page,index)=>({id:'import-page-'+index,name:page.name||'Page '+(index+1),nodes:(page.children||[]).flatMap(child=>figma(child))}));
    return{document:validateDocument({format:FORMAT,version:2,name,activePageId:pages[0]?.id,pages,components:[]}),warnings:[...warnings]};
  }
  if(input?.nodeTree)nodes=[m0(input.nodeTree)];
  else if(input?.document?.type)nodes=figma(input.document);
  else if(input?.type)nodes=figma(input);
  else if(input?.nodes&&typeof input.nodes==='object'&&!Array.isArray(input.nodes))nodes=Object.values(input.nodes).flatMap(item=>item?.document?figma(item.document):[]);
  else throw new Error('请选择本地画布、M0Schema 或 Figma REST JSON；不支持 .fig 二进制文件。');
  if(!nodes.length)throw new Error('JSON 中没有可导入的设计节点。');
  return {document:validateDocument({format:FORMAT,version:1,name,nodes}),warnings:[...warnings]};
}
