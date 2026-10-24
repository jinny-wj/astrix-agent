import fs from 'node:fs';
import {spawn} from 'node:child_process';
import layoutConfig from '../../../packages/astrix-workbench/layout.cjs';
import path from 'node:path';
const root = layoutConfig.getLayout().webRoot;
if (!fs.existsSync(path.join(root, 'plugins/recovered/manifest.json'))) {
  const child=spawn(process.execPath,[path.join(root,'plugins/prepare.mjs')],{stdio:'inherit',cwd:root});
  await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Recovered plugin preparation failed')));});
}
if (!fs.existsSync(path.join(layoutConfig.getLayout().publicRoot, 'index.html'))) {
  const child = spawn(process.execPath, [path.join(root, 'frontend-tools/prepare-frontend.mjs')], {stdio:'inherit',cwd:root});
  await new Promise((resolve,reject)=>child.on('exit', code=>code===0?resolve():reject(new Error('Frontend preparation failed'))));
}
await import('../server/index.mjs');
