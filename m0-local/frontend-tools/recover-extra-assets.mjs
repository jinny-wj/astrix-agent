import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const directory = path.join(here, 'extra-assets');
await mkdir(directory, { recursive: true });
let manifest = { assets: [], skipped: [] };
try { manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const input = process.argv.slice(2);
if (!input.length) input.push(path.join(root, 'diagnostics/desktop-smoke.json'));
const urls = new Set();
for (const file of input) {
  const diagnostic = await readFile(path.resolve(file), 'utf8');
  for (const match of diagnostic.matchAll(/https:\/\/cdnfile\.corp\.kuaishou\.com\/[^\s'"\\<>]+/g)) {
    const url = new URL(match[0]);
    if (url.search || url.hash || !/\.(?:png|jpe?g|webp|svg|woff2?|ttf|otf|gif)$/i.test(url.pathname)) continue;
    urls.add(url.href);
  }
}
for (const url of urls) {
  if (manifest.assets.some(asset => asset.url === url)) continue;
  if (/\.gif$/i.test(url)) { manifest.skipped.push({ url, reason: 'Optional marketing animation omitted.' }); continue; }
  try {
    const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024) throw new Error('Asset exceeds 10 MiB limit');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new Error('Asset exceeds 10 MiB limit'); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (response.headers.get('content-type')?.includes('text/html')) throw new Error('Login/HTML response refused');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const extension = path.extname(new URL(url).pathname);
    const file = `${digest.slice(0,20)}${extension}`;
    await writeFile(path.join(directory, file), bytes);
    manifest.assets.push({ url, file, local: '/extra-assets/' + file, sha256: digest, size });
    console.log(`Saved ${path.basename(new URL(url).pathname)} (${size} bytes)`);
  } catch (error) { manifest.skipped.push({url,reason:error.message}); console.log(`Skipped ${path.basename(new URL(url).pathname)}: ${error.message}`); }
}
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Extra static assets: ${manifest.assets.length}; skipped: ${manifest.skipped.length}`);
