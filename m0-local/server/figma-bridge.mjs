import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

const fail=(message,status=400,extra={})=>Object.assign(new Error(message),{status,...extra});
const PREFIX='/__local/figma/bridge/';
const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const binding=(value,field)=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_:]{1,256}$/.test(value))throw fail(field+' 无效');return value;};
const string=(value,field,max=500)=>{if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw fail(field+' 无效');return value;};
const number=(value,name,min,max)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw fail(name+' 数值超出范围');return value;};
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const sourceDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../figma-plugin-bridge');
const writeTypes=new Set(['create-frame','create-text','patch-nodes']);
const readTypes=new Set(['read-context','get-node','select-node','export-node','export-schema']);
const safeEqual=(left,right)=>typeof left==='string'&&left.length===right.length&&timingSafeEqual(Buffer.from(left),Buffer.from(right));

function color(value){if(!isObject(value))throw fail('颜色无效');return {r:number(value.r,'r',0,1),g:number(value.g,'g',0,1),b:number(value.b,'b',0,1),a:value.a===undefined?1:number(value.a,'a',0,1)};}
function axis(value){if(value===undefined)return undefined;if(!isObject(value)||!['absolute','delta'].includes(value.mode))throw fail('尺寸/位置需 absolute 或 delta');return {mode:value.mode,value:number(value.value,'尺寸/位置',-1e7,1e7)};}
function patch(value){
  if(!isObject(value))throw fail('修改参数无效');
  switch(value.kind){
    case 'replace-text':if(typeof value.value!=='string'||value.value.length>20000)throw fail('文本过长或无效');return {kind:value.kind,value:value.value};
    case 'set-fill-color':return {kind:value.kind,color:color(value.color)};
    case 'set-opacity':return {kind:value.kind,value:number(value.value,'透明度',0,1)};
    case 'resize':case 'move':{const names=value.kind==='resize'?['width','height']:['x','y'],out={kind:value.kind};for(const name of names)if(value[name]!==undefined)out[name]=axis(value[name]);if(Object.keys(out).length===1)throw fail('没有尺寸/位置修改');return out;}
    case 'scale':return {kind:value.kind,factor:number(value.factor,'缩放',.05,20)};
    case 'set-visible':if(typeof value.value!=='boolean')throw fail('显隐需布尔值');return {kind:value.kind,value:value.value};
    case 'rename':return {kind:value.kind,value:string(value.value,'名称')};
    case 'set-font-size':case 'set-line-height':return {kind:value.kind,value:number(value.value,'文字尺寸',1,10000)};
    case 'set-corner-radius':return {kind:value.kind,value:number(value.value,'圆角',0,10000)};
    case 'set-image-mode':if(!['FIT','FILL'].includes(value.value))throw fail('图片模式无效');return {kind:value.kind,value:value.value};
    case 'set-image-filter':if(!['exposure','contrast','saturation','temperature'].includes(value.filter))throw fail('图片滤镜无效');return {kind:value.kind,filter:value.filter,value:number(value.value,'图片滤镜',-1,1)};
    case 'set-layout-spacing':if(!['itemSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft'].includes(value.property))throw fail('布局属性无效');return {kind:value.kind,property:value.property,value:number(value.value,'布局间距',0,10000)};
    default:throw fail('不支持的修改类型');
  }
}

/** Paired loopback transport. Only a Figma Plugin API execution receipt can
 * complete a command; accepting an HTTP command never represents a write. */
