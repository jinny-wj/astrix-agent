import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {emptyDocument,validateDocument,walkDocument} from '../canvas/model.mjs';
import {diffDocuments,applyOperations} from '../canvas/collab-model.mjs';

const fail=(message,status=400,extra={})=>Object.assign(new Error(message),{status,...extra});
const hash=value=>createHash('sha256').update(value).digest('hex');
const colors=['#8263d6','#3098a2','#cf6a68','#b68c33','#4c82c4','#bb5da0'];
const TOKEN=/^[a-f0-9]{48}$/;
const INVITE=/^[A-Za-z0-9_-]{24}$/;
const uid=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,100}$/.test(value);
const named=(value,fallback='本地用户')=>{if(value===undefined||value==='')return fallback;if(typeof value!=='string'||value.includes('\0')||value.length>60)throw fail('名称应为 60 字以内的文本');return value.trim()||fallback;};
const recordBytes=value=>Buffer.byteLength(JSON.stringify(value));
const initialStatic=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/local-canvas');

/** Serialized compare-and-set collaboration over the local canvas service.
 * Canvas files are durable; sessions/event history are ephemeral. Invitations
 * persist as token hashes and can be revoked without exposing local APIs. */
export function createCanvasCollaboration({dataDir,resolveWorkspace,readCanvas,transactCanvas,subscribeCanvas,staticDir=initialStatic,pollMs=500,sessionTTL=120000}={}){
  if(!dataDir||!resolveWorkspace||!readCanvas||!transactCanvas)throw Error('Collaboration requires canvas transaction methods');
  const rooms=new Map(),sessions=new Map();let storePromise,gateway,gatewayInfo={enabled:false,urls:[]},closed=false,gatewayQueue=Promise.resolve();
  const rootPath=path.resolve(dataDir,'canvas-collaboration');
  async function storage(){
    if(!storePromise)storePromise=(async()=>{
      await fs.mkdir(dataDir,{recursive:true,mode:0o700});
      try{await fs.mkdir(rootPath,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
      const stat=await fs.lstat(rootPath);if(stat.isSymbolicLink()||!stat.isDirectory())throw fail('协作数据目录不允许符号链接',403);
      const file=path.join(rootPath,'invites.json');let state={format:'m0-local-collaboration-v1',invites:[]},handle;
      try{handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size>4*1024*1024)throw fail('协作邀请记录过大或无效');state=JSON.parse(await handle.readFile('utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}finally{await handle?.close();}
      if(state.format!=='m0-local-collaboration-v1'||!Array.isArray(state.invites))throw fail('协作邀请记录格式无效');
      return {file,state};
    })().catch(error=>{storePromise=undefined;throw error;});
    return storePromise;
  }
  let storeQueue=Promise.resolve();
  async function updateStore(action){
    const pending=storeQueue.catch(()=>{}).then(async()=>{
      const store=await storage(),next=structuredClone(store.state),result=await action(next);
      if(recordBytes(next)>4*1024*1024)throw fail('协作邀请记录已达容量上限',413);
      if((await fs.lstat(rootPath)).isSymbolicLink())throw fail('协作数据目录不允许符号链接',403);
      try{const stat=await fs.lstat(store.file);if(stat.isSymbolicLink()||!stat.isFile())throw fail('邀请文件不允许符号链接',403);}catch(error){if(error.code!=='ENOENT')throw error;}
      const temporary=store.file+'.'+randomUUID()+'.tmp';
      try{await fs.writeFile(temporary,JSON.stringify(next),{mode:0o600,flag:'wx'});await fs.rename(temporary,store.file);store.state=next;return result;}
      finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    });storeQueue=pending;return pending;
  }
  function participants(room){return [...room.clients].map(token=>sessions.get(token)).filter(client=>client&&!client.revoked&&Date.now()-client.seen<sessionTTL).map(client=>({clientId:client.clientId,name:client.name,role:client.role,color:client.color,online:client.streams.size>0,pageId:client.pageId||null,cursor:client.cursor||null,pointer:client.cursor||null,selection:client.selection||[],selectedIds:client.selection||[]}));}
  function send(res,event){
    if(res.destroyed||res.writableEnded)return false;
    if(res.writableLength>4*1024*1024){res.destroy();return false;}
    res.write('id: '+event.seq+'\ndata: '+JSON.stringify(event)+'\n\n');return true;
  }
  const personalize=(client,event)=>event.type==='snapshot'?{...event,acknowledgedMutationIds:[...client.receipts.keys()]}:event;
  function emit(room,event){
    const value={...event,roomId:room.id,epoch:room.epoch,seq:++room.seq,time:new Date().toISOString()};
    const size=recordBytes(value);room.history.push(value);room.historyBytes+=size;
    while(room.history.length>256||room.historyBytes>8*1024*1024){room.historyBytes-=recordBytes(room.history.shift());}
    for(const token of room.clients){const client=sessions.get(token);if(client&&!client.revoked)for(const res of client.streams)send(res,personalize(client,value));}
    return value;
  }
  function snapshot(room,reset=false,client){return {type:'snapshot',roomId:room.id,epoch:room.epoch,seq:room.seq,document:room.current.document,revision:room.current.revision,workspaceKey:room.workspaceKey,projectId:room.context.projectId,participants:participants(room),reset,...(client?{acknowledgedMutationIds:[...client.receipts.keys()]}:{})};}
  function changed(room,current,metadata={}){
    if(!current.document){if(!room.invalidated){room.invalidated=true;emit(room,{type:'sync-error',message:'画布文件已被外部删除，未同步设计应保留并导出备份。'});}return;}
    if(current.revision===room.current?.revision&&!room.invalidated&&!room.syncError)return;
    const recovered=room.invalidated||room.syncError,before=room.current;room.current=current;room.generation++;room.invalidated=false;room.syncError=null;
    if(!before?.document||recovered)return emit(room,{type:'snapshot',...snapshot(room,true),source:metadata.source||'external'});
    const ops=diffDocuments(before.document,current.document);
    if(!ops.length){return emit(room,{type:'document',baseRevision:before.revision,revision:current.revision,ops:[],source:metadata.source||'external'});}
    return emit(room,{type:'document',baseRevision:before.revision,revision:current.revision,ops,source:metadata.source||'external',...(metadata.clientId?{clientId:metadata.clientId}:{}),...(metadata.mutationId?{mutationId:metadata.mutationId}:{})});
  }
  async function sync(room){
    const generation=room.generation,current=await readCanvas(room.context);
    if(generation===room.generation)changed(room,current,{source:'external'});
    return room.current;
  }
  function serial(room,action){const pending=room.queue.catch(()=>{}).then(action);room.queue=pending;return pending;}
  async function roomFor(projectId,workspaceKey,initial){
    const context=await resolveWorkspace(projectId),real=await fs.realpath(context.workspace);context.workspace=real;
    const key=hash(real);if(workspaceKey&&workspaceKey!==key)throw fail('工作区已切换，协作请求未应用',409);
    const id=hash(String(context.projectId??'workspace')+'\0'+real).slice(0,32);let room=rooms.get(id);
    if(room){await serial(room,()=>sync(room));return room;}
    let current=await readCanvas(context);
    if(!current.document){
      if(initial&&initial.expectedRevision!==null)throw fail('新画布初始化需要 expectedRevision:null',409);
      const document=validateDocument(initial?.document||emptyDocument('Untitled'));
      current=await transactCanvas(context,value=>value.document?null:{document},{source:'collaboration-initialize'});
    }
    room={id,epoch:randomUUID(),context,workspaceKey:key,current,seq:0,generation:0,queue:Promise.resolve(),clients:new Set(),history:[],historyBytes:0};
    // Concurrent local joins can resolve the same room before initialization.
    if(rooms.has(id))return rooms.get(id);rooms.set(id,room);return room;
  }
  function response(room,client){return {...snapshot(room,false,client),gateway:{...gatewayInfo},localOnly:!gatewayInfo.enabled};}
  async function authenticate(token,body={}){
    if(!TOKEN.test(token||''))throw fail('协作会话无效，请重新加入',403);
    const client=sessions.get(token);if(!client||client.revoked||Date.now()-client.seen>sessionTTL)throw fail('协作会话已过期或被撤销',403);
    if(body.projectId!==undefined&&body.projectId!==null&&String(body.projectId)!==String(client.room.context.projectId))throw fail('该协作会话不属于指定项目',403);
    if(body.roomId&&body.roomId!==client.room.id||body.workspaceKey&&body.workspaceKey!==client.room.workspaceKey)throw fail('该协作会话不属于指定工作区',403);
    if(client.inviteId){const store=await storage(),invite=store.state.invites.find(item=>item.id===client.inviteId);if(!invite||invite.revoked||invite.expiresAt<=Date.now())throw fail('协作邀请已撤销或过期',403);}
    client.seen=Date.now();return client;
  }
  const tokenOf=(req,url,body)=>body.sessionToken||url.searchParams.get('sessionToken')||req.headers.authorization?.replace(/^Bearer /,'');
  function owner(client){if(client.role!=='owner')throw fail('仅房间所有者可管理邀请和局域网入口',403);}
  function remove(client,reason='left'){
    if(client.revoked)return;client.revoked=true;
    for(const res of client.streams){send(res,{type:reason==='revoked'?'revoked':'left',roomId:client.room.id,epoch:client.room.epoch,seq:client.room.seq,clientId:client.clientId});res.end();}
    client.streams.clear();sessions.delete(client.token);client.room.clients.delete(client.token);
    emit(client.room,{type:'left',clientId:client.clientId,reason,participants:participants(client.room)});
  }
  const methods={
    async createRoom(body={}){const room=await roomFor(body.projectId,body.workspaceKey,body);return response(room);},
    async join(body={},remote=false){
      let room,role='owner',inviteId,inviteExpiresAt;
      if(body.sessionToken){const client=await authenticate(body.sessionToken,body);return {...response(client.room,client),sessionToken:client.token,clientId:client.clientId,role:client.role,eventsUrl:'/__local/collaboration/events?sessionToken='+client.token};}
      if(body.invite){
        if(!INVITE.test(body.invite))throw fail('协作邀请无效',403);
        const store=await storage(),invite=store.state.invites.find(item=>item.tokenHash===hash(body.invite));
        if(!invite||invite.revoked||invite.expiresAt<=Date.now())throw fail('协作邀请已撤销或过期',403);
        room=await roomFor(invite.projectId,invite.workspaceKey);if(room.id!==invite.roomId)throw fail('邀请所属工作区已改变',409);
        role=invite.role;inviteId=invite.id;inviteExpiresAt=invite.expiresAt;
      }else{
        if(remote)throw fail('局域网协作需要有效邀请',403);
        room=await roomFor(body.projectId,body.workspaceKey);
      }
      if(room.clients.size>=32)throw fail('同一协作房间最多 32 名参与者',429);
      let clientId=uid(body.clientId)?body.clientId:randomUUID();const token=randomBytes(24).toString('hex');
      // Duplicating a browser tab can clone sessionStorage. Client IDs are
      // display identities, never authorization: give the new session its own.
      if([...room.clients].some(token=>sessions.get(token)?.clientId===clientId))clientId=randomUUID();
      const client={token,clientId,role,inviteId,inviteExpiresAt,room,name:named(body.name),color:colors[room.clients.size%colors.length],streams:new Set(),seen:Date.now(),receipts:new Map(),selection:[],cursor:null,pageId:room.current.document.activePageId};
      sessions.set(token,client);room.clients.add(token);emit(room,{type:'joined',participant:participants(room).find(item=>item.clientId===clientId),participants:participants(room)});
      return {...response(room,client),sessionToken:token,clientId,role,eventsUrl:'/__local/collaboration/events?sessionToken='+token};
    },
    async state(body={}){const client=await authenticate(body.sessionToken,body);await serial(client.room,()=>sync(client.room));return {...response(client.room,client),clientId:client.clientId,role:client.role};},
    async apply(body={}){
      const client=await authenticate(body.sessionToken,body);if(client.role==='viewer')throw fail('当前协作会话只有只读权限',403);
      if(!uid(body.mutationId)||!Array.isArray(body.ops)||!body.ops.length||body.ops.length>10000||recordBytes(body.ops)>4.5*1024*1024)throw fail('协作修改需要唯一 mutationId 和有效操作数组');
      const digest=hash(JSON.stringify(body.ops));
      return serial(client.room,async()=>{
        await authenticate(client.token,body);
        const receipt=client.receipts.get(body.mutationId);
        if(receipt){if(receipt.digest!==digest)throw fail('同一 mutationId 不能提交不同内容',409);await sync(client.room);return {...snapshot(client.room,false,client),mutationId:body.mutationId,duplicate:true,ackRevision:receipt.revision};}
        let applied=0,conflicts=[];
        const current=await transactCanvas(client.room.context,value=>{
          if(client.revoked||client.inviteExpiresAt&&client.inviteExpiresAt<=Date.now())throw fail('协作权限已撤销或过期',403);
          changed(client.room,value,{source:'external'});
          if(!value.document)throw fail('画布文档已删除，修改未应用',409);
          const result=applyOperations(value.document,body.ops);conflicts=result.conflicts;applied=result.applied;
          if(conflicts.length)throw fail('协作修改存在冲突，原草稿应保留以供处理',409,{conflicts,current:{document:value.document,revision:value.revision,epoch:client.room.epoch,seq:client.room.seq}});
          return applied?{document:result.document}:null;
        },{source:'collaboration',clientId:client.clientId,mutationId:body.mutationId});
        changed(client.room,current,{source:'collaboration',clientId:client.clientId,mutationId:body.mutationId});
        client.receipts.set(body.mutationId,{digest,revision:current.revision});while(client.receipts.size>256)client.receipts.delete(client.receipts.keys().next().value);
        return {...snapshot(client.room,false,client),mutationId:body.mutationId,applied,duplicate:false};
      });
    },
    async presence(body={}){
      const client=await authenticate(body.sessionToken,body),room=client.room,ids=new Set();walkDocument(room.current.document,node=>ids.add(node.id));
      body={...body,...(!Object.hasOwn(body,'cursor')&&Object.hasOwn(body,'pointer')?{cursor:body.pointer}:{}),...(!Object.hasOwn(body,'selection')&&Object.hasOwn(body,'selectedIds')?{selection:body.selectedIds}:{})};
      if(body.name!==undefined)client.name=named(body.name);
      if(body.pageId!==undefined){if(body.pageId!==null&&!room.current.document.pages.some(page=>page.id===body.pageId))throw fail('协作页面不存在',409);client.pageId=body.pageId;}
      if(body.cursor!==undefined){if(body.cursor!==null&&(!Number.isFinite(body.cursor.x)||!Number.isFinite(body.cursor.y)||Math.abs(body.cursor.x)>1e6||Math.abs(body.cursor.y)>1e6))throw fail('协作光标坐标无效');client.cursor=body.cursor===null?null:{x:body.cursor.x,y:body.cursor.y};}
      if(body.selection!==undefined){if(!Array.isArray(body.selection)||body.selection.length>100||body.selection.some(id=>typeof id!=='string'||!ids.has(id)))throw fail('协作选区包含无效节点');client.selection=[...new Set(body.selection)];}
      const event=emit(room,{type:'presence',participants:participants(room)});return {ok:true,seq:event.seq};
    },
    async leave(body={}){const client=await authenticate(body.sessionToken,body);remove(client);return {ok:true};},
    async invite(body={}){
      const client=await authenticate(body.sessionToken,body);owner(client);
      if(!['viewer','editor'].includes(body.role))throw fail('邀请角色应为 viewer 或 editor');
      const seconds=body.expiresInSeconds===undefined?86400:Number(body.expiresInSeconds);if(!Number.isInteger(seconds)||seconds<60||seconds>7*86400)throw fail('邀请有效期应为 60 秒至 7 天');
      const token=randomBytes(18).toString('base64url'),item={id:randomUUID(),tokenHash:hash(token),roomId:client.room.id,projectId:client.room.context.projectId,workspaceKey:client.room.workspaceKey,role:body.role,label:named(body.label,'协作邀请'),createdAt:Date.now(),expiresAt:Date.now()+seconds*1000,revoked:false};
      await updateStore(state=>{if(state.invites.filter(invite=>invite.roomId===item.roomId&&!invite.revoked&&invite.expiresAt>Date.now()).length>=30)throw fail('同一房间最多 30 个有效邀请');if(state.invites.length>=3000)throw fail('本地邀请记录已达容量上限');state.invites.push(item);});
      const url='/local-canvas/index.html?invite='+token;
      return {id:item.id,inviteId:item.id,invite:token,token,role:item.role,label:item.label,expiresAt:item.expiresAt,url,gatewayUrls:gatewayInfo.urls.map(origin=>origin+url)};
    },
    async listInvites(body={}){const client=await authenticate(body.sessionToken,body);owner(client);const store=await storage();return store.state.invites.filter(item=>item.roomId===client.room.id).map(({tokenHash,workspaceKey,...item})=>item);},
    async revokeInvite(id,body={}){
      const client=await authenticate(body.sessionToken,body);owner(client);
      return serial(client.room,async()=>{
        await updateStore(state=>{const invite=state.invites.find(item=>item.id===id&&item.roomId===client.room.id);if(!invite)throw fail('邀请不存在',404);invite.revoked=true;invite.revokedAt=Date.now();});
        for(const candidate of [...sessions.values()])if(candidate.inviteId===id)remove(candidate,'revoked');return {ok:true};
      });
    },
  };
  async function events(req,res,url,body){
    const client=await authenticate(tokenOf(req,url,body),body),room=client.room;await serial(room,()=>sync(room));
    const raw=req.headers['last-event-id']??url.searchParams.get('since'),since=raw===null||raw===undefined?null:Number(raw);
    if(since!==null&&(!Number.isSafeInteger(since)||since<0))throw fail('协作事件序号无效');
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});res.flushHeaders?.();
    if(client.streams.size>=3)[...client.streams][0].end();client.streams.add(res);
    const oldest=room.history[0]?.seq??room.seq;
    if(since===null||since>room.seq||since<oldest-1)send(res,snapshot(room,true,client));
    else{for(const event of room.history)if(event.seq>since)send(res,personalize(client,event));send(res,{type:'ready',roomId:room.id,epoch:room.epoch,seq:room.seq,revision:room.current.revision,acknowledgedMutationIds:[...client.receipts.keys()]});}
    emit(room,{type:'presence',participants:participants(room)});
    const heartbeat=setInterval(()=>{client.seen=Date.now();if(!res.destroyed)res.write(': heartbeat\n\n');},15000);heartbeat.unref();
    res.once('close',()=>{clearInterval(heartbeat);client.streams.delete(res);client.seen=Date.now();if(!client.revoked)emit(room,{type:'presence',participants:participants(room)});});return true;
  }
  const unsubscribe=subscribeCanvas?.(current=>{for(const room of rooms.values())if(room.context.workspace===current.workspace)changed(room,current,current.metadata||{});});
  const poll=setInterval(()=>{
    if(closed)return;
    for(const client of [...sessions.values()])if(client.inviteExpiresAt&&client.inviteExpiresAt<=Date.now())remove(client,'revoked');else if(Date.now()-client.seen>sessionTTL)remove(client,'timeout');
    for(const room of rooms.values())if([...room.clients].some(token=>sessions.get(token)?.streams.size))serial(room,()=>sync(room)).catch(error=>{if(room.syncError!==error.message){room.syncError=error.message;emit(room,{type:'sync-error',message:'画布外部变更无法载入：'+error.message});}});
  },Math.max(50,pollMs));poll.unref();
  async function handle(req,res,url,body={},options={}){
    const prefix='/__local/collaboration/';if(!url.pathname.startsWith(prefix))return false;
    const route=url.pathname.slice(prefix.length),remote=Boolean(options.remote);
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});res.end(JSON.stringify(value));return true;};
    try{
      const authBody={...body,...Object.fromEntries(['projectId','roomId','workspaceKey'].filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)])),sessionToken:tokenOf(req,url,body)};
      if(route==='capabilities'&&req.method==='GET')return send({localCollaboration:true,protocol:'m0-canvas-ops-v1',transport:'sse',merge:'field-compare-and-set',remote,roles:['owner','editor','viewer'],maxParticipants:32});
      if(route==='join'&&req.method==='POST')return send(await methods.join(body,remote));
      if(route==='state'&&req.method==='GET')return send(await methods.state(authBody));
      if(route==='events'&&req.method==='GET')return await events(req,res,url,authBody);
      if(route==='ops'&&req.method==='POST')return send(await methods.apply(authBody));
      if(route==='presence'&&req.method==='POST')return send(await methods.presence(authBody));
      if(route==='leave'&&req.method==='POST')return send(await methods.leave(authBody));
      if(remote)return send({error:'局域网入口仅开放已邀请的协作会话接口'},403);
      if(route==='rooms'&&req.method==='POST')return send(await methods.createRoom(body),201);
      if(route==='invites'&&req.method==='POST')return send(await methods.invite(authBody),201);
      if(route==='invites'&&req.method==='GET')return send({invites:await methods.listInvites(authBody)});
      if(route.startsWith('invites/')&&req.method==='DELETE')return send(await methods.revokeInvite(route.slice(8),authBody));
      if(route==='gateway'){
        const client=await authenticate(authBody.sessionToken,authBody);owner(client);
        if(req.method==='GET')return send({...gatewayInfo});
        if(req.method==='POST'){if(typeof body.enabled!=='boolean')throw fail('局域网入口需要 enabled 布尔值');return send(body.enabled?await startGateway({port:body.port||0}):await stopGateway());}
      }
      return send({error:'协作接口或方法不存在'},405);
    }catch(error){if(res.headersSent){res.end();return true;}return send({error:error.message,...(error.current?{current:error.current}:{}),...(error.conflicts?{conflicts:error.conflicts}:{})},error.status||400);}
  }
  function addresses(){const values=new Set(['127.0.0.1','localhost','[::1]']);for(const rows of Object.values(os.networkInterfaces()))for(const row of rows||[])if(row.family==='IPv4')values.add(row.address);return values;}
  async function startGatewayUnlocked({host='0.0.0.0',port=0}={}){
    if(gateway)return {...gatewayInfo};if(closed)throw fail('协作服务已关闭');
    if(!['0.0.0.0','127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<0||port>65535)throw fail('协作局域网监听配置无效');
    const allowedHosts=addresses(),staticRoot=await fs.realpath(staticDir);
    const server=http.createServer(async(req,res)=>{
      const reply=(status,error)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error}));};
      try{
        const authority=req.headers.host||'',origin='http://'+authority,url=new URL(req.url,origin);
        if(!allowedHosts.has(new URL(origin).hostname)||Number(new URL(origin).port)!==server.address().port)return reply(403,'不支持的协作入口地址');
        if(req.headers.origin&&req.headers.origin!==origin)return reply(403,'协作入口不接受跨站请求');
        res.setHeader('content-security-policy',"default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
        let body={};if(['POST','PUT','PATCH','DELETE'].includes(req.method)){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>5*1024*1024)return reply(413,'协作请求超过 5 MB');chunks.push(chunk);}body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}
        if(await handle(req,res,url,body,{remote:true}))return;
        if(req.method!=='GET'||!url.pathname.startsWith('/local-canvas/'))return reply(404,'此入口不提供本机文件、模型或管理 API');
        const relative=decodeURIComponent(url.pathname.slice('/local-canvas/'.length))||'index.html',candidate=path.resolve(staticRoot,relative);
        if(candidate!==staticRoot&&!candidate.startsWith(staticRoot+path.sep))return reply(403,'静态资源路径无效');
        const actual=await fs.realpath(candidate);if(!actual.startsWith(staticRoot+path.sep))return reply(403,'静态资源链接越界');
        const stat=await fs.stat(actual);if(!stat.isFile()||stat.size>2*1024*1024)return reply(404,'静态资源不存在');
        const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
        if(!types[path.extname(actual)])return reply(404,'不支持的静态资源');res.writeHead(200,{'content-type':types[path.extname(actual)],'cache-control':'no-store'});res.end(await fs.readFile(actual));
      }catch(error){if(!res.headersSent)reply(error.code==='ENOENT'?404:error.status||400,error.message);else res.end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});gateway=server;
    const actual=server.address().port,ips=host==='0.0.0.0'?[...allowedHosts].filter(ip=>/^\d+\./.test(ip)&&ip!=='127.0.0.1'):[host];
    gatewayInfo={enabled:true,host,port:actual,urls:(ips.length?ips:['127.0.0.1']).map(ip=>'http://'+(ip.includes(':')?'['+ip+']':ip)+':'+actual)};return {...gatewayInfo};
  }
  async function stopGatewayUnlocked(){if(gateway){const server=gateway;gateway=undefined;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}gatewayInfo={enabled:false,urls:[]};return {...gatewayInfo};}
  const gatewayOperation=operation=>{const pending=gatewayQueue.catch(()=>{}).then(operation);gatewayQueue=pending;return pending;};
  const startGateway=options=>gatewayOperation(()=>startGatewayUnlocked(options));
  const stopGateway=()=>gatewayOperation(stopGatewayUnlocked);
  async function close(){closed=true;clearInterval(poll);unsubscribe?.();for(const client of [...sessions.values()])remove(client);await stopGateway();}
  return {handle,...methods,startGateway,stopGateway,close,gatewayStatus:()=>({...gatewayInfo})};
}
