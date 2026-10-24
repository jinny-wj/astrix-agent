import {emptyDocument,validateDocument,createNode,findNode,documentBounds,documentToM0Schema,documentToSVG,importDesignJSON,newId,getActivePage,pageNodes,createPage,applyLayouts,selectedRoots,selectionBounds,groupNodes,ungroupNode,alignNodes,createComponent,insertInstance,syncComponent,detachInstance,findNodeAllPages,walkDocument,validateImage} from './model.mjs';
import * as vectors from './model.mjs';
import {createCanvasCollaboration} from './collaboration.mjs';

const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const stage=$('stage'),scene=$('scene'),selection=$('selection');
let projectId=new URLSearchParams(location.search).get('projectId')||'';
const endpoint=path=>{const params=new URLSearchParams();if(projectId||state.boundProjectId)params.set('projectId',projectId||state.boundProjectId);else if(state.workspaceKey)params.set('workspaceKey',state.workspaceKey);return`/__local/canvas${path||''}${params.size?'?'+params:''}`;};
const state={document:emptyDocument(),selected:null,selection:[],snap:true,rulers:true,assets:false,tool:'select',zoom:1,pan:{x:60,y:50},history:[],future:[],revision:null,dirty:false,version:0,loading:true,conflict:false,space:false,vectorEditing:null,vectorPoint:null,penNode:null,live:{active:false,readOnly:false,connected:true,pending:false}};
let collaboration=null;
let gesture=null,saveTimer,saveFlight=null,noticeTimer,resultFiles=[],inputDraft=null;
const copy=value=>JSON.parse(JSON.stringify(value));
const svg=(name,attrs={})=>{const element=document.createElementNS(NS,name);for(const[key,value]of Object.entries(attrs))element.setAttribute(key,String(value));return element;};
const nodeType={frame:'Frame',rectangle:'Rectangle',ellipse:'Ellipse',text:'Text',group:'Group',image:'Image',path:'Vector'};
const icon={frame:'▣',rectangle:'▭',ellipse:'◯',text:'T',group:'▧',image:'▧',path:'◇'};
const nodes=()=>pageNodes(state.document);
const selected=()=>selectedRoots(state.document,state.selection);
const handleError=error=>notice(error.message||String(error),true);

function notice(message,error=false,stay=false){clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=false;if(!stay)noticeTimer=setTimeout(()=>$('notice').hidden=true,error?9000:4500);}
function setSaveStatus(text,error=false){$('save-status').textContent=text;$('save-status').style.color=error?'#bb5656':'';}
async function request(url,options={}){
  const response=await fetch(url,{...options,headers:{'content-type':'application/json',...options.headers}});
  const body=await response.json();if(!response.ok||body.error){const error=new Error(body.error?.message||body.error||`HTTP ${response.status}`);error.status=response.status;throw error;}return body;
}
function isReadOnly(){return !!(state.live.readOnly||collaboration?.isReadOnly()||(state.live.active&&!state.live.connected));}
function requireEditable(){if(isReadOnly())throw new Error('当前协作连接为只读或已断开，请重连后再编辑。');}
function isInteracting(){return !!gesture||!!(inputDraft&&inputDraft.isConnected&&document.activeElement===inputDraft);}
function remember(before=JSON.stringify(state.document)){if(collaboration?.isActive())return;state.history.push(before);if(state.history.length>80)state.history.shift();state.future=[];}
function changed(before,reason='edit'){state.version++;state.dirty=true;render();clearTimeout(saveTimer);if(collaboration?.isActive()){collaboration.changed({before:typeof before==='string'?JSON.parse(before):before,after:copy(state.document),reason});collaboration.presence({selectedIds:[...state.selection],pageId:state.document.activePageId});return;}setSaveStatus(state.conflict?'保存冲突':'尚未保存',state.conflict);if(!state.conflict)saveTimer=setTimeout(()=>void saveDocument().catch(()=>{}),800);}
function commit(action,reason='edit'){if(state.loading)return;requireEditable();const before=JSON.stringify(state.document);try{action();state.document=applyLayouts(validateDocument(state.document));if(before!==JSON.stringify(state.document)){remember(before);changed(before,reason);}else render();}catch(error){state.document=JSON.parse(before);render();throw error;}}
function select(id,add=false){if(id!==state.vectorEditing&&state.vectorEditing)finishVector();if(id!==state.vectorEditing){state.vectorEditing=null;state.vectorPoint=null;state.penNode=null;}if(!id)state.selection=[];else if(add)state.selection=state.selection.includes(id)?state.selection.filter(value=>value!==id):[...state.selection,id];else state.selection=[id];state.selected=state.selection.at(-1)||null;render();collaboration?.presence({selectedIds:[...state.selection],pageId:state.document.activePageId});}
function current(){return state.selected?findNode(state.document,state.selected):null;}
function tool(name){if(state.vectorEditing&&(name!=='pen'||!state.penNode))finishVector();state.tool=name;stage.dataset.tool=name;for(const button of document.querySelectorAll('[data-tool]'))button.classList.toggle('active',button.dataset.tool===name);}

async function saveDocument(){
  clearTimeout(saveTimer);
  if(state.loading)return;
  if(collaboration?.isActive()){const result=await collaboration.flush();if(result?.revision)state.revision=result.revision;return result;}
  if(state.conflict)throw new Error('磁盘上的画布已发生变化。请先导出备份，再从“文件”重新载入。');
  if(saveFlight){await saveFlight;if(state.dirty)return saveDocument();return;}
  if(!state.dirty)return;
  const version=state.version,document=validateDocument(state.document),expectedRevision=state.revision;
  setSaveStatus('正在保存…');
  saveFlight=(async()=>{
    try{
      const saved=await request(endpoint(),{method:'PUT',body:JSON.stringify({document,expectedRevision})});
      state.revision=saved.revision;state.dirty=state.version!==version;setSaveStatus(state.dirty?'尚未保存':'已保存到本机');collaboration?.loaded({document:copy(document),revision:state.revision,scope:{projectId,workspaceKey:state.workspaceKey}});
      if(state.dirty)saveTimer=setTimeout(()=>void saveDocument().catch(()=>{}),300);
      return saved;
    }catch(error){if(error.status===409)state.conflict=true;setSaveStatus(state.conflict?'保存冲突':'保存失败',true);notice(state.conflict?'其他窗口已修改 canvas.json。当前编辑仍在此页；请先导出画布备份，再从“文件”重新载入。':error.message,true,true);throw error;}
    finally{saveFlight=null;}
  })();return saveFlight;
}
async function loadDocument(){
  clearTimeout(saveTimer);if(saveFlight)await saveFlight.catch(()=>{});
  state.loading=true;render();
  try{
    const saved=await request(endpoint());state.document=saved.document?applyLayouts(validateDocument(saved.document)):emptyDocument();state.revision=saved.revision??null;
    if(!projectId&&saved.projectId!==null&&saved.projectId!==undefined){projectId=String(saved.projectId);const url=new URL(location.href);url.searchParams.set('projectId',projectId);history.replaceState(null,'',url);}
    state.boundProjectId=projectId||saved.projectId||'';
    state.workspaceKey=saved.workspaceKey||state.workspaceKey||'';
    state.selected=null;state.selection=[];state.history=[];state.future=[];state.dirty=false;state.conflict=false;state.version=0;
    setSaveStatus(saved.document?'已保存到本机':'新画布 · 本机保存');$('notice').hidden=true;
    state.loading=false;render();fit();collaboration?.loaded({document:copy(state.document),revision:state.revision,scope:{projectId,workspaceKey:state.workspaceKey}});
  }catch(error){state.loading=false;setSaveStatus('载入失败',true);notice(error.message,true,true);render();}
}

