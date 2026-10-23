import {validateDocument} from './model.mjs';

// A compare-and-set operation model, deliberately not a CRDT. Stable entity IDs
// let unrelated fields merge; stale writes to the same field and incompatible
// tree edits are rejected as an atomic batch.
const NODE_FIELDS=new Set(['type','name','x','y','width','height','fill','stroke','strokeWidth','radius','opacity','text','fontSize','fontFamily','fontWeight','textAlign','lineHeight','letterSpacing','imageData','imageFit','layout','componentId','componentRole','prototype','hidden','locked','children','path','rotation','flipX','flipY','gradient']);
const FIELDS={document:new Set(['name','pages','components']),page:new Set(['name','nodes']),component:new Set(['name','mainNodeId']),node:NODE_FIELDS};
const NESTED={layout:new Set(['mode','gap','padding','align','justify']),prototype:new Set(['targetId','trigger'])};
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
const equal=(left,right)=>left===right||canonical(left)===canonical(right);
function flatten(input){
  const document=validateDocument(input),maps={document:new Map(),page:new Map(),node:new Map(),component:new Map()};
  function walk(node){const record=clone({...node,children:node.children.map(child=>child.id)});maps.node.set(node.id,record);node.children.forEach(walk);}
  for(const page of document.pages){maps.page.set(page.id,{id:page.id,name:page.name,nodes:page.nodes.map(node=>node.id)});page.nodes.forEach(walk);}
  for(const component of document.components)maps.component.set(component.id,{...component});
  maps.document.set('document',{id:'document',name:document.name,pages:document.pages.map(page=>page.id),components:document.components.map(component=>component.id)});
  return {document,maps};
}
function pathAllowed(entity,path){
  if(!Array.isArray(path)||!path.length||path.length>2||path.some(key=>typeof key!=='string'||key==='__proto__'||key==='constructor'))return false;
  if(!FIELDS[entity]?.has(path[0]))return false;
  return path.length===1||(entity==='node'&&NESTED[path[0]]?.has(path[1]));
}
function get(record,path){let value=record;for(const key of path)value=value?.[key];return value;}
function put(record,path,value){let target=record;for(const key of path.slice(0,-1))target=target[key];if(value===undefined)delete target[path.at(-1)];else target[path.at(-1)]=clone(value);}
const beforeOf=op=>op.beforeExists===false?undefined:op.before;
const afterOf=op=>op.afterExists===false?undefined:op.after;
function sequencePath(entity,path){return path.length===1&&(entity==='document'&&['pages','components'].includes(path[0])||entity==='page'&&path[0]==='nodes'||entity==='node'&&path[0]==='children');}
function mergeSequence(before,after,current){
  if(![before,after,current].every(value=>Array.isArray(value)&&value.every(id=>typeof id==='string')&&new Set(value).size===value.length))return null;
  const old=new Set(before),next=new Set(after),removed=new Set(before.filter(id=>!next.has(id))),added=new Set(after.filter(id=>!old.has(id)));
  const retained=before.filter(id=>next.has(id));
  // Reorders are intentional structural edits; they keep strict CAS semantics.
  if(!equal(retained,after.filter(id=>old.has(id))))return null;
  const seen=current.filter(id=>old.has(id)&&next.has(id));
  if(!equal(seen,retained.filter(id=>current.includes(id))))return null;
  for(const id of added)if(current.includes(id)){
    const peers=new Set(after.filter(item=>current.includes(item)));
    if(!equal(current.filter(item=>peers.has(item)),after.filter(item=>peers.has(item))))return null;
  }
  const result=current.filter(id=>!removed.has(id));
  // Insert before the nearest surviving right anchor. Concurrent inserts are
  // retained in server arrival order; remote deletions are never resurrected.
  for(let i=after.length-1;i>=0;i--){const id=after[i];if(!added.has(id)||result.includes(id))continue;const anchor=after.slice(i+1).find(item=>result.includes(item));result.splice(anchor===undefined?result.length:result.indexOf(anchor),0,id);}
  return result;
}
function reconstruct(maps,activePageId){
  const root=maps.document.get('document'),used=new Set();let count=0;
  if(!root||!Array.isArray(root.pages)||!Array.isArray(root.components)||root.pages.length!==maps.page.size||root.components.length!==maps.component.size||new Set(root.pages).size!==root.pages.length||new Set(root.components).size!==root.components.length)throw Error('文档页面或组件结构不完整');
  function node(id,depth=0){
    if(depth>50||++count>3000)throw Error('画布图层超过上限');
    if(typeof id!=='string'||used.has(id))throw Error('图层重复引用或结构存在循环');
    const value=maps.node.get(id);if(!value||value.id!==id||!Array.isArray(value.children))throw Error('图层或子图层引用不存在');
    used.add(id);return {...value,children:value.children.map(child=>node(child,depth+1))};
  }
  const pages=root.pages.map(id=>{const page=maps.page.get(id);if(!page||page.id!==id||!Array.isArray(page.nodes))throw Error('页面引用不存在');return {...page,nodes:page.nodes.map(id=>node(id))};});
  if(used.size!==maps.node.size)throw Error('有图层未归属任何页面或父图层');
  const components=root.components.map(id=>{const component=maps.component.get(id);if(!component||component.id!==id)throw Error('组件引用不存在');return component;});
  return validateDocument({format:'m0-local-canvas-v1',version:2,name:root.name,activePageId,pages,components});
}

