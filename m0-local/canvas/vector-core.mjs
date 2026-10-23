// Canvas path coordinates use their own width/height. Handles are offsets from
// an anchor; resizing a node scales geometry without rewriting its source.
const clone = value => JSON.parse(JSON.stringify(value));
const finite = (value, fallback=0) => Number.isFinite(Number(value)) ? Math.max(-100000,Math.min(100000,Number(value))) : fallback;
const point = value => ({x:finite(value?.x),y:finite(value?.y)});
const zero = () => ({x:0,y:0});
const fmt = value => String(Math.round(value*1e6)/1e6);
const mix = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const add = (a,b) => ({x:a.x+b.x,y:a.y+b.y});
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
function context(input){const path=input?.path||input;return{path,sx:input?.path?input.width/path.width:1,sy:input?.path?input.height/path.height:1};}
export function validatePath(value,{width=160,height=100}={}) {
  if(!value||!Array.isArray(value.contours)||value.contours.length>200)throw new Error('矢量路径轮廓无效或超过 200 个。');
  let count=0;
  return{width:Math.max(.001,finite(value.width,width)),height:Math.max(.001,finite(value.height,height)),fillRule:value.fillRule==='evenodd'?'evenodd':'nonzero',contours:value.contours.map(contour=>{
    if(!contour||!Array.isArray(contour.points)||(count+=contour.points.length)>5000)throw new Error('单个矢量最多 5000 个锚点。');
    return{closed:Boolean(contour.closed),points:contour.points.map(p=>{if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||['in','out'].some(k=>p[k]&&(!Number.isFinite(p[k].x)||!Number.isFinite(p[k].y))))throw new Error('矢量锚点和控制柄必须是有限数字。');return{...point(p),in:point(p.in),out:point(p.out),mode:['smooth','symmetric'].includes(p.mode)?p.mode:'corner'};})};})};
}
export function pathToSVGData(input){
  const {path,sx,sy}=context(input);if(!path)return'';
  const p=v=>`${fmt(v.x*sx)} ${fmt(v.y*sy)}`,result=[];
  for(const contour of path.contours){const pts=contour.points;if(!pts.length)continue;result.push(`M${p(pts[0])}`);for(let i=1;i<pts.length;i++)segment(pts[i-1],pts[i]);if(contour.closed){if(pts.length>1&&(pts.at(-1).out?.x||pts.at(-1).out?.y||pts[0].in?.x||pts[0].in?.y))segment(pts.at(-1),pts[0]);result.push('Z');}}
  function segment(a,b){if(a.out?.x||a.out?.y||b.in?.x||b.in?.y)result.push(`C${p(add(a,a.out||zero()))} ${p(add(b,b.in||zero()))} ${p(b)}`);else result.push(`L${p(b)}`);}
  return result.join(' ');
}
export function getPathAnchors(input){const {path,sx,sy}=context(input);return(path?.contours||[]).flatMap((c,ci)=>c.points.map((p,pi)=>({contourIndex:ci,pointIndex:pi,x:p.x*sx,y:p.y*sy,in:{x:(p.x+(p.in?.x||0))*sx,y:(p.y+(p.in?.y||0))*sy},out:{x:(p.x+(p.out?.x||0))*sx,y:(p.y+(p.out?.y||0))*sy},mode:p.mode||'corner'})));}
export function movePathAnchor(input,ci,pi,value){const{path,sx,sy}=context(input),next=clone(path),p=next.contours[ci]?.points[pi];if(!p)throw new Error('锚点不存在。');p.x=finite(value.x/sx);p.y=finite(value.y/sy);return next;}
export function movePathHandle(input,ci,pi,handle,value,{mirror=false}={}){if(!['in','out'].includes(handle))throw new Error('控制柄无效。');const{path,sx,sy}=context(input),next=clone(path),p=next.contours[ci]?.points[pi];if(!p)throw new Error('锚点不存在。');p[handle]={x:finite(value.x/sx-p.x),y:finite(value.y/sy-p.y)};if(mirror||p.mode==='symmetric'){p[handle==='in'?'out':'in']={x:-p[handle].x,y:-p[handle].y};p.mode='symmetric';}else if(p.mode==='smooth'){const opposite=handle==='in'?'out':'in',length=Math.hypot(p[opposite].x,p[opposite].y),own=Math.hypot(p[handle].x,p[handle].y);if(own)p[opposite]={x:-p[handle].x*length/own,y:-p[handle].y*length/own};}return next;}
export function setPathClosed(input,ci,closed){const next=clone(input.path||input);if(!next.contours[ci])throw new Error('轮廓不存在。');next.contours[ci].closed=Boolean(closed);return next;}
export function appendPathPoint(input,value,ci=0){const{path,sx,sy}=context(input),next=clone(path);if(!next.contours[ci])next.contours[ci]={closed:false,points:[]};if(next.contours.reduce((n,c)=>n+c.points.length,0)>=5000)throw new Error('单个矢量最多 5000 个锚点。');next.contours[ci].points.push({x:finite(value.x/sx),y:finite(value.y/sy),in:zero(),out:zero(),mode:'corner'});return next;}
export function removePathPoint(input,ci,pi){const next=clone(input.path||input);next.contours[ci]?.points.splice(pi,1);return next;}
export function insertPathPoint(input,ci,segmentIndex,t=.5){
  const next=clone(input.path||input),contour=next.contours[ci],pts=contour?.points;if(!pts||pts.length<2||segmentIndex<0||segmentIndex>=pts.length-(contour.closed?0:1))throw new Error('请选择有效线段。');
  t=Math.max(.001,Math.min(.999,finite(t,.5)));const a=pts[segmentIndex],b=pts[(segmentIndex+1)%pts.length],p0=point(a),p1=add(a,a.out||zero()),p2=add(b,b.in||zero()),p3=point(b);
  const q0=mix(p0,p1,t),q1=mix(p1,p2,t),q2=mix(p2,p3,t),r0=mix(q0,q1,t),r1=mix(q1,q2,t),s=mix(r0,r1,t);a.out=sub(q0,p0);b.in=sub(q2,p3);pts.splice(segmentIndex+1,0,{...s,in:sub(r0,s),out:sub(r1,s),mode:'smooth'});return next;
}
export function nodeTransformSVG(node){const x=node.width/2,y=node.height/2,r=finite(node.rotation);return r||node.flipX||node.flipY?`translate(${fmt(x)} ${fmt(y)}) rotate(${fmt(r)}) scale(${node.flipX?-1:1} ${node.flipY?-1:1}) translate(${fmt(-x)} ${fmt(-y)})`:'';}
export function transformLocalPoint(node,p){const x=node.width/2,y=node.height/2,r=(node.rotation||0)*Math.PI/180,dx=(p.x-x)*(node.flipX?-1:1),dy=(p.y-y)*(node.flipY?-1:1);return{x:x+dx*Math.cos(r)-dy*Math.sin(r),y:y+dx*Math.sin(r)+dy*Math.cos(r)};}
export function validateGradient(value){if(!value)return null;if(value.type!=='linear'||!Array.isArray(value.stops)||value.stops.length<2||value.stops.length>32)throw new Error('线性渐变需要 2–32 个色标。');return{type:'linear',from:point(value.from||{x:0,y:0}),to:point(value.to||{x:1,y:1}),stops:value.stops.map(s=>{if(typeof s.color!=='string'||!/^#[\da-f]{3,8}$/i.test(s.color)&&!/^(?:rgba?|hsla?)\([\d\s.,%+-]+\)$/.test(s.color))throw new Error('渐变颜色无效。');return{offset:Math.max(0,Math.min(1,finite(s.offset))),color:s.color};}).sort((a,b)=>a.offset-b.offset)};}
