import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createCanvasService,validateCanvasAsset} from '../server/canvas.mjs';
import {emptyDocument,createNode,pageNodes,pathFromSVGData,extractCanvasAssets} from '../canvas/model.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const vectorAsset=source=>{const bytes=Buffer.isBuffer(source)?source:Buffer.from(source,'utf8');return{fileName:`canvas-vector-${hash(bytes)}.svg`,mime:'image/svg+xml',base64:bytes.toString('base64')};};
function fixtureDocument(){const doc=emptyDocument('真实 SVG 资产生成'),frame=createNode('frame'),vector={...createNode('path',24,32),width:120,height:80,rotation:27,flipX:true,fill:'#334455',stroke:'#102030',strokeWidth:2,gradient:{type:'linear',from:{x:0,y:0},to:{x:1,y:1},stops:[{offset:0,color:'#ff0000'},{offset:1,color:'#0000ff'}]},path:pathFromSVGData('M0 40C0 0 120 0 120 40L120 80L0 80Z',{width:120,height:80})},image={...createNode('image',180,40),imageData:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSXYAAAAASUVORK5CYII='};frame.children=[vector,image];pageNodes(doc).push(frame);return doc;}
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-vector-assets-')),projects=[{id:1,projectPath:path.join(directory,'project-one')},{id:2,projectPath:path.join(directory,'project-two')}];await Promise.all(projects.map(p=>fs.mkdir(p.projectPath)));
  const api={state:{projects},findProject:id=>projects.find(p=>String(p.id)===String(id))},canvas=createCanvasService({api,getWorkspace:()=>projects[1].projectPath});
  const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};if(!await canvas.handle(req,res,new URL(req.url,'http://127.0.0.1'),body)){res.writeHead(404);res.end('{}');}}catch(error){res.writeHead(error.status||400,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,method='GET',body)=>{const r=await fetch(origin+route,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};};
  return{projects,request};
}
test('generated SVG and existing raster assets validate without rewriting bytes',()=>{for(const asset of extractCanvasAssets(fixtureDocument())){const validated=validateCanvasAsset(asset);assert.equal(validated.path,'assets/'+asset.fileName);assert.deepEqual(validated.content,Buffer.from(asset.base64,'base64'));assert.equal(validated.mime,asset.mime);}});
test('SVG asset boundary rejects active content, external resources, non-UTF8, invalid hashes and oversize bytes',()=>{
  const source=Buffer.from(extractCanvasAssets(fixtureDocument()).find(a=>a.mime==='image/svg+xml').base64,'base64').toString('utf8');
  for(const modified of [source.replace('</svg>','<script>alert(1)</script></svg>'),source.replace('</svg>','<foreignObject/></svg>'),source.replace('<svg ','<svg onload="alert(1)" '),source.replace('<path ','<path href="https://example.com/x" '),source.replace('url(#paint)','url(https://example.com/paint)'),source.replace('<linearGradient ','<linearGradient href="file:///etc/passwd" '),'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+source,source.replace(/d="[^"]*" fill=/,'d="M0 0L1e309 0" fill='),source.replace('http://www.w3.org/2000/svg','https://example.com')])assert.throws(()=>validateCanvasAsset(vectorAsset(modified)),/SVG/);
  const asset=vectorAsset(source);assert.throws(()=>validateCanvasAsset({...asset,fileName:'canvas-vector-'+('0'.repeat(64))+'.svg'}),/哈希/);assert.throws(()=>validateCanvasAsset({...asset,fileName:'../'+asset.fileName}),/图片/);assert.throws(()=>validateCanvasAsset({...asset,mime:'image/png'}),/类型/);assert.throws(()=>validateCanvasAsset(vectorAsset(Buffer.from([0x3c,0xc3,0x28,0x3e]))),/UTF-8/);assert.throws(()=>validateCanvasAsset(vectorAsset(Buffer.alloc(512*1024+1,32))),/512 KB/);assert.throws(()=>validateCanvasAsset({...asset,base64:asset.base64+'A'}),/编码|内容/);
});
test('HTTP canvas generation runs the recovered KRN and writes exact SVG plus raster assets only to captured project',async t=>{
  const f=await fixture(t),document=fixtureDocument(),expected=extractCanvasAssets(document),saved=await f.request('/__local/canvas?projectId=1','PUT',{document,expectedRevision:null});assert.equal(saved.status,200,JSON.stringify(saved.data));
  const result=await f.request('/__local/canvas/generate?projectId=1','POST',{expectedRevision:saved.data.revision,directory:'generated/vector-proof'});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.engine,'recovered-original-krn');assert.equal(result.data.assets.length,2);assert.equal(result.data.imported.files.length,4);
  const app=await fs.readFile(path.join(f.projects[0].projectPath,'generated/vector-proof/App.tsx'),'utf8');
  for(const asset of expected){const actual=result.data.assets.find(a=>path.basename(a.path)===asset.fileName);assert.ok(actual);const bytes=await fs.readFile(path.join(f.projects[0].projectPath,actual.path));assert.deepEqual(bytes,Buffer.from(asset.base64,'base64'));assert.ok(app.includes('./assets/'+asset.fileName));if(asset.mime==='image/svg+xml'){assert.equal(hash(bytes),asset.fileName.slice(14,-4));const text=bytes.toString('utf8');assert.match(text,/<linearGradient/);assert.match(text,/rotate\(27\)/);assert.match(text,/scale\(-1 1\)/);assert.doesNotMatch(text,/<script|href=/);}}
  await assert.rejects(fs.access(path.join(f.projects[1].projectPath,'generated/vector-proof')));
});
test('HTTP generation rejects unsupported KRN transforms instead of reporting a visually incomplete success',async t=>{
  const f=await fixture(t),document=emptyDocument('不支持转换的变换'),text={...createNode('text'),rotation:45};pageNodes(document).push(text);const saved=await f.request('/__local/canvas?projectId=1','PUT',{document,expectedRevision:null});assert.equal(saved.status,200);const generated=await f.request('/__local/canvas/generate?projectId=1','POST',{expectedRevision:saved.data.revision,directory:'generated/unsupported'});assert.equal(generated.status,400);assert.match(generated.data.error,/原 KRN 暂不支持/);await assert.rejects(fs.access(path.join(f.projects[0].projectPath,'generated/unsupported')));
});