export function diffDocuments(before,after){
  const previous=flatten(before),next=flatten(after),ops=[];
  function fields(entity,id,left,right,path=[]){
    if(equal(left,right))return;
    if(object(left)&&object(right)&&(!path.length||entity==='node'&&path.length===1&&NESTED[path[0]])){
      for(const key of new Set([...Object.keys(left),...Object.keys(right)])){if(!path.length&&key==='id')continue;fields(entity,id,left[key],right[key],[...path,key]);}
    }else ops.push({type:'set',entity,id,path,before:left===undefined?null:left,after:right===undefined?null:right,...(left===undefined?{beforeExists:false}:{}),...(right===undefined?{afterExists:false}:{})});
  }
  for(const entity of ['node','page','component','document']){
    const left=previous.maps[entity],right=next.maps[entity];
    for(const [id,record] of left)if(!right.has(id))ops.push({type:'remove',entity,id,before:record,after:null});
    for(const [id,record] of right){if(!left.has(id))ops.push({type:'put',entity,id,before:null,after:record});else fields(entity,id,left.get(id),record);}
  }
  // activePageId is per-window view state. Presence carries page selection;
  // changing pages must never force another participant onto the same page.
  return ops;
}

export function applyOperations(input,ops){
  const {document,maps}=flatten(input),conflicts=[],seen=new Map(),resolved=new Map();
  if(!Array.isArray(ops)||ops.length>10000)throw Error('协作操作应为不超过 10000 项的数组');
  function conflict(op,reason){if(conflicts.length<64)conflicts.push({entity:op?.entity||'',id:op?.id||'',path:Array.isArray(op?.path)?op.path:[],reason});}
  for(const op of ops){
    if(!op||!Object.hasOwn(FIELDS,op.entity)||typeof op.id!=='string'||!op.id||op.id.length>200||!['set','put','remove'].includes(op.type)){conflict(op,'invalid-operation');continue;}
    if(op.entity==='document'&&(op.id!=='document'||op.type!=='set')){conflict(op,'invalid-document-operation');continue;}
    if(op.type==='set'&&(!pathAllowed(op.entity,op.path)||!Object.hasOwn(op,'before')||!Object.hasOwn(op,'after'))){conflict(op,'invalid-field');continue;}
    const key=op.entity+'\0'+op.id,prior=seen.get(key)||[];
    if(prior.some(previous=>previous.type!=='set'||op.type!=='set'||previous.path[0]===op.path?.[0]&&(previous.path.length===1||op.path?.length===1||previous.path[1]===op.path[1]))){conflict(op,'overlapping-operation');continue;}
    prior.push(op);seen.set(key,prior);
    const current=maps[op.entity].get(op.id);
    if(op.type==='set'){
      if(!current){conflict(op,'entity-deleted');continue;}
      const value=get(current,op.path);
      if(!equal(value,beforeOf(op))&&!equal(value,afterOf(op))){
        const merged=sequencePath(op.entity,op.path)?mergeSequence(beforeOf(op),afterOf(op),value):null;
        if(merged===null)conflict(op,'field-changed');else resolved.set(op,merged);
      }
    }else if(op.type==='put'){
      if(op.before!==null||!object(op.after)||op.after.id!==op.id){conflict(op,'invalid-insert');continue;}
      if(current&&!equal(current,op.after))conflict(op,'entity-already-exists');
    }else{
      if(!object(op.before)||op.before.id!==op.id||op.after!==null){conflict(op,'invalid-remove');continue;}
      if(current&&!equal(current,op.before))conflict(op,'entity-changed-before-delete');
    }
  }
  if(conflicts.length)return {document,conflicts,applied:0};
  let applied=0;
  for(const op of ops){
    const entities=maps[op.entity],current=entities.get(op.id);
    if(op.type==='set'){const after=resolved.has(op)?resolved.get(op):afterOf(op);if(!equal(get(current,op.path),after)){put(current,op.path,after);applied++;}}
    else if(op.type==='put'){if(!current){entities.set(op.id,clone(op.after));applied++;}}
    else if(current){entities.delete(op.id);applied++;}
  }
  try{return {document:reconstruct(maps,document.activePageId),conflicts:[],applied};}
  catch(error){return {document,conflicts:[{entity:'document',id:'document',path:[],reason:'invalid-structure',message:error.message}],applied:0};}
}