export function createFigmaBridge({dataDir,port=4317,resolveProject,commandTimeoutMs=45000,selectionTTL=15000,leaseMs=8000}={}){
  if(!dataDir)throw Error('Figma bridge requires dataDir');
  const pluginDirectory=path.resolve(dataDir,'figma-plugin'),storeDir=path.resolve(dataDir,'figma-bridge');
  const codes=new Map(),sessions=new Map(),commands=new Map(),waiters=new Map(),attempts=new Map();
  let storePromise,storeQueue=Promise.resolve(),pluginPreparation,closed=false;
  async function directory(full){await fs.mkdir(full,{recursive:true,mode:0o700});const stat=await fs.lstat(full);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('桥接目录不允许符号链接',403);return full;}
  async function regular(file){try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw fail('桥接文件不允许符号链接',403);}catch(error){if(error.code!=='ENOENT')throw error;}}
  async function storage(){
    if(!storePromise)storePromise=(async()=>{await directory(storeDir);const file=path.join(storeDir,'pairings.json');let state={format:'m0-local-figma-pairings-v1',pairings:[]},handle;try{handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size>512*1024)throw fail('配对记录过大');state=JSON.parse(await handle.readFile('utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}finally{await handle?.close();}if(state.format!=='m0-local-figma-pairings-v1'||!Array.isArray(state.pairings))throw fail('配对记录格式无效');return {file,state};})().catch(error=>{storePromise=undefined;throw error;});return storePromise;
  }
  async function update(action){const pending=storeQueue.catch(()=>{}).then(async()=>{const store=await storage(),state=clone(store.state),value=await action(state);if(bytes(state)>512*1024)throw fail('配对记录容量已满');await directory(storeDir);await regular(store.file);const temporary=store.file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify(state),{mode:0o600,flag:'wx'});await fs.rename(temporary,store.file);store.state=state;}finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}return value;});storeQueue=pending;return pending;}
  async function scope(projectId){
    if(projectId===undefined||projectId===null||projectId===''){if(resolveProject)throw fail('请明确选择本地项目');projectId='default';}
    if(!['string','number'].includes(typeof projectId)||String(projectId).length>128)throw fail('项目标识无效');
    const project=resolveProject?await resolveProject(projectId):{id:projectId};if(!project)throw fail('本地项目不存在',404);
    const id=String(project.id??project.projectId??projectId),directory=project.workspace||project.projectPath||'';
    const workspace=directory?await fs.realpath(directory):'';if(workspace&&!(await fs.stat(workspace)).isDirectory())throw fail('项目工作区不是目录',409);
    return {projectId:id,projectKey:sha(id+'\0'+workspace),projectName:project.projectName||project.name||id};
  }
  async function preparePlugin(){
    if(pluginPreparation)return pluginPreparation;
    pluginPreparation=(async()=>{
      await directory(pluginDirectory);
      for(const name of ['code.js','ui.html','manifest.json','SOURCES.json','README.md']){
        let text=await fs.readFile(path.join(sourceDir,name),'utf8');
        if(name==='ui.html')text=text.replaceAll('http://127.0.0.1:4317',`http://127.0.0.1:${port}`);
        const file=path.join(pluginDirectory,name);await regular(file);let handle,existing;
        try{handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);existing=await handle.readFile('utf8');}catch(error){if(error.code!=='ENOENT')throw error;}finally{await handle?.close();}
        if(name==='manifest.json'){
          const manifest=JSON.parse(text);
          if(existing!==undefined){
            let current;try{current=JSON.parse(existing);}catch{throw fail('生成的 Figma manifest.json 不是有效 JSON，请修复后重试',409);}
            // The template marker is not a Figma-assigned publication ID.
            // Preserve only the user's actual string ID, never invent one or
            // overwrite it during polling, upgrades or a local port change.
            if(typeof current.id==='string'&&/^[0-9]{1,128}$/.test(current.id))manifest.id=current.id;
          }
          manifest.networkAccess.allowedDomains=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];text=JSON.stringify(manifest,null,2)+'\n';
        }
        // Figma watches development files. Polling metadata must not trigger
        // hot reloads or replace an otherwise unchanged plugin entry point.
        if(existing===text)continue;
        const temporary=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,text,{mode:0o600,flag:'wx'});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      }
      return {pluginDirectory,manifestPath:path.join(pluginDirectory,'manifest.json')};
    })().finally(()=>pluginPreparation=undefined);return pluginPreparation;
  }
  function sessionKey(fileKey,sessionId){return fileKey+'\0'+sessionId;}
  async function authenticate(body,token){
    binding(body.fileKey,'fileKey');binding(body.sessionId,'sessionId');if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw fail('插件配对凭据无效',401);
    const store=await storage(),pairing=store.state.pairings.find(value=>!value.revoked&&safeEqual(value.tokenHash,sha(token)));
    if(!pairing||pairing.fileKey!==body.fileKey||pairing.sessionId!==body.sessionId)throw fail('插件文件/会话未配对或已撤销',403);
    const current=await scope(pairing.projectId);if(current.projectKey!==pairing.projectKey)throw fail('本地项目目录已改变，请重新配对',409);return pairing;
  }
  function complete(record,status,result){
    if(record.status!=='pending'){if(result)record.lateResult=clone(result);return;}
    record.status=status;record.completedAt=Date.now();if(result)record.result=clone(result);clearTimeout(record.timer);
    const waiter=waiters.get(record.id);if(waiter){waiters.delete(record.id);waiter.cleanup();if(status==='completed')waiter.resolve({id:record.id,ok:result.ok,result:clone(result)});else waiter.reject(fail(status==='cancelled'?'Figma 任务已取消':'Figma 插件执行超时，未确认成功',status==='cancelled'?499:504,{commandId:record.id}));}
  }
  async function findSession(input){
    const project=await scope(input.projectId);binding(input.fileKey,'fileKey');
    const candidates=[...sessions.values()].filter(value=>value.projectKey===project.projectKey&&value.fileKey===input.fileKey&&(!input.sessionId||value.sessionId===input.sessionId)).sort((a,b)=>b.seen-a.seen);
    if(!input.sessionId&&candidates.filter(value=>Date.now()-value.seen<selectionTTL).length>1)throw fail('同一文件有多个插件，请明确选择 sessionId',409);
    const session=candidates[0];if(!session||Date.now()-session.seen>=selectionTTL)throw fail('目标文件的 Figma 插件未在线；请打开同一文件并配对',409);
    const store=await storage();if(!store.state.pairings.some(pairing=>pairing.id===session.pairingId&&!pairing.revoked))throw fail('配对已撤销',403);return {project,session};
  }
  async function getContext(input={}){
    const {project,session}=await findSession(input),selection=clone(session.selection);
    return {projectId:project.projectId,fileKey:session.fileKey,sessionId:session.sessionId,selectionRevision:selection.revision,nodes:selection.nodes,documentName:selection.documentName,pageId:selection.pageId,pageName:selection.pageName,online:true,selection};
  }
  async function enqueue(input={}){
    if(closed)throw fail('Figma 桥接已关闭',503);if(input.signal?.aborted)throw input.signal.reason||fail('Figma 任务已取消',499);
    const {project,session}=await findSession(input),type=input.type;if(!readTypes.has(type)&&!writeTypes.has(type))throw fail('不支持的桥接命令');
    const command={id:randomUUID(),type,fileKey:session.fileKey,sessionId:session.sessionId};
    if(writeTypes.has(type)){
      if(!Number.isSafeInteger(input.selectionRevision)||input.selectionRevision!==session.selection.revision)throw fail('选区版本已改变，请刷新上下文后重试',409);
      command.selectionRevision=input.selectionRevision;
    }
    if(['get-node','select-node','export-node','export-schema'].includes(type)){command.nodeId=binding(input.nodeId,'nodeId');if(input.expectedType)command.expectedType=binding(input.expectedType,'expectedType');}
    if(type==='export-node'){if(!['PNG','SVG','JSON_REST_V1'].includes(input.format))throw fail('导出格式无效');command.format=input.format;}
    if(type==='patch-nodes'){
      if(!Array.isArray(input.targets)||!input.targets.length||input.targets.length>100)throw fail('必须明确提供 1–100 个目标图层');
      command.lock=input.lock==='nodes'?'nodes':'selection';command.executionMode=input.executionMode==='best-effort'?'best-effort':'atomic';
      const selected=new Map(session.selection.nodes.map(node=>[node.id,node])),ids=new Set();
      command.targets=input.targets.map(target=>{if(!isObject(target))throw fail('目标无效');const nodeId=binding(target.nodeId,'nodeId'),expectedType=binding(target.expectedType,'expectedType');if(ids.has(nodeId))throw fail('目标重复');ids.add(nodeId);if(command.lock==='selection'&&(!selected.has(nodeId)||selected.get(nodeId).type!==expectedType))throw fail('目标不在已锁定选区或类型已变化',409);if(!Array.isArray(target.patches)||!target.patches.length||target.patches.length>20)throw fail('修改项数量无效');return {nodeId,expectedType,patches:target.patches.map(patch)};});
    }
    if(type==='create-frame'||type==='create-text'){
      command.name=input.name===undefined?'M0 '+(type==='create-frame'?'Frame':'Text'):string(input.name,'名称');
      command.x=input.x===undefined?0:number(input.x,'x',-1e7,1e7);command.y=input.y===undefined?0:number(input.y,'y',-1e7,1e7);
      if(input.parentId)command.parentId=binding(input.parentId,'parentId');
      if(input.fills!==undefined){if(!Array.isArray(input.fills)||input.fills.length>10)throw fail('填充无效');command.fills=input.fills.map(color);}
      if(type==='create-frame'){command.width=input.width===undefined?360:number(input.width,'width',1,100000);command.height=input.height===undefined?240:number(input.height,'height',1,100000);}
      else {if(typeof input.characters!=='string'||input.characters.length>20000)throw fail('文字无效或过长');command.characters=input.characters;command.fontSize=input.fontSize===undefined?16:number(input.fontSize,'fontSize',1,1000);}
    }
    if([...commands.values()].filter(value=>value.status==='pending'&&value.projectKey===project.projectKey).length>=100)throw fail('Figma 待执行队列已满',429);
    if(closed)throw fail('Figma 桥接已关闭',503);if(input.signal?.aborted)throw fail('Figma 任务已取消',499);
    const record={id:command.id,projectId:project.projectId,projectKey:project.projectKey,pairingId:session.pairingId,command,status:'pending',createdAt:Date.now(),leasedUntil:0};
    record.timer=setTimeout(()=>complete(record,'timeout'),commandTimeoutMs);record.timer.unref();commands.set(record.id,record);
    // Expired results contain no credentials and are bounded in memory.
    while(commands.size>500){const oldest=[...commands.values()].find(value=>value.status!=='pending');if(!oldest)break;commands.delete(oldest.id);}
    return record;
  }
  async function execute(input={}){
    const record=await enqueue(input);return new Promise((resolve,reject)=>{
      const abort=()=>complete(record,'cancelled');const cleanup=()=>input.signal?.removeEventListener('abort',abort);
      waiters.set(record.id,{resolve,reject,cleanup});input.signal?.addEventListener('abort',abort,{once:true});if(input.signal?.aborted)abort();
    });
  }
  async function pair(body,owner){
    if(owner){
      if(body.action==='create'){
        const project=await scope(body.projectId);const code=randomBytes(6).toString('hex').toUpperCase(),expiresAt=Date.now()+300000;
        for(const [key,value]of codes)if(value.expiresAt<Date.now())codes.delete(key);if(codes.size>=50)throw fail('待使用配对码过多',429);
        codes.set(sha(code),{...project,expiresAt});return {code,expiresAt,...await preparePlugin()};
      }
      if(body.action==='revoke'){
        const project=await scope(body.projectId);await update(state=>{const value=state.pairings.find(item=>item.id===body.pairingId&&item.projectKey===project.projectKey);if(!value)throw fail('配对不存在',404);value.revoked=true;});
        for(const [key,value]of sessions)if(value.pairingId===body.pairingId)sessions.delete(key);for(const value of commands.values())if(value.pairingId===body.pairingId)complete(value,'cancelled');return {ok:true};
      }
      throw fail('配对管理 action 无效');
    }
    binding(body.fileKey,'fileKey');binding(body.sessionId,'sessionId');
    if(body.token){
      const store=await storage(),old=store.state.pairings.find(value=>!value.revoked&&safeEqual(value.tokenHash,sha(body.token)));
      if(!old||old.fileKey!==body.fileKey)throw fail('保存的配对凭据无效',403);
      const project=await scope(old.projectId);if(project.projectKey!==old.projectKey)throw fail('项目工作区已改变，请重新配对',409);
      await update(state=>{const value=state.pairings.find(item=>item.id===old.id);if(value.revoked)throw fail('配对已撤销',403);value.sessionId=body.sessionId;});
      for(const [key,value]of sessions)if(value.pairingId===old.id)sessions.delete(key);for(const value of commands.values())if(value.pairingId===old.id&&value.command.sessionId!==body.sessionId)complete(value,'cancelled');
      return {token:body.token,pairingId:old.id,projectId:old.projectId,fileKey:body.fileKey,sessionId:body.sessionId};
    }
    const key=sha(String(body.code||'').replace(/[-\s]/g,'').toUpperCase()),code=codes.get(key);if(!code||code.expiresAt<Date.now())throw fail('配对码无效、已使用或已过期',403);
    codes.delete(key);const token=randomBytes(32).toString('hex'),item={id:randomUUID(),tokenHash:sha(token),fileKey:body.fileKey,sessionId:body.sessionId,projectId:code.projectId,projectKey:code.projectKey,createdAt:Date.now(),revoked:false};
    await update(state=>{if(state.pairings.length>=200)throw fail('配对记录已满，请先撤销旧配对',429);state.pairings.push(item);});
    return {token,pairingId:item.id,projectId:item.projectId,fileKey:item.fileKey,sessionId:item.sessionId};
  }
  async function publish(body,token){
    const pairing=await authenticate(body,token),snapshot=body.snapshot;if(!isObject(snapshot)||snapshot.fileKey!==pairing.fileKey||snapshot.sessionId!==pairing.sessionId||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||!Array.isArray(snapshot.nodes)||snapshot.nodes.length>100||bytes(snapshot)>256*1024)throw fail('插件选区快照无效');
    const ids=new Set();for(const node of snapshot.nodes){binding(node.id,'node.id');binding(node.type,'node.type');if(ids.has(node.id))throw fail('选区节点重复');ids.add(node.id);}
    const key=sessionKey(pairing.fileKey,pairing.sessionId),previous=sessions.get(key);if(previous&&previous.pairingId!==pairing.id)throw fail('该插件会话已绑定其他项目',409);if(previous&&snapshot.revision<previous.selection.revision)throw fail('选区版本已过期',409);
    sessions.set(key,{pairingId:pairing.id,projectId:pairing.projectId,projectKey:pairing.projectKey,fileKey:pairing.fileKey,sessionId:pairing.sessionId,selection:clone(snapshot),seen:Date.now()});return {ok:true};
  }
  async function pull(body,token){const pairing=await authenticate(body,token);const session=sessions.get(sessionKey(pairing.fileKey,pairing.sessionId));if(!session||session.pairingId!==pairing.id)throw fail('请先上报当前选区',409);session.seen=Date.now();const batch=[...commands.values()].filter(value=>value.status==='pending'&&value.pairingId===pairing.id&&value.command.fileKey===body.fileKey&&value.command.sessionId===body.sessionId&&value.leasedUntil<=Date.now()).slice(0,10);for(const value of batch)value.leasedUntil=Date.now()+leaseMs;return {commands:batch.map(value=>clone(value.command))};}
  async function ack(body,token){
    const pairing=await authenticate(body,token);if(!Array.isArray(body.results)||body.results.length>10||bytes(body)>4.5*1024*1024)throw fail('执行回执无效或过大');const accepted=[];
    // Validate the complete batch before completing any waiters.
    for(const result of body.results){const record=commands.get(result?.id);if(!record||record.pairingId!==pairing.id||record.command.fileKey!==body.fileKey||record.command.sessionId!==body.sessionId)throw fail('回执不属于该配对/文件/会话',403);if(result.fileKey!==body.fileKey||result.sessionId!==body.sessionId||typeof result.ok!=='boolean')throw fail('回执文件/会话不匹配',403);if(!Array.isArray(result.changedNodeIds)||result.changedNodeIds.length>100)throw fail('回执变更列表无效');if(record.command.type==='patch-nodes'){const ids=new Set(record.command.targets.map(target=>target.nodeId));if(result.changedNodeIds.some(id=>!ids.has(id))||result.nodeResults?.some(value=>!ids.has(value.nodeId)))throw fail('回执包含目标之外的图层',403);}}
    for(const result of body.results){const record=commands.get(result.id);complete(record,'completed',result);accepted.push(result.id);}return {ok:true,accepted};
  }
  async function status(input={}){
    const project=await scope(input.projectId),store=await storage();return {localOnly:true,paired:store.state.pairings.some(value=>value.projectKey===project.projectKey&&!value.revoked),pluginDirectory,manifestPath:path.join(pluginDirectory,'manifest.json'),sessions:[...sessions.values()].filter(value=>value.projectKey===project.projectKey&&(!input.fileKey||input.fileKey===value.fileKey)).map(value=>({projectId:value.projectId,pairingId:value.pairingId,fileKey:value.fileKey,sessionId:value.sessionId,documentName:value.selection.documentName,online:Date.now()-value.seen<selectionTTL,selection:clone(value.selection)})),pairings:store.state.pairings.filter(value=>value.projectKey===project.projectKey).map(({id,fileKey,createdAt,revoked})=>({id,fileKey,createdAt,revoked}))};
  }
  async function result(input,id){const project=await scope(input.projectId),record=commands.get(id);if(!record||record.projectKey!==project.projectKey)throw fail('Figma 任务不存在',404);if(input.fileKey!==record.command.fileKey||input.sessionId!==record.command.sessionId)throw fail('任务文件/会话不匹配',403);return {id:record.id,commandId:record.id,pending:record.status==='pending',status:record.status,...(record.result?{result:clone(record.result)}:{}),...(record.lateResult?{lateResult:clone(record.lateResult)}:{})};}
  function security(req){
    const remote=req.socket?.remoteAddress;if(remote&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))throw fail('Figma 桥接仅允许本机连接',403);
    const host=req.headers.host||'',hostname=host.replace(/:\d+$/,'');if(!['127.0.0.1','localhost','[::1]'].includes(hostname))throw fail('桥接 Host 无效',403);
    const origin=req.headers.origin;if(origin&&origin!=='null'&&origin!=='http://'+host)throw fail('桥接来源无效',403);return origin!=='null';
  }
  async function readBody(req){let chunks=[],length=0;for await(const chunk of req){length+=chunk.length;if(length>5*1024*1024)throw fail('请求过大',413);chunks.push(chunk);}return length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}
  async function handle(req,res,url,body){
    if(!url.pathname.startsWith(PREFIX))return false;
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});res.end(JSON.stringify(value));return true;};
    try{
      const owner=security(req),route=url.pathname.slice(PREFIX.length),pluginRoute=['pair','selection','pull','ack'].includes(route);
      if(!owner&&!pluginRoute)throw fail('插件来源不能调用本机管理接口',403);
      if(!owner){res.setHeader('Access-Control-Allow-Origin','null');res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
      body=body??(['POST','PUT','DELETE'].includes(req.method)?await readBody(req):{});if(!isObject(body))throw fail('请求必须是 JSON 对象');
      const input={...Object.fromEntries(url.searchParams),...body},token=req.headers.authorization?.replace(/^Bearer /,'');
      if(route==='pair'&&req.method==='POST'){
        const create=owner&&['create','revoke'].includes(body.action);if(!create){const key=req.socket?.remoteAddress||'local',value=attempts.get(key)||{count:0,until:Date.now()+60000};if(Date.now()>value.until){value.count=0;value.until=Date.now()+60000;}if(++value.count>20)throw fail('配对尝试过多，请一分钟后重试',429);attempts.set(key,value);}return send(await pair(body,create));
      }
      if(route==='metadata'&&req.method==='GET'&&owner)return send(await preparePlugin());
      if(route==='status'&&req.method==='GET'&&owner)return send(await status(input));
      if(route==='selection'&&req.method==='POST'){if(!token)throw fail('选区上报需要配对凭据',401);return send(await publish(input,token));}
      if(route==='pull'&&req.method==='GET')return send(await pull(input,token));
      if(route==='ack'&&req.method==='POST')return send(await ack(input,token));
      if(route==='context'&&req.method==='GET'&&owner)return send(await getContext(input));
      if(route==='selection'&&req.method==='GET'&&owner){const context=await getContext(input);return send({...context,selection:context.selection});}
      if(route==='commands'&&req.method==='POST'&&owner){const record=await enqueue(input);return send({id:record.id,commandId:record.id,status:'pending',pending:true},202);}
      if(route.startsWith('results/')&&req.method==='GET'&&owner)return send(await result(input,route.slice(8)));
      throw fail('桥接接口或方法不存在',404);
    }catch(error){return send({error:error.message,...(error.commandId?{commandId:error.commandId}:{})},error.status||400);}
  }
  function close(){closed=true;for(const record of commands.values())complete(record,'cancelled');codes.clear();sessions.clear();}
  return {handle,close,preparePlugin,pluginDirectory,getContext,execute};
}
