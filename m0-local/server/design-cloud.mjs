import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {validateDocument,documentToSVG} from '../canvas/model.mjs';
import {designCloudPage} from './design-cloud-page.mjs';
import {renderPrototype,PROTOTYPE_CSP} from './design-prototype.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/;
const TOKEN=/^[a-f\d]{48}$/;
const KEY=/^[a-f\d]{64}$/;
const MAX_RECORD=3*1024*1024;
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const sha=value=>createHash('sha256').update(value).digest('hex');
const sharePath=token=>'/__local/design-share/'+token;
function text(value,fallback,max=120){
  if(value===undefined)return fallback;
  if(typeof value!=='string'||value.includes('\0')||value.length>max)throw fail('文本内容无效或超过长度限制');
  return value.trim()||fallback;
}
function requireRevision(body,current){
  if(!Object.hasOwn(body,'expectedRevision'))throw fail('操作需要 expectedRevision，请先重新载入当前画布');
  if(body.expectedRevision!==current.revision)throw fail('画布已改变，请重新载入后再操作',409);
}
function pages(document){return document?.pages||[{id:'page-1',name:document?.name||'画布',nodes:document?.nodes||[]}];}
function nodeList(document){
  const result=[];
  function walk(nodes,pageId,depth=0){if(depth>50)return;for(const node of nodes||[]){result.push({id:node.id,name:node.name||node.type,type:node.type,pageId});walk(node.children,pageId,depth+1);}}
  if(document)for(const page of pages(document))walk(page.nodes,page.id);
  return result;
}
function staticHTML(document,{title=document.name,label='本地只读设计快照'}={}){
  const sections=pages(document).map((page,index)=>{
    // The normalized schema renderer escapes document strings. A CSP inside
    // the exported file also blocks scripts, local APIs and remote resources.
    const svg=documentToSVG(document,{pageId:page.id});
    return `<section id="page-${index+1}"><h2>${escape(page.name)}</h2><div class="canvas">${svg}</div></section>`;
  }).join('');
  const links=pages(document).map((page,index)=>`<a href="#page-${index+1}">${escape(page.name)}</a>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f9;color:#273043;font:14px -apple-system,BlinkMacSystemFont,sans-serif}header{padding:24px 5vw;background:white;border-bottom:1px solid #e2e5ed}h1{font-size:24px;margin:0 0 8px}header p{color:#687389;margin:0}nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}a{color:#6850b6}main{padding:24px 5vw}section{margin-bottom:32px;scroll-margin-top:20px}h2{font-size:16px}.canvas{overflow:auto;background:white;border:1px solid #e2e5ed;border-radius:10px;padding:20px}.canvas>svg{display:block;max-width:100%;height:auto}</style><header><h1>${escape(title)}</h1><p>${escape(label)} · 可离线查看 · 无编辑权限</p><nav>${links}</nav></header><main>${sections}</main></html>`;
}

/** Local project snapshots and review data. No original account, cloud token,
 * remote service or background synchronization is used by this module. */
export function createDesignCloud({dataDir,resolveWorkspace,readCanvas,saveCanvas}){
  if(!dataDir||!resolveWorkspace||!readCanvas||!saveCanvas)throw Error('Design library requires data directory and canvas methods');
  const locks=new Map();let rootPromise;
  async function directory(parent,name){
    const full=path.join(parent,name);
    try{await fs.mkdir(full,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const stat=await fs.lstat(full);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('本地设计数据目录不允许符号链接',403);
    return full;
  }
  async function storage(){
    if(!rootPromise)rootPromise=(async()=>{await fs.mkdir(dataDir,{recursive:true,mode:0o700});const base=await fs.realpath(dataDir);const root=await directory(base,'design-cloud');await directory(root,'projects');await directory(root,'shares');return root;})().catch(error=>{rootPromise=undefined;throw error;});
    const root=await rootPromise;
    if((await fs.lstat(root)).isSymbolicLink())throw fail('本地设计数据目录不允许符号链接',403);
    return root;
  }
  async function projectDirectory(key){
    if(!KEY.test(key))throw fail('设计项目标识无效');
    const root=await storage(),parent=await directory(root,'projects');
    return directory(parent,key);
  }
  async function readJSON(file,optional=false){
    let handle;
    try{
      handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_RECORD)throw fail('设计记录无效或过大',413);
      return JSON.parse(await handle.readFile('utf8'));
    }catch(error){if(optional&&error.code==='ENOENT')return null;if(error.code==='ELOOP')throw fail('设计记录不允许符号链接',403);throw error;}
    finally{await handle?.close();}
  }
  async function writeJSON(file,value){
    const content=JSON.stringify(value);
    if(Buffer.byteLength(content)>MAX_RECORD)throw fail('设计记录超过 3 MB 上限',413);
    try{const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw fail('设计记录不允许符号链接或目录',403);}catch(error){if(error.code!=='ENOENT')throw error;}
    const temporary=file+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,content,{mode:0o600,flag:'wx'});await fs.rename(temporary,file);}
    finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  async function load(project){
    const state=await readJSON(path.join(project.directory,'state.json'),true)||{format:'m0-local-design-library-v1',projectKey:project.key,versions:[],comments:[],templates:[],shares:[]};
    if(state.format!=='m0-local-design-library-v1'||state.projectKey!==project.key||!['versions','comments','templates','shares'].every(key=>Array.isArray(state[key])))throw fail('本地设计索引格式无效');
    return state;
  }
  const save=(project,state)=>writeJSON(path.join(project.directory,'state.json'),state);
  async function context(projectId){
    if(projectId!==null&&projectId!==undefined&&(typeof projectId!=='string'&&typeof projectId!=='number'||String(projectId).length>128))throw fail('项目标识无效');
    const target=await resolveWorkspace(projectId),workspace=await fs.realpath(target.workspace);
    if(!(await fs.stat(workspace)).isDirectory())throw fail('项目工作区不存在',404);
    const key=sha(String(target.projectId??'workspace')+'\0'+workspace);
    return {...target,workspace,key,directory:await projectDirectory(key)};
  }
  async function locked(projectId,action){
    const project=await context(projectId),previous=locks.get(project.key)||Promise.resolve();
    const pending=previous.catch(()=>{}).then(()=>action(project));locks.set(project.key,pending);
    try{return await pending;}finally{if(locks.get(project.key)===pending)locks.delete(project.key);}
  }
  async function canvas(project){
    const value=await readCanvas(project);
    return {...value,document:value.document?validateDocument(value.document):null};
  }
  async function immutable(project,type,record){const dir=await directory(project.directory,type);await writeJSON(path.join(dir,record.id+'.json'),record);}
  async function record(project,state,type,id){
    if(!UUID.test(id||''))throw fail('设计记录 ID 无效');
    if(!state[type].some(item=>item.id===id))throw fail('设计记录不存在',404);
    const dir=await directory(project.directory,type),value=await readJSON(path.join(dir,id+'.json'));
    return {...value,document:validateDocument(value.document)};
  }
  function publicState(project,state,current){
    const nodes=nodeList(current.document),ids=new Set(nodes.map(node=>node.id));
    return {localOnly:true,projectId:project.projectId,workspace:project.workspace,revision:current.revision,documentName:current.document?.name||'',pages:current.document?pages(current.document).map(({id,name})=>({id,name})):[],nodes,
      versions:[...state.versions].reverse(),templates:[...state.templates].reverse(),comments:state.comments.map(comment=>({...comment,orphaned:Boolean(comment.nodeId&&!ids.has(comment.nodeId))})),shares:[...state.shares].reverse().map(share=>({...share,url:sharePath(share.token)}))};
  }
  const methods={
    state:projectId=>locked(projectId,async project=>publicState(project,await load(project),await canvas(project))),
    createVersion:(projectId,body={})=>locked(projectId,async project=>{
      const state=await load(project),current=await canvas(project);requireRevision(body,current);
      if(!current.document)throw fail('请先保存画布');if(state.versions.length>=100)throw fail('每个项目最多保存 100 个版本');
      const item={id:randomUUID(),label:text(body.label,'版本 '+(state.versions.length+1)),createdAt:now(),revision:current.revision};
      await immutable(project,'versions',{...item,document:current.document});state.versions.push(item);await save(project,state);return item;
    }),
    getVersion:(projectId,id)=>locked(projectId,async project=>record(project,await load(project),'versions',id)),
    restoreVersion:(projectId,id,body={})=>locked(projectId,async project=>{
      const state=await load(project),snapshot=await record(project,state,'versions',id),current=await canvas(project);requireRevision(body,current);
      if(current.document&&state.versions.length>=100)throw fail('恢复前需要自动保存当前画布，但版本数已达到 100 上限');
      // Save a recovery point before applying. The shared canvas save performs
      // its own revision comparison under the same lock as normal canvas PUTs.
      if(current.document){const backup={id:randomUUID(),label:'恢复前自动备份',createdAt:now(),revision:current.revision};await immutable(project,'versions',{...backup,document:current.document});state.versions.push(backup);await save(project,state);}
      const result=await saveCanvas(project,{document:snapshot.document,expectedRevision:body.expectedRevision});
      return {...result,restoredVersionId:id};
    }),
    addComment:(projectId,body={})=>locked(projectId,async project=>{
      const state=await load(project),current=await canvas(project);if(!current.document)throw fail('请先保存画布');if(state.comments.length>=500)throw fail('每个项目最多保存 500 条评论');
      const nodeId=text(body.nodeId,'',200),node=nodeId&&nodeList(current.document).find(item=>item.id===nodeId);
      if(nodeId&&!node)throw fail('评论节点已不存在，请重新载入画布',409);
      const content=text(body.text,'',4000);if(!content)throw fail('请输入评论内容');
      const item={id:randomUUID(),nodeId,nodeName:node?.name||'整份设计',pageId:node?.pageId||null,text:content,author:text(body.author,'本地用户',80),resolved:false,version:1,createdAt:now(),updatedAt:now()};
      state.comments.push(item);await save(project,state);return item;
    }),
    updateComment:(projectId,id,body={})=>locked(projectId,async project=>{
      const state=await load(project),comment=state.comments.find(item=>item.id===id);if(!UUID.test(id||'')||!comment)throw fail('评论不存在',404);
      if(body.expectedVersion!==comment.version)throw fail('评论已被修改，请重新载入后再操作',409);
      if(typeof body.resolved!=='boolean')throw fail('评论状态应为布尔值');
      comment.resolved=body.resolved;comment.version++;comment.updatedAt=now();await save(project,state);return comment;
    }),
    createTemplate:(projectId,body={})=>locked(projectId,async project=>{
      const state=await load(project),current=await canvas(project);requireRevision(body,current);
      if(!current.document)throw fail('请先保存画布');if(state.templates.length>=30)throw fail('每个项目最多保存 30 个模板');
      const item={id:randomUUID(),label:text(body.label,current.document.name||'本地模板'),createdAt:now(),revision:current.revision};
      await immutable(project,'templates',{...item,document:current.document});state.templates.push(item);await save(project,state);return item;
    }),
    applyTemplate:(projectId,id,body={})=>locked(projectId,async project=>{
      const state=await load(project),template=await record(project,state,'templates',id),current=await canvas(project);requireRevision(body,current);
      // Applying replaces the canvas only after an automatic recovery version.
      if(current.document){if(state.versions.length>=100)throw fail('应用前备份所需版本数已达上限');const item={id:randomUUID(),label:'应用模板前自动备份',createdAt:now(),revision:current.revision};await immutable(project,'versions',{...item,document:current.document});state.versions.push(item);await save(project,state);}
      return {...await saveCanvas(project,{document:template.document,expectedRevision:body.expectedRevision}),appliedTemplateId:id};
    }),
    createShare:(projectId,body={})=>locked(projectId,async project=>{
      const state=await load(project),current=await canvas(project);requireRevision(body,current);
      if(!current.document)throw fail('请先保存画布');if(state.shares.filter(item=>!item.revoked).length>=50)throw fail('每个项目最多保留 50 个有效只读分享');
      const item={token:randomBytes(24).toString('hex'),label:text(body.label,current.document.name||'只读设计'),createdAt:now(),revision:current.revision,revoked:false};
      const root=await storage(),dir=await directory(root,'shares'),file=path.join(dir,item.token+'.json');
      await writeJSON(file,{format:'m0-local-design-share-v1',projectKey:project.key,...item,document:current.document});
      try{state.shares.push(item);await save(project,state);}catch(error){await fs.unlink(file).catch(()=>{});throw error;}
      return {...item,url:sharePath(item.token)};
    }),
    revokeShare:(projectId,token)=>locked(projectId,async project=>{
      const state=await load(project),share=state.shares.find(item=>item.token===token);if(!TOKEN.test(token||'')||!share)throw fail('分享不存在',404);
      share.revoked=true;share.revokedAt=now();await save(project,state);
      const dir=await directory(await storage(),'shares');await fs.unlink(path.join(dir,token+'.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});return {success:true};
    }),
    async getShare(token){
      if(!TOKEN.test(token||''))throw fail('只读分享不存在',404);
      const dir=await directory(await storage(),'shares'),share=await readJSON(path.join(dir,token+'.json'),true);if(!share||share.format!=='m0-local-design-share-v1'||!KEY.test(share.projectKey||''))throw fail('只读分享不存在',404);
      const state=await load({key:share.projectKey,directory:await projectDirectory(share.projectKey)});
      if(!state.shares.some(item=>item.token===token&&!item.revoked))throw fail('只读分享已撤销',404);
      return {...share,document:validateDocument(share.document)};
    },
    exportHTML:(projectId,{prototype=false,startId}={})=>locked(projectId,async project=>{const current=await canvas(project);if(!current.document)throw fail('请先保存画布');return prototype?renderPrototype(current.document,{startId}):staticHTML(current.document);}),
  };
  async function handle(req,res,url,body={}){
    const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));return true;};
    const html=(content,{download=false,readonly=false,prototype=false}={})=>{
      const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
      if(download)headers['content-disposition']='attachment; filename="m0-local-design.html"';
      if(readonly)headers['content-security-policy']=prototype?PROTOTYPE_CSP:"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
      res.writeHead(200,headers);res.end(content);return true;
    };
    if(url.pathname==='/__local/design-cloud')return req.method==='GET'?html(designCloudPage()):send({error:'Method not allowed'},405);
    if(url.pathname==='/__local/design-cloud-client.js'){
      if(req.method!=='GET')return send({error:'Method not allowed'},405);
      res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(await fs.readFile(new URL('./design-cloud-client.js',import.meta.url),'utf8'));return true;
    }
    if(url.pathname.startsWith('/__local/design-share/')){
      if(req.method!=='GET')return send({error:'只读分享不提供编辑接口'},405);
      const token=url.pathname.slice('/__local/design-share/'.length),share=await methods.getShare(token);
      const prototype=url.searchParams.get('mode')==='prototype';
      return html(prototype?renderPrototype(share.document,{title:share.label,startId:url.searchParams.get('startId')}):staticHTML(share.document,{title:share.label,label:'本机只读分享 · 创建于 '+share.createdAt}),{readonly:true,prototype,download:url.searchParams.get('download')==='1'});
    }
    const prefix='/__local/design-cloud/api/';if(!url.pathname.startsWith(prefix))return false;
    const parts=url.pathname.slice(prefix.length).split('/'),projectId=url.searchParams.get('projectId');
    const [kind,id,action]=parts;
    if(kind==='state'&&parts.length===1&&req.method==='GET')return send(await methods.state(projectId));
    if(kind==='versions'){
      if(parts.length===1&&req.method==='GET')return send((await methods.state(projectId)).versions);
      if(parts.length===1&&req.method==='POST')return send(await methods.createVersion(projectId,body),201);
      if(parts.length===2&&req.method==='GET'){const version=await methods.getVersion(projectId,id);return url.searchParams.get('format')==='html'?html(staticHTML(version.document,{title:version.label}),{readonly:true}):send(version);}
      if(parts.length===3&&action==='restore'&&req.method==='POST')return send(await methods.restoreVersion(projectId,id,body));
    }
    if(kind==='comments'){
      if(parts.length===1&&req.method==='GET')return send((await methods.state(projectId)).comments);
      if(parts.length===1&&req.method==='POST')return send(await methods.addComment(projectId,body),201);
      if(parts.length===2&&req.method==='PATCH')return send(await methods.updateComment(projectId,id,body));
    }
    if(kind==='templates'){
      if(parts.length===1&&req.method==='GET')return send((await methods.state(projectId)).templates);
      if(parts.length===1&&req.method==='POST')return send(await methods.createTemplate(projectId,body),201);
      if(parts.length===3&&action==='apply'&&req.method==='POST')return send(await methods.applyTemplate(projectId,id,body));
    }
    if(kind==='shares'){
      if(parts.length===1&&req.method==='GET')return send((await methods.state(projectId)).shares);
      if(parts.length===1&&req.method==='POST')return send(await methods.createShare(projectId,body),201);
      if(parts.length===2&&req.method==='DELETE')return send(await methods.revokeShare(projectId,id));
    }
    if(['export','preview'].includes(kind)&&parts.length===1&&req.method==='GET'){const prototype=url.searchParams.get('mode')==='prototype';return html(await methods.exportHTML(projectId,{prototype,startId:url.searchParams.get('startId')}),{download:kind==='export',readonly:true,prototype});}
    return send({error:'设计库接口或方法不可用'},405);
  }
  return {handle,...methods};
}
