// Read-only network recovery of exact static references found in local code.
// This is deliberately separate from prepare-frontend: recovered plugin code
// is preserved as evidence and is not loaded by the working local application.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import layoutConfig from '../../../packages/astrix-workbench/layout.cjs';

const output = path.join(layoutConfig.getLayout().recoveryRoot,'web-assets/additional-static');
const references = [
  { url: 'https://p5-live.wskwai.com/kcdn/cdn-kcdn112803/app-figma-api/index.iife-76.js', evidence: 'extracted/app/out/main/index.js:8679; default Figma runtime injection URL' },
  { url: 'https://blobstore-nginx.staging.kuaishou.com/bs2/upload-lux-portal/m0-plugin-files/id_25/plugin.js', evidence: 'index-iLbwEgQT.js; nonproduction BlobCDNHost + DEFAULT_PLUGIN_ID 25' },
  { url: 'https://blobstore-nginx.staging.kuaishou.com/bs2/upload-lux-portal/m0-plugin-files/id_32/plugin.js', evidence: 'index-iLbwEgQT.js; nonproduction BlobCDNHost + DEFAULT_PLUGIN_ID theme 32' },
  { url: 'https://bs3-hb1.corp.kuaishou.com/upload-lux-portal/m0-plugin-files/id_1/plugin.js', evidence: 'index-iLbwEgQT.js; production BlobCDNHost + DEFAULT_PLUGIN_ID 1' },
  { url: 'https://bs3-hb1.corp.kuaishou.com/upload-lux-portal/m0-plugin-files/id_4/plugin.js', evidence: 'index-iLbwEgQT.js; production BlobCDNHost + DEFAULT_PLUGIN_ID theme 4' },
  { url: 'https://m0.corp.kuaishou.com/left-iframe.html', evidence: 'resize-container-CWxcyYgS.js and index-DDtdPWM7.js; original workbench origin + literal iframe src' },
  { url: 'https://m0.corp.kuaishou.com/nest-canvas.html', evidence: 'index-v2-BGt4TMzj.js; original workbench origin + literal iframe src' },
];
const records = [];
await mkdir(output, {recursive:true});
for (const reference of references) {
  const record = { ...reference, requestedWith: 'Unauthenticated GET; no Cookie/Authorization; redirects refused' };
  try {
    const response = await fetch(reference.url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(20000) });
    record.status = response.status;
    record.contentType = response.headers.get('content-type') || '';
    if (!response.ok) { record.outcome = response.status >= 300 && response.status < 400 ? 'Redirect requires separate authorization; body not read' : 'Unavailable; body not read'; records.push(record); continue; }
    const limit = 16 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Static artifact exceeds 16 MiB cap');
    const chunks=[]; let size=0; const reader=response.body.getReader();
    for (;;) {
      const item=await reader.read(); if (item.done) break;
      size+=item.value.length;
      if(size>limit) { await reader.cancel(); throw new Error('Static artifact exceeds 16 MiB cap'); }
      chunks.push(item.value);
    }
    const bytes=Buffer.concat(chunks); const prefix=bytes.subarray(0,16384).toString('utf8');
    const isJS = reference.url.endsWith('.js');
    if (isJS && /^\s*(?:<!doctype|<html)/i.test(prefix)) throw new Error('HTML/auth response refused for JavaScript artifact');
    if (!isJS && /(?:ksso|sso-login|name=["']password|authUrl|登录快手|快手统一登录)/i.test(prefix)) throw new Error('Authentication HTML refused; not saved');
    const url=new URL(reference.url);
    const relative=path.join(url.hostname,...url.pathname.split('/').filter(Boolean));
    const target=path.join(output,relative);
    await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,bytes);
    Object.assign(record,{outcome:'Saved static artifact; not executed',path:relative,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  } catch(error) { record.outcome=error.message; }
  records.push(record);
}
await writeFile(path.join(output,'manifest.json'),JSON.stringify({format:'exact-static-reference-probe-v1',records},null,2)+'\n');
for (const record of records) console.log(JSON.stringify({url:record.url,status:record.status,outcome:record.outcome,size:record.size}));
