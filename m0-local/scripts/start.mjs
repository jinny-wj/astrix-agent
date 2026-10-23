import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(root, 'plugins/recovered/manifest.json'))) {
  const child=spawn(process.execPath,[path.join(root,'plugins/prepare.mjs')],{stdio:'inherit',cwd:root});
  await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Recovered plugin preparation failed')));});
}
if (!fs.existsSync(path.join(root, 'public/index.html'))) {
  const child = spawn(process.execPath, [path.join(root, 'frontend-tools/prepare-frontend.mjs')], {stdio:'inherit',cwd:root});
  await new Promise((resolve,reject)=>child.on('exit', code=>code===0?resolve():reject(new Error('Frontend preparation failed'))));
}
await import('../server/index.mjs');