function shape(node){
  const attrs={fill:node.gradient?'url(#gradient-'+node.id+')':node.fill,stroke:node.stroke,'stroke-width':node.strokeWidth};
  if(node.type==='path')return svg('path',{d:vectors.pathToSVGData(node),...attrs,'fill-rule':node.path?.fillRule||'nonzero','stroke-linejoin':'round','stroke-linecap':'round'});
  if(node.type==='ellipse')return svg('ellipse',{cx:node.width/2,cy:node.height/2,rx:node.width/2,ry:node.height/2,...attrs});
  if(node.type==='text'){
    const x=node.textAlign==='center'?node.width/2:node.textAlign==='right'?node.width:0;
    const text=svg('text',{x,y:node.fontSize,'text-anchor':node.textAlign==='center'?'middle':node.textAlign==='right'?'end':'start','letter-spacing':node.letterSpacing,'font-size':node.fontSize,'font-family':node.fontFamily,'font-weight':node.fontWeight,...attrs});
    for(const[line,index]of node.text.split('\n').map((value,index)=>[value,index])){const span=svg('tspan',{x,dy:index?node.lineHeight:0});span.textContent=line||' ';text.append(span);}return text;
  }
  if(node.type==='image'&&node.imageData){const group=svg('g'),clip=svg('clipPath',{id:'clip-'+node.id}),image=svg('image',{href:node.imageData,width:node.width,height:node.height,preserveAspectRatio:'xMidYMid '+(node.imageFit==='contain'?'meet':'slice'),'clip-path':'url(#clip-'+node.id+')'});clip.append(svg('rect',{width:node.width,height:node.height,rx:node.radius}));group.append(clip,image);return group;}
  return svg('rect',{width:node.width,height:node.height,rx:node.radius,...attrs});
}
function renderScene(){
  scene.replaceChildren();selection.replaceChildren();const transform=`translate(${state.pan.x} ${state.pan.y}) scale(${state.zoom})`;scene.setAttribute('transform',transform);selection.setAttribute('transform',transform);
  function draw(node,parent,depth=0){
    if(node.hidden)return;
    const group=svg('g',{'data-node-id':node.id,transform:`translate(${node.x} ${node.y}) ${vectors.nodeTransformSVG?.(node)||''}`,opacity:node.opacity});
    if(node.gradient){const gradient=svg('linearGradient',{id:'gradient-'+node.id,x1:node.gradient.from.x,y1:node.gradient.from.y,x2:node.gradient.to.x,y2:node.gradient.to.y});for(const stop of node.gradient.stops)gradient.append(svg('stop',{offset:stop.offset,'stop-color':stop.color}));const defs=svg('defs');defs.append(gradient);group.append(defs);}
    // A transparent hit rect makes empty frames and text selectable.
    group.append(svg('rect',{width:node.width,height:node.height,fill:'transparent','pointer-events':'all'}));group.append(shape(node));
    if(node.type==='frame'&&depth===0){const label=svg('text',{x:0,y:-9/state.zoom,'font-size':11/state.zoom,fill:'#8e99ac','pointer-events':'none'});label.textContent=node.name;group.append(label);}
    parent.append(group);for(const child of node.children)draw(child,group,depth+1);
  }
  nodes().forEach(node=>draw(node,scene));
  const entries=selected();
  for(const entry of entries)if(!entry.node.hidden){const node=entry.node,outline=svg('g',{transform:overlayMatrix(node.id)});outline.append(svg('rect',{x:0,y:0,width:node.width,height:node.height,fill:'none',stroke:node.componentId?'#9747ff':'#0d99ff','stroke-width':1.2/state.zoom,'pointer-events':'none'}));
    if(entries.length===1&&!node.locked&&state.vectorEditing!==node.id)for(const[name,rx,ry]of[['nw',0,0],['n',.5,0],['ne',1,0],['e',1,.5],['se',1,1],['s',.5,1],['sw',0,1],['w',0,.5]]){const size=6/state.zoom;const handle=svg('rect',{x:node.width*rx-size/2,y:node.height*ry-size/2,width:size,height:size,fill:'#fff',stroke:'#0d99ff','stroke-width':1/state.zoom,'data-handle':name,style:`cursor:${name}-resize`});outline.append(handle);}selection.append(outline);
  }
  if(entries.length>1){const boxes=entries.map(entry=>nodeWorldBounds(entry.node.id)).filter(Boolean),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),bounds={x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};selection.append(svg('rect',{...bounds,fill:'none',stroke:'#0d99ff','stroke-dasharray':4/state.zoom,'stroke-width':1/state.zoom,'pointer-events':'none'}));}
  if(gesture?.kind==='marquee'){const b=gesture.bounds;if(b)selection.append(svg('rect',{...b,fill:'#0d99ff14',stroke:'#0d99ff','stroke-width':1/state.zoom,'pointer-events':'none'}));}
  renderVectorOverlay();
  $('empty-state').hidden=nodes().length>0||state.loading;$('zoom-label').textContent=Math.round(state.zoom*100)+'%';
  renderRulers();
  collaboration?.paint();
}
function nodeElement(id){return[...scene.querySelectorAll('[data-node-id]')].find(element=>element.dataset.nodeId===id);}
function nodePoint(event,id){const matrix=nodeElement(id)?.getScreenCTM();return matrix?new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()):{x:0,y:0};}
function overlayMatrix(id){const local=nodeElement(id)?.getCTM(),world=scene.getCTM();if(!local||!world)return'';const m=world.inverse().multiply(local);return`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;}
function nodeWorldBounds(id){const node=findNode(state.document,id)?.node,element=nodeElement(id);if(!node||!element)return null;const m=scene.getCTM().inverse().multiply(element.getCTM()),points=[[0,0],[node.width,0],[0,node.height],[node.width,node.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m)),x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return{x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};}
function renderVectorOverlay(){const node=state.vectorEditing&&findNode(state.document,state.vectorEditing)?.node;if(!node||node.type!=='path')return;const overlay=svg('g',{transform:overlayMatrix(node.id),'data-vector-overlay':node.id}),anchors=vectors.getPathAnchors(node);for(const anchor of anchors){const{contourIndex:ci,pointIndex:pi}=anchor,chosen=state.vectorPoint?.ci===ci&&state.vectorPoint?.pi===pi;if(chosen)for(const handle of ['in','out']){const point=anchor[handle];if(!point||Math.hypot(point.x-anchor.x,point.y-anchor.y)<.1)continue;overlay.append(svg('line',{x1:anchor.x,y1:anchor.y,x2:point.x,y2:point.y,stroke:'#0d99ff','stroke-width':1/state.zoom,'pointer-events':'none'}));overlay.append(svg('circle',{cx:point.x,cy:point.y,r:4/state.zoom,fill:'#fff',stroke:'#0d99ff','stroke-width':1/state.zoom,'data-vector-handle':handle,'data-ci':ci,'data-pi':pi}));}
    overlay.append(svg('rect',{x:anchor.x-3.5/state.zoom,y:anchor.y-3.5/state.zoom,width:7/state.zoom,height:7/state.zoom,fill:chosen?'#0d99ff':'#fff',stroke:'#0d99ff','stroke-width':1/state.zoom,'data-vector-anchor':'','data-ci':ci,'data-pi':pi}));}
  selection.append(overlay);
}
function renderRulers(){const width=stage.clientWidth,height=stage.clientHeight,step=state.zoom<.3?500:state.zoom<.7?100:state.zoom<2?50:10;for(const[axis,size]of [['x',width],['y',height]]){const ruler=$(axis==='x'?'ruler-top':'ruler-left');ruler.hidden=!state.rulers;ruler.replaceChildren();if(!state.rulers)continue;const min=Math.floor(-state.pan[axis]/state.zoom/step)*step,max=(size-state.pan[axis])/state.zoom;for(let n=min;n<max;n+=step){const mark=document.createElement('span');mark.textContent=n;mark.style[axis==='x'?'left':'top']=(state.pan[axis]+n*state.zoom)+'px';ruler.append(mark);}}document.querySelector('.ruler-corner').hidden=!state.rulers;}
function renderLayers(){
  const layers=$('layers');layers.replaceChildren();let count=0;
  function walk(nodes,depth=0){for(const node of [...nodes].reverse()){count++;const row=document.createElement('div');row.className='layer-row'+(state.selection.includes(node.id)?' selected':'')+(node.hidden?' dimmed':'');row.style.paddingLeft=(10+depth*12)+'px';row.dataset.layerId=node.id;row.setAttribute('role','treeitem');row.setAttribute('aria-label',node.name);row.setAttribute('aria-selected',String(state.selection.includes(node.id)));
    const glyph=document.createElement('span');glyph.className='layer-icon';glyph.textContent=node.componentRole==='main'?'❖':node.componentRole==='instance'?'◇':icon[node.type];const name=document.createElement('span');name.className='layer-name';name.textContent=node.name;
    const hide=document.createElement('button');hide.textContent=node.hidden?'○':'●';hide.title=node.hidden?'显示图层':'隐藏图层';hide.setAttribute('aria-label',hide.title+' '+node.name);hide.onclick=event=>{event.stopPropagation();commit(()=>{node.hidden=!node.hidden;});};
    const lock=document.createElement('button');lock.textContent=node.locked?'▣':'◇';lock.title=node.locked?'解锁图层':'锁定图层';lock.setAttribute('aria-label',lock.title+' '+node.name);lock.onclick=event=>{event.stopPropagation();commit(()=>{node.locked=!node.locked;});};
    row.append(glyph,name,hide,lock);row.onclick=event=>select(node.id,event.shiftKey||event.metaKey||event.ctrlKey);layers.append(row);walk(node.children,depth+1);
  }}walk(nodes());layers.setAttribute('role','tree');$('node-count').textContent=String(count);
  if(!count){const empty=document.createElement('p');empty.className='layers-empty';empty.textContent='画板和形状会出现在这里。选择上方工具，在画布上绘制。';layers.append(empty);}
}
function renderInspector(){
  const entry=current(),node=entry?.node;$('properties').hidden=!node;$('inspector-empty').hidden=!!node;$('selection-type').textContent=state.selection.length>1?state.selection.length+' layers':node?nodeType[node.type]:'';
  if(!node)return;
  for(const input of document.querySelectorAll('[data-prop]')){
    if(document.activeElement===input)continue;const value=node[input.dataset.prop];
    if(input.type==='checkbox')input.checked=Boolean(value);else input.value=input.dataset.prop==='opacity'?Math.round(value*100):value??'';
  }
  $('text-properties').hidden=node.type!=='text';if(document.activeElement!==$('fill-picker'))$('fill-picker').value=/^#[\da-f]{6}$/i.test(node.fill)?node.fill:'#6b8afd';
  $('layout-properties').hidden=!['frame','group'].includes(node.type);
  for(const input of document.querySelectorAll('[data-layout]'))if(document.activeElement!==input)input.value=node.layout?.[input.dataset.layout]??'';
  $('image-properties').hidden=node.type!=='image';
  $('create-component').hidden=!!node.componentRole;$('insert-instance').hidden=!node.componentId;$('sync-component').hidden=node.componentRole!=='main';$('detach-instance').hidden=node.componentRole!=='instance';$('component-label').textContent=node.componentRole==='main'?'❖ Main component':node.componentRole==='instance'?'◇ Instance':'Component';
  const target=$('prototype-target');target.replaceChildren(new Option('无',''));walkDocument(state.document,(value,_parent,page)=>{if(value.type==='frame'&&value.id!==node.id)target.append(new Option(page.name+' / '+value.name,value.id));});target.value=node.prototype?.targetId||'';
  $('group').disabled=selected().length<2;$('ungroup').disabled=node.type!=='group';
  for(const button of document.querySelectorAll('[data-align]'))button.disabled=selected().length<2;
  const vectorCapable=['rectangle','ellipse','path','group'].includes(node.type);
  $('edit-vector').disabled=!vectorCapable;$('flatten-vector').disabled=!vectorCapable;
  for(const button of document.querySelectorAll('[data-boolean]'))button.disabled=selected().length<2;
  $('path-properties').hidden=state.vectorEditing!==node.id||node.type!=='path';
  if(node.type==='path'){const point=state.vectorPoint,contour=node.path?.contours?.[point?.ci||0];$('path-closed').checked=!!contour?.closed;$('path-point-status').textContent=point?`锚点 ${point.pi+1} · 轮廓 ${point.ci+1}`:'选择锚点';$('delete-vector-point').disabled=!point;$('add-vector-point').disabled=!point||!contour||contour.points.length<2||(!contour.closed&&point.pi===contour.points.length-1);$('smooth-vector-point').disabled=!point;}
  $('fill-mode').value=node.gradient?'linear':'solid';$('fill-mode').disabled=node.type==='image';$('gradient-properties').hidden=!node.gradient;
  if(node.gradient){if(document.activeElement!==$('gradient-from'))$('gradient-from').value=node.gradient.stops[0]?.color||'#8fa8ff';if(document.activeElement!==$('gradient-to'))$('gradient-to').value=node.gradient.stops.at(-1)?.color||'#b8f1dd';if(document.activeElement!==$('gradient-angle'))$('gradient-angle').value=Math.round(Math.atan2(node.gradient.to.y-node.gradient.from.y,node.gradient.to.x-node.gradient.from.x)*180/Math.PI);}
  $('flip-x').classList.toggle('active',!!node.flipX);$('flip-y').classList.toggle('active',!!node.flipY);
}
function render(){
  state.selection=state.selection.filter(id=>findNode(state.document,id));if(!state.selection.includes(state.selected))state.selected=state.selection.at(-1)||null;
  renderScene();renderLayers();for(const button of document.querySelectorAll('#properties button'))button.disabled=false;renderInspector();renderPages();renderLibrary();if(document.activeElement!==$('document-name'))$('document-name').value=state.document.name;
  $('page-caption').textContent=getActivePage(state.document).name;$('selection-caption').textContent=state.selection.length?state.selection.length+' selected':'Design';
  $('undo').disabled=state.loading||(state.live.active?!state.live.canUndo:!state.history.length);$('redo').disabled=state.loading||(state.live.active?!state.live.canRedo:!state.future.length);
  for(const id of ['delete','duplicate','move-up','move-down'])$(id).disabled=state.loading||!current();
  const readOnly=isReadOnly();
  $('generate').disabled=state.loading||!nodes().length||!!state.live.remote||readOnly;$('save').disabled=state.loading;
  $('collaborate').disabled=!!state.live.remote||readOnly;$('present').disabled=!!state.live.remote;
  for(const control of document.querySelectorAll('#properties input,#properties select,#properties textarea,#pages input,#add-page,#first-frame,#duplicate,#delete,#move-up,#move-down,#import,#import-image,#document-name,[data-tool]:not([data-tool="select"]):not([data-tool="hand"])'))control.disabled=readOnly||(control.id==='fill-mode'&&current()?.node.type==='image')||(['duplicate','delete','move-up','move-down'].includes(control.id)&&!current());
  for(const control of document.querySelectorAll('#properties button,#component-library button,#pages .page-row button:last-child,#layers .layer-row button'))if(readOnly)control.disabled=true;
}
function renderPages(){
  const list=$('pages'),existing=new Map([...list.children].map(row=>[row.dataset.pageId,row]));
  state.document.pages.forEach((page,index)=>{
    let row=existing.get(page.id);
    if(!row){
      row=document.createElement('div');row.dataset.pageId=page.id;
      const id=page.id,mark=document.createElement('button'),name=document.createElement('input'),remove=document.createElement('button');
      mark.onclick=()=>switchPage(id);
      name.onfocus=()=>{if(id!==state.document.activePageId)switchPage(id);};
      name.onchange=()=>{try{commit(()=>{const current=state.document.pages.find(page=>page.id===id);if(current)current.name=name.value||'Page';});}catch(error){handleError(error);}};
      remove.textContent='×';remove.title='删除页面';remove.onclick=()=>{
        const page=state.document.pages.find(page=>page.id===id);if(!page)return;
        if(page.nodes.length&&!confirm('删除此页面及图层？可通过撤销恢复。'))return;
        try{commit(()=>{state.document.pages=state.document.pages.filter(page=>page.id!==id);if(state.document.activePageId===id)state.document.activePageId=state.document.pages[0].id;state.selection=[];state.selected=null;});fit();}catch(error){handleError(error);}
      };
      row.append(mark,name,remove);
    }
    existing.delete(page.id);row.className='page-row'+(page.id===state.document.activePageId?' active':'');
    const[mark,name,remove]=row.children;
    mark.textContent=page.id===state.document.activePageId?'✓':'▤';mark.setAttribute('aria-label','打开页面 '+page.name);
    if(document.activeElement!==name)name.value=page.name;name.setAttribute('aria-label','页面名称 '+page.name);
    remove.disabled=state.document.pages.length===1;
    // Do not detach the focused input on status updates or unchanged ordering.
    if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);
  });
  for(const row of existing.values())row.remove();
}
function switchPage(id){if(id===state.document.activePageId)return;if(state.live.active){state.document.activePageId=id;state.selection=[];state.selected=null;state.vectorEditing=null;render();collaboration?.presence({pageId:id,selectedIds:[]});}else commit(()=>{state.document.activePageId=id;state.selection=[];state.selected=null;});fit();}
function renderLibrary(){const library=$('component-library');library.replaceChildren();$('component-count').textContent=state.document.components.length;for(const component of state.document.components){const main=findNodeAllPages(state.document,component.mainNodeId)?.node,card=document.createElement('button');card.className='component-card';card.disabled=!main;const preview=document.createElement('span');preview.className='component-preview';preview.textContent='❖';preview.style.color=main?.fill&&main.fill!=='none'?main.fill:'#9747ff';const name=document.createElement('strong');name.textContent=component.name;const hint=document.createElement('small');hint.textContent=main?'点击插入实例':'主组件已删除';card.append(preview,name,hint);card.onclick=()=>{try{commit(()=>{const id=insertInstance(state.document,component.id);state.selection=[id];state.selected=id;});fit();}catch(error){handleError(error);}};library.append(card);}if(!state.document.components.length){const hint=document.createElement('p');hint.className='layers-empty';hint.textContent='选中图层并创建主组件，即可在各页面插入可同步的本地实例。';library.append(hint);}}
function undo(){if(collaboration?.isActive()){void collaboration.undo().catch(handleError);return;}if(!state.history.length)return;const before=JSON.stringify(state.document);state.future.push(before);state.document=JSON.parse(state.history.pop());if(!current())state.selected=null;changed(before,'undo');}
function redo(){if(collaboration?.isActive()){void collaboration.redo().catch(handleError);return;}if(!state.future.length)return;const before=JSON.stringify(state.document);state.history.push(before);state.document=JSON.parse(state.future.pop());if(!current())state.selected=null;changed(before,'redo');}
function erase(){const entries=selected().filter(entry=>!entry.node.locked);if(!entries.length)return;commit(()=>{for(const entry of entries)entry.siblings.splice(entry.siblings.indexOf(entry.node),1);state.selected=null;state.selection=[];});}
function duplicate(){const entries=selected();if(!entries.length)return;commit(()=>{const selection=[];for(const entry of entries){const node=copy(entry.node);function ids(node){node.id=newId();node.children.forEach(ids);}ids(node);if(node.componentRole==='main')node.componentRole='instance';node.x+=24;node.y+=24;node.name+=' copy';entry.siblings.splice(entry.siblings.indexOf(entry.node)+1,0,node);selection.push(node.id);}state.selection=selection;state.selected=selection.at(-1);});}
function moveLayer(delta){const entry=current();if(!entry)return;commit(()=>{const to=Math.min(entry.siblings.length-1,Math.max(0,entry.index+delta));entry.siblings.splice(entry.index,1);entry.siblings.splice(to,0,entry.node);});}
function point(event){const rect=stage.getBoundingClientRect();return{x:(event.clientX-rect.left-state.pan.x)/state.zoom,y:(event.clientY-rect.top-state.pan.y)/state.zoom};}
function parentForDrawing(){const entry=current();if(!entry)return null;if(entry.node.type==='frame'&&!entry.node.locked)return entry;return entry.parent?.type==='frame'?findNode(state.document,entry.parent.id):null;}
function editVector(){try{requireEditable();const entry=current();if(!entry)return;let id=entry.node.id;if(entry.node.type!=='path')commit(()=>{id=vectors.convertNodeToPath(state.document,id);},'convert-path');state.selected=id;state.selection=[id];state.vectorEditing=id;state.vectorPoint={ci:0,pi:0};state.penNode=null;render();}catch(error){handleError(error);}}
function finishVector(){const id=state.vectorEditing||state.penNode;state.penNode=null;state.vectorEditing=null;state.vectorPoint=null;if(id&&findNode(state.document,id))try{commit(()=>vectors.normalizePathBounds(state.document,id),'finish-path');}catch(error){handleError(error);}render();}
function vectorAction(action,reason='vector'){try{requireEditable();const entry=current();if(!entry||entry.node.type!=='path')return;commit(()=>action(entry.node),reason);}catch(error){handleError(error);}}
function addVectorPoint(){const point=state.vectorPoint;if(!point)return;vectorAction(node=>{node.path=vectors.insertPathPoint(node,point.ci,point.pi,.5);state.vectorPoint={ci:point.ci,pi:point.pi+1};},'insert-anchor');}
function removeVectorPoint(){const point=state.vectorPoint;if(!point)return;vectorAction(node=>{node.path=vectors.removePathPoint(node,point.ci,point.pi);const count=node.path.contours[point.ci]?.points.length||0;state.vectorPoint=count?{ci:point.ci,pi:Math.min(point.pi,count-1)}:null;},'delete-anchor');}

stage.addEventListener('pointerdown',event=>{
  if(state.loading||event.button>1)return;
  const start=point(event),target=event.target.closest('[data-node-id]'),handle=event.target.getAttribute('data-handle'),vectorTarget=event.target.closest('[data-vector-anchor],[data-vector-handle]');
  if(event.button!==1&&!state.space&&state.tool!=='hand'&&isReadOnly()){if(target)select(target.dataset.nodeId,event.shiftKey);return;}
  if(event.button===1||state.space||state.tool==='hand'){gesture={kind:'pan',start:{x:event.clientX,y:event.clientY},pan:{...state.pan}};}
  else if(vectorTarget&&state.vectorEditing){
    const ci=Number(vectorTarget.dataset.ci),pi=Number(vectorTarget.dataset.pi),node=findNode(state.document,state.vectorEditing)?.node;if(!node)return;
    if(state.tool==='pen'&&state.penNode===node.id&&ci===0&&pi===0&&node.path.contours[0].points.length>=3){commit(()=>{node.path=vectors.setPathClosed(node.path,0,true);},'close-path');finishVector();tool('select');return;}
    state.vectorPoint={ci,pi};gesture={kind:vectorTarget.hasAttribute('data-vector-handle')?'vector-handle':'vector-anchor',id:node.id,start,before:JSON.stringify(state.document),ci,pi,handle:vectorTarget.dataset.vectorHandle,moved:false};renderScene();renderInspector();
  }
  else if(state.tool==='pen'){
    const before=JSON.stringify(state.document);let node=state.penNode&&findNode(state.document,state.penNode)?.node;
    if(!node){const parent=parentForDrawing(),position=parent?nodePoint(event,parent.node.id):start;node=createNode('path',position.x,position.y);node.width=1000;node.height=1000;node.name='Vector';node.fill='none';node.stroke='#202735';node.strokeWidth=2;node.path={width:1000,height:1000,fillRule:'nonzero',contours:[{closed:false,points:[]}]};(parent?.node.children||nodes()).push(node);state.penNode=node.id;state.vectorEditing=node.id;state.selection=[node.id];state.selected=node.id;renderScene();}
    const local=nodePoint(event,node.id);node.path=vectors.appendPathPoint(node.path,{x:local.x,y:local.y},0);const pi=node.path.contours[0].points.length-1;state.vectorPoint={ci:0,pi};gesture={kind:'pen-add',id:node.id,start,before,ci:0,pi,moved:false};render();
  }
  else if(state.vectorEditing&&target?.dataset.nodeId===state.vectorEditing){const node=current()?.node,local=nodePoint(event,state.vectorEditing),anchors=vectors.getPathAnchors(node);if(anchors.length){const nearest=anchors.sort((a,b)=>Math.hypot(a.x-local.x,a.y-local.y)-Math.hypot(b.x-local.x,b.y-local.y))[0];state.vectorPoint={ci:nearest.contourIndex,pi:nearest.pointIndex};renderScene();renderInspector();}return;}
  else if(state.tool!=='select'){
    const parent=state.tool==='frame'?null:parentForDrawing(),matrix=(parent?nodeElement(parent.node.id):scene).getScreenCTM().inverse(),local=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix);
    const node=createNode(state.tool,local.x,local.y);
    gesture={kind:'draw',id:node.id,start,before:JSON.stringify(state.document),initial:{width:node.width,height:node.height},drawMatrix:matrix,drawStart:local,moved:false};
    (parent?.node.children||nodes()).push(node);state.selected=node.id;state.selection=[node.id];render();
  }else if(handle&&current()){
    const entry=current();if(entry.node.locked)return;const matrix=nodeElement(entry.node.id).getScreenCTM().inverse();gesture={kind:'resize',handle,id:entry.node.id,start,before:JSON.stringify(state.document),initial:copy(entry.node),resizeMatrix:matrix,localStart:new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix),moved:false};
  }else if(target){
    const id=target.dataset.nodeId;if(event.shiftKey||event.metaKey||event.ctrlKey){select(id,true);return;}if(!state.selection.includes(id))select(id);const entry=current();if(!entry.node.locked)gesture={kind:'move',id:entry.node.id,start,before:JSON.stringify(state.document),initial:selected().filter(e=>!e.node.locked).map(e=>{const parent=e.parent?nodeElement(e.parent.id):scene,matrix=parent.getScreenCTM().inverse();return{id:e.node.id,x:e.node.x,y:e.node.y,matrix,pointer:new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix)};}),moved:false};
  }else{if(!event.shiftKey)select(null);gesture={kind:'marquee',start,initial:[...state.selection],bounds:null};}
  if(gesture){stage.setPointerCapture(event.pointerId);event.preventDefault();}
});
stage.addEventListener('pointermove',event=>{
  collaboration?.presence({pointer:point(event),selectedIds:[...state.selection],pageId:state.document.activePageId});
  if(!gesture)return;
  if(gesture.kind==='pan'){state.pan={x:gesture.pan.x+event.clientX-gesture.start.x,y:gesture.pan.y+event.clientY-gesture.start.y};renderScene();return;}
  if(gesture.kind==='marquee'){const now=point(event),bounds={x:Math.min(now.x,gesture.start.x),y:Math.min(now.y,gesture.start.y),width:Math.abs(now.x-gesture.start.x),height:Math.abs(now.y-gesture.start.y)};gesture.bounds=bounds;const ids=[];function visit(list){for(const node of list){if(node.hidden||node.locked)continue;const b=nodeWorldBounds(node.id);if(b&&b.x>=bounds.x&&b.y>=bounds.y&&b.x+b.width<=bounds.x+bounds.width&&b.y+b.height<=bounds.y+bounds.height)ids.push(node.id);else visit(node.children);}}visit(nodes());state.selection=[...new Set([...gesture.initial,...ids])];state.selected=state.selection.at(-1)||null;renderScene();renderLayers();renderInspector();return;}
  const now=point(event),dx=now.x-gesture.start.x,dy=now.y-gesture.start.y,node=findNode(state.document,gesture.id)?.node;if(!node)return;
  if(Math.abs(dx)+Math.abs(dy)>2/state.zoom)gesture.moved=true;
  const snap=value=>state.snap&&!event.altKey?Math.round(value/8)*8:Math.round(value);
  if(['vector-anchor','vector-handle','pen-add'].includes(gesture.kind)){
    const local=nodePoint(event,node.id);
    if(gesture.kind==='vector-anchor')node.path=vectors.movePathAnchor(node,gesture.ci,gesture.pi,local);
    else if(gesture.kind==='vector-handle')node.path=vectors.movePathHandle(node,gesture.ci,gesture.pi,gesture.handle,local,{mirror:!event.altKey&&node.path.contours[gesture.ci].points[gesture.pi].mode!=='corner'});
    else if(gesture.moved){node.path.contours[gesture.ci].points[gesture.pi].mode='symmetric';node.path=vectors.movePathHandle(node,gesture.ci,gesture.pi,'out',local,{mirror:true});}
    renderScene();renderInspector();return;
  }
  if(gesture.kind==='move')for(const initial of gesture.initial){const target=findNode(state.document,initial.id)?.node;if(target){const now=new DOMPoint(event.clientX,event.clientY).matrixTransform(initial.matrix);target.x=snap(initial.x+now.x-initial.pointer.x);target.y=snap(initial.y+now.y-initial.pointer.y);}}
  if(gesture.kind==='draw'){const local=new DOMPoint(event.clientX,event.clientY).matrixTransform(gesture.drawMatrix),start=gesture.drawStart;node.x=Math.round(Math.min(local.x,start.x));node.y=Math.round(Math.min(local.y,start.y));node.width=Math.max(1,Math.round(Math.abs(local.x-start.x)));node.height=Math.max(1,Math.round(Math.abs(local.y-start.y)));}
  if(gesture.kind==='resize'){
    const original=gesture.initial,h=gesture.handle,local=new DOMPoint(event.clientX,event.clientY).matrixTransform(gesture.resizeMatrix),rx=local.x-gesture.localStart.x,ry=local.y-gesture.localStart.y;let w=original.width,ht=original.height;
    if(h.includes('e'))w+=rx;if(h.includes('s'))ht+=ry;if(h.includes('w'))w-=rx;if(h.includes('n'))ht-=ry;w=Math.max(1,w);ht=Math.max(1,ht);
    const oldAnchor=vectors.transformLocalPoint(original,{x:h.includes('w')?original.width:0,y:h.includes('n')?original.height:0}),newAnchor=vectors.transformLocalPoint({...original,width:w,height:ht},{x:h.includes('w')?w:0,y:h.includes('n')?ht:0});
    Object.assign(node,{x:original.x+oldAnchor.x-newAnchor.x,y:original.y+oldAnchor.y-newAnchor.y,width:Math.round(w),height:Math.round(ht)});
  }
  renderScene();renderInspector();
});
function endGesture(){
  if(!gesture)return;const finished=gesture;gesture=null;
  if(!['pan','marquee'].includes(finished.kind)){
    const node=findNode(state.document,finished.id)?.node;
    if(finished.kind==='draw'&&!finished.moved&&node)Object.assign(node,finished.initial);
    if(isReadOnly()){state.document=JSON.parse(finished.before);render();collaboration?.interactionEnded();return;}
    applyLayouts(state.document);if(finished.before!==JSON.stringify(state.document)){remember(finished.before);changed(finished.before,finished.kind);}
    if(finished.kind==='draw'){tool('select');if(node?.type==='text'){$('prop-text').focus();$('prop-text').select();}}
  }else render();collaboration?.interactionEnded();
}
stage.addEventListener('pointerup',endGesture);stage.addEventListener('pointercancel',()=>{if(gesture?.before)state.document=JSON.parse(gesture.before);gesture=null;render();collaboration?.interactionEnded();});
stage.addEventListener('dblclick',event=>{if(state.tool==='pen'){finishVector();tool('select');return;}const target=event.target.closest('[data-node-id]');if(target){select(target.dataset.nodeId);if(current()?.node.type==='text'){$('prop-text').focus();$('prop-text').select();}else if(['path','rectangle','ellipse','group'].includes(current()?.node.type))editVector();}});
function zoomTo(value,center){const rect=stage.getBoundingClientRect(),anchor=center||{x:rect.width/2,y:rect.height/2};const world={x:(anchor.x-state.pan.x)/state.zoom,y:(anchor.y-state.pan.y)/state.zoom};state.zoom=Math.max(.05,Math.min(8,value));state.pan={x:anchor.x-world.x*state.zoom,y:anchor.y-world.y*state.zoom};renderScene();}
function fit(){const rect=stage.getBoundingClientRect(),bounds=documentBounds(state.document);state.zoom=nodes().length?Math.max(.05,Math.min(2,(rect.width-100)/bounds.width,(rect.height-100)/bounds.height)):1;state.pan={x:(rect.width-bounds.width*state.zoom)/2-bounds.x*state.zoom,y:(rect.height-bounds.height*state.zoom)/2-bounds.y*state.zoom};renderScene();}
stage.addEventListener('wheel',event=>{event.preventDefault();if(event.ctrlKey||event.metaKey){const rect=stage.getBoundingClientRect();zoomTo(state.zoom*Math.exp(-event.deltaY*.008),{x:event.clientX-rect.left,y:event.clientY-rect.top});}else{state.pan.x-=event.deltaX;state.pan.y-=event.deltaY;renderScene();}},{passive:false});

for(const button of document.querySelectorAll('[data-tool]'))button.onclick=()=>tool(button.dataset.tool);
$('undo').onclick=undo;$('redo').onclick=redo;$('delete').onclick=erase;$('duplicate').onclick=duplicate;$('move-up').onclick=()=>moveLayer(1);$('move-down').onclick=()=>moveLayer(-1);
$('zoom-in').onclick=()=>zoomTo(state.zoom*1.2);$('zoom-out').onclick=()=>zoomTo(state.zoom/1.2);$('zoom-label').onclick=fit;$('fit').onclick=fit;
$('first-frame').onclick=()=>{commit(()=>{const node=createNode('frame',0,0);nodes().push(node);state.selected=node.id;state.selection=[node.id];});fit();};
$('save').onclick=()=>void saveDocument().then(()=>notice('画布已保存到项目 canvas.json。')).catch(error=>notice(error.message,true,true));
$('document-name').onchange=()=>commit(()=>{state.document.name=$('document-name').value.trim()||'本地设计画布';});
$('properties').onsubmit=event=>event.preventDefault();
for(const input of document.querySelectorAll('[data-prop]'))input.addEventListener('change',()=>{
  const entry=current();if(!entry)return;const key=input.dataset.prop,value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value)/(key==='opacity'?100:1):input.value;
  try{commit(()=>{const entries=key==='name'?[entry]:selected();for(const item of entries)item.node[key]=value;});}catch(error){notice(error.message,true);render();}
});
$('fill-picker').oninput=()=>{const entry=current();if(entry){$('prop-fill').value=$('fill-picker').value;}};
$('fill-picker').onchange=()=>{const entry=current();if(entry)commit(()=>{entry.node.fill=$('fill-picker').value;});};
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const closeMenu=()=>$('file-menu').removeAttribute('open');
$('export-schema').onclick=()=>{download('design.m0schema.json',JSON.stringify(documentToM0Schema(state.document),null,2),'application/json');closeMenu();};
$('export-svg').onclick=()=>{download('design.svg',documentToSVG(state.document),'image/svg+xml');closeMenu();};
$('export-document').onclick=()=>{download('canvas.json',JSON.stringify(state.document,null,2),'application/json');closeMenu();};
$('import').onclick=()=>{$('import-file').click();closeMenu();};
$('import-file').onchange=async()=>{
  const file=$('import-file').files[0];if(!file)return;
  try{
    if(file.size>3*1024*1024)throw new Error('请选择不超过 3 MB 的 JSON；保存后的画布需小于 2 MB。');
    const contents=await file.text(),result=/\.svg$/i.test(file.name)||contents.trim().startsWith('<svg')?vectors.importSVG(contents):importDesignJSON(JSON.parse(contents));
    if(nodes().length&&!confirm('导入将替换当前画布，可通过撤销恢复。继续导入？'))return;
    commit(()=>{state.document=result.document;state.selected=null;state.selection=[];});fit();notice(result.warnings.length?'已导入。\n'+result.warnings.join('\n'):'已导入设计，正在保存到本地。',false,result.warnings.length>0);
  }catch(error){notice(error.message,true,true);}finally{$('import-file').value='';}
};
$('reload').onclick=()=>{closeMenu();if(state.live.remote){location.reload();return;}if(state.dirty&&!confirm('重新载入会放弃此窗口未保存的更改。建议先导出画布 JSON。继续？'))return;void loadDocument();};
$('generate').onclick=async()=>{
  const button=$('generate');button.disabled=true;
  try{
    if(state.live.remote)throw new Error('代码生成需在主机窗口操作。');requireEditable();
    if(!nodes().length)throw new Error('请先创建画板或图层。');
    await saveDocument();if(state.dirty||state.conflict)throw new Error('请先解决画布保存问题。');
    const directory='generated/canvas-'+Date.now(),entry=current();
    const nodeId=entry?.node.type==='frame'?entry.node.id:undefined;
    const result=await request(endpoint('/generate'),{method:'POST',body:JSON.stringify({expectedRevision:state.revision,directory,...(nodeId?{nodeId}:{})})});
    resultFiles=result.files||[];if(!resultFiles.length)throw new Error('原生成器没有返回文件。');
    $('result-files').replaceChildren(...resultFiles.map((file,index)=>new Option(file.path,String(index))));
    $('result-code').value=resultFiles[0].content;
    $('result-status').textContent=`${result.engine||'recovered-original-krn'} · 已写入 ${directory}/ · ${nodeId?'选中的 Frame':'首个可见 Frame / 根图层'}`;
    $('result-dialog').showModal();
  }catch(error){notice(error.message,true,true);}finally{render();}
};
$('result-files').onchange=()=>{$('result-code').value=resultFiles[Number($('result-files').value)]?.content||'';};
$('download-result').onclick=()=>{const file=resultFiles[Number($('result-files').value)];if(file)download(file.path.split('/').pop(),file.content,'text/plain;charset=utf-8');};
$('close-result').onclick=()=>$('result-dialog').close();

$('edit-vector').onclick=editVector;$('finish-vector').onclick=()=>{finishVector();tool('select');};$('add-vector-point').onclick=addVectorPoint;$('delete-vector-point').onclick=removeVectorPoint;
$('path-closed').onchange=()=>{const point=state.vectorPoint||{ci:0};vectorAction(node=>{node.path=vectors.setPathClosed(node.path,point.ci,$('path-closed').checked);},'close-path');};
$('smooth-vector-point').onclick=()=>{const point=state.vectorPoint;if(!point)return;vectorAction(node=>{const contour=node.path.contours[point.ci],anchor=contour.points[point.pi];if(anchor.mode!=='corner'){anchor.mode='corner';anchor.in={x:0,y:0};anchor.out={x:0,y:0};return;}const previous=contour.points[(point.pi-1+contour.points.length)%contour.points.length],next=contour.points[(point.pi+1)%contour.points.length],dx=next.x-previous.x,dy=next.y-previous.y,length=Math.hypot(dx,dy)||1,size=Math.max(12,(Math.hypot(anchor.x-previous.x,anchor.y-previous.y)+Math.hypot(next.x-anchor.x,next.y-anchor.y))/6);anchor.mode='symmetric';anchor.out={x:dx/length*size,y:dy/length*size};anchor.in={x:-anchor.out.x,y:-anchor.out.y};},'smooth-anchor');};
for(const button of document.querySelectorAll('[data-boolean]'))button.onclick=()=>{try{commit(()=>{const id=vectors.booleanNodes(state.document,state.selection,button.dataset.boolean);state.selection=[id];state.selected=id;state.vectorEditing=null;state.vectorPoint=null;},'boolean-'+button.dataset.boolean);}catch(error){handleError(error);}};
$('flatten-vector').onclick=()=>{try{commit(()=>{const id=selected().length>1?vectors.booleanNodes(state.document,state.selection,'flatten'):vectors.convertNodeToPath(state.document,state.selected);state.selection=[id];state.selected=id;state.vectorEditing=id;state.vectorPoint={ci:0,pi:0};},'flatten-path');}catch(error){handleError(error);}};
$('flip-x').onclick=()=>{try{commit(()=>{for(const entry of selected())entry.node.flipX=!entry.node.flipX;},'flip-x');}catch(error){handleError(error);}};$('flip-y').onclick=()=>{try{commit(()=>{for(const entry of selected())entry.node.flipY=!entry.node.flipY;},'flip-y');}catch(error){handleError(error);}};
function gradientChange(event){try{commit(()=>{for(const entry of selected()){const existed=!!entry.node.gradient,angle=Number($('gradient-angle').value)*Math.PI/180,gradient=entry.node.gradient||{type:'linear',stops:[{offset:0,color:'#8fa8ff'},{offset:1,color:'#b8f1dd'}]};gradient.from={x:.5-Math.cos(angle)/2,y:.5-Math.sin(angle)/2};gradient.to={x:.5+Math.cos(angle)/2,y:.5+Math.sin(angle)/2};if(!existed||event?.target?.id==='gradient-from')gradient.stops[0].color=$('gradient-from').value;if(!existed||event?.target?.id==='gradient-to')gradient.stops.at(-1).color=$('gradient-to').value;entry.node.gradient=gradient;}},'linear-gradient');}catch(error){handleError(error);}}
$('fill-mode').onchange=()=>{if($('fill-mode').value==='solid'){try{commit(()=>{for(const entry of selected())entry.node.gradient=null;},'solid-fill');}catch(error){handleError(error);}}else gradientChange();};for(const id of ['gradient-from','gradient-to','gradient-angle'])$(id).onchange=gradientChange;

$('add-page').onclick=()=>{try{commit(()=>{if(state.document.pages.length>=30)throw new Error('最多 30 个页面。');const page=createPage('Page '+(state.document.pages.length+1));state.document.pages.push(page);state.document.activePageId=page.id;state.selection=[];state.selected=null;});fit();}catch(error){handleError(error);}};
function showAssets(value){state.assets=value;$('file-sidebar').hidden=value;$('assets-sidebar').hidden=!value;$('tab-assets').classList.toggle('active',value);$('tab-file').classList.toggle('active',!value);}
$('tab-file').onclick=()=>showAssets(false);$('tab-assets').onclick=()=>showAssets(true);
$('snap').onclick=()=>{state.snap=!state.snap;$('snap').classList.toggle('toggled',state.snap);};$('rulers').onclick=()=>{state.rulers=!state.rulers;$('rulers').classList.toggle('toggled',state.rulers);renderScene();};
for(const button of document.querySelectorAll('[data-align]'))button.onclick=()=>{try{commit(()=>alignNodes(state.document,state.selection,button.dataset.align));}catch(error){handleError(error);}};
function groupSelection(){try{commit(()=>{const id=groupNodes(state.document,state.selection);state.selection=[id];state.selected=id;});}catch(error){handleError(error);}}
function ungroupSelection(){try{commit(()=>{state.selection=ungroupNode(state.document,state.selected);state.selected=state.selection.at(-1);});}catch(error){handleError(error);}}
$('group').onclick=groupSelection;$('ungroup').onclick=ungroupSelection;
for(const input of document.querySelectorAll('[data-layout]'))input.onchange=()=>{const entry=current();if(entry)try{commit(()=>{entry.node.layout[input.dataset.layout]=input.type==='number'?Number(input.value):input.value;});}catch(error){handleError(error);}};
$('create-component').onclick=()=>{try{commit(()=>createComponent(state.document,state.selected));notice('已创建主组件。可在“资源”中插入实例，修改主组件后同步。');}catch(error){handleError(error);}};
$('insert-instance').onclick=()=>{try{commit(()=>{const id=insertInstance(state.document,current()?.node.componentId);state.selection=[id];state.selected=id;});fit();}catch(error){handleError(error);}};
$('sync-component').onclick=()=>{try{let count=0;commit(()=>{count=syncComponent(state.document,current()?.node.componentId);});notice('已同步 '+count+' 个实例。实例位置保留，其余属性跟随主组件。');}catch(error){handleError(error);}};
$('detach-instance').onclick=()=>{try{commit(()=>detachInstance(state.document,state.selected));}catch(error){handleError(error);}};
$('prototype-target').onchange=()=>{const entry=current();if(entry)commit(()=>{entry.node.prototype={targetId:$('prototype-target').value,trigger:'click'};});};
let replaceImageId=null;
$('import-image').onclick=()=>{replaceImageId=null;$('image-file').click();};$('replace-image').onclick=()=>{replaceImageId=state.selected;$('image-file').click();};
$('image-file').onchange=async()=>{const file=$('image-file').files[0];if(!file)return;try{if(file.size>512*1024)throw new Error('图片不能超过 512 KB。');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});validateImage(data);const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('无法解码图片。'));image.src=data;});commit(()=>{const old=replaceImageId&&findNode(state.document,replaceImageId)?.node;if(old){old.imageData=data;return;}const parent=parentForDrawing(),node=createNode('image',parent?24:0,parent?24:0);node.name=file.name;node.width=Math.min(360,image.naturalWidth);node.height=Math.max(1,Math.round(node.width*image.naturalHeight/image.naturalWidth));node.imageData=data;(parent?.node.children||nodes()).push(node);state.selection=[node.id];state.selected=node.id;});fit();}catch(error){handleError(error);}finally{$('image-file').value='';replaceImageId=null;}};
async function openCloud(kind){try{if(state.live.remote)throw new Error('版本和原型演示需在主机窗口操作。');if(kind!=='preview')requireEditable();if(!state.revision&&!state.dirty){state.dirty=true;state.version++;}await saveDocument();const params=new URLSearchParams();if(projectId||state.boundProjectId)params.set('projectId',projectId||state.boundProjectId);else if(state.workspaceKey)params.set('workspaceKey',state.workspaceKey);params.set('pageId',state.document.activePageId);if(state.selected)params.set('nodeId',state.selected);if(kind==='preview'&&current()?.node.type==='frame')params.set('startId',state.selected);$('cloud-title').textContent=kind==='preview'?'Prototype · 本地演示':'版本与协作';$('cloud-frame').title=$('cloud-title').textContent;$('cloud-frame').src=(kind==='preview'?'/__local/design-preview':'/__local/design-cloud')+'?'+params;$('cloud-dialog').showModal();}catch(error){handleError(error);}}
$('collaborate').onclick=()=>void openCloud('collaborate');$('present').onclick=()=>void openCloud('preview');$('close-cloud').onclick=()=>$('cloud-dialog').close();
addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==$('cloud-frame').contentWindow||!['m0-design-document-updated','m0-local-canvas-changed'].includes(event.data?.type)||String(event.data.projectId||'')!==String(projectId||state.boundProjectId||''))return;if(state.dirty||saveFlight)notice('协作面板已更新文件；此页有未保存更改，请先导出备份再重新载入。',true,true);else void loadDocument();});

document.addEventListener('keydown',event=>{
  const input=event.target.closest('input,textarea,select,[contenteditable]');if(input||$('result-dialog').open||$('cloud-dialog').open)return;
  const command=event.metaKey||event.ctrlKey,key=event.key.toLowerCase();
  if(isReadOnly()&&((command&&['d','g','z','y'].includes(key))||['enter','delete','backspace'].includes(key)||key.startsWith('arrow')||(!command&&['f','r','o','t','p'].includes(key)))){event.preventDefault();notice('当前为只读协作；可以选择图层、缩放、平移或导出。');return;}
  if(command&&key==='s'){event.preventDefault();void saveDocument().catch(()=>{});return;}
  if(command&&key==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
  if(command&&key==='y'){event.preventDefault();redo();return;}
  if(command&&key==='d'){event.preventDefault();duplicate();return;}
  if(command&&key==='g'){event.preventDefault();event.shiftKey?ungroupSelection():groupSelection();return;}
  if(command&&key==='a'){event.preventDefault();state.selection=nodes().filter(node=>!node.hidden&&!node.locked).map(node=>node.id);state.selected=state.selection.at(-1);render();collaboration?.presence({selectedIds:[...state.selection],pageId:state.document.activePageId});return;}
  if(key==='enter'){event.preventDefault();if(state.vectorEditing){finishVector();tool('select');}else editVector();return;}
  if(event.code==='Space'){state.space=true;event.preventDefault();}
  if(key==='escape'){
    if(gesture?.before)state.document=JSON.parse(gesture.before);gesture=null;finishVector();tool('select');select(null);collaboration?.interactionEnded();return;
  }
  if(['delete','backspace'].includes(key)){event.preventDefault();if(state.vectorEditing&&state.vectorPoint)removeVectorPoint();else erase();return;}
  if(!command&&{v:'select',h:'hand',f:'frame',r:'rectangle',o:'ellipse',t:'text',p:'pen'}[key])tool({v:'select',h:'hand',f:'frame',r:'rectangle',o:'ellipse',t:'text',p:'pen'}[key]);
  if(isReadOnly())return;
  if(key.startsWith('arrow')){const entry=current();if(entry&&!entry.node.locked){event.preventDefault();const step=event.shiftKey?10:1;commit(()=>{if(key==='arrowleft')entry.node.x-=step;if(key==='arrowright')entry.node.x+=step;if(key==='arrowup')entry.node.y-=step;if(key==='arrowdown')entry.node.y+=step;});}}
});
document.addEventListener('keyup',event=>{if(event.code==='Space')state.space=false;});
addEventListener('blur',()=>state.space=false);
addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
new ResizeObserver(()=>renderScene()).observe($('stage-wrap'));
// Keep remote operations queued while a user is typing or dragging, then let the
// controller apply them at an interaction boundary rather than moving controls.
document.addEventListener('input',event=>{if(event.target.closest('#properties input,#properties textarea,#properties select,#pages input,#document-name'))inputDraft=event.target;});
document.addEventListener('change',event=>{if(event.target===inputDraft){inputDraft=null;queueMicrotask(()=>collaboration?.interactionEnded());}});
document.addEventListener('focusout',event=>{if(event.target===inputDraft){inputDraft=null;queueMicrotask(()=>collaboration?.interactionEnded());}});
function applyRemote({document:remoteDocument,revision,dirty=false,source,scope,projectId:remoteProjectId,workspaceKey:remoteWorkspaceKey}){
  const activePage=state.document.activePageId,selectionIds=[...state.selection];
  const next=applyLayouts(validateDocument(remoteDocument));
  if(next.pages.some(page=>page.id===activePage))next.activePageId=activePage;
  state.document=next;state.revision=revision??null;state.dirty=!!dirty;state.conflict=false;state.loading=false;
  const resolvedProject=scope?.projectId??remoteProjectId;if(resolvedProject!==undefined&&resolvedProject!==null)projectId=String(resolvedProject);
  if(scope?.workspaceKey||remoteWorkspaceKey)state.workspaceKey=scope?.workspaceKey||remoteWorkspaceKey;
  state.selection=selectionIds.filter(id=>findNode(next,id));state.selected=state.selection.at(-1)||null;
  if(state.vectorEditing&&!findNode(next,state.vectorEditing)){state.vectorEditing=null;state.vectorPoint=null;state.penNode=null;}
  clearTimeout(saveTimer);render();setSaveStatus(state.dirty?'正在同步…':source==='remote'?'已同步协作更改':'已同步');
}
collaboration=createCanvasCollaboration({
  mount:$('realtime-collaboration'),overlay:$('peers-overlay'),
  getDocument:()=>copy(state.document),getScope:()=>({projectId:projectId||state.boundProjectId||'',workspaceKey:state.workspaceKey||''}),
  getSelection:()=>[...state.selection],getViewport:()=>({zoom:state.zoom,pan:{...state.pan}}),isInteracting,
  applyRemote,onStatus:status=>{const before=JSON.stringify(state.live);if(state.live.active!==!!status.active){state.history=[];state.future=[];clearTimeout(saveTimer);}state.live={...state.live,...status};if(status.active){state.dirty=!!status.pending;clearTimeout(saveTimer);setSaveStatus(status.connected===false?'协作已断开 · 只读':status.pending?'正在同步…':status.readOnly?'协作 · 只读':'实时协作已同步',status.connected===false);}if(before!==JSON.stringify(state.live))render();},
  save:saveDocument,notify:notice
});
tool('select');void(async()=>{try{const snapshot=await collaboration.bootstrap();if(snapshot){applyRemote(snapshot);fit();}else await loadDocument();}catch(error){state.loading=false;setSaveStatus('协作载入失败',true);notice(error.message,true,true);render();}})();

// Explicit diagnostics contain authored design data only; useful for local UI tests.
window.m0LocalCanvas=Object.freeze({getDocument:()=>copy(state.document),getStatus:()=>({projectId,loading:state.loading,revision:state.revision,dirty:state.dirty,selectedId:state.selected,selectedIds:[...state.selection],activePageId:state.document.activePageId,zoom:state.zoom,vectorEditing:state.vectorEditing,vectorPoint:copy(state.vectorPoint),live:copy(state.live),collaboration:collaboration?.getStatus?.()||null}),exportSchema:()=>documentToM0Schema(state.document),save:saveDocument});
