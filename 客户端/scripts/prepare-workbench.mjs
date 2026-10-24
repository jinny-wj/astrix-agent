import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import layoutModule from '../../packages/astrix-workbench/layout.cjs';
import {collectRuntime, sanitizeRuntimeBytes, verifyStagedRuntime} from '../../packages/astrix-workbench/tools/package-runtime.mjs';

const {getLayout} = layoutModule;
const slash = value => value.split(path.sep).join('/');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isMachO = bytes => bytes.length >= 4 && [0xfeedface,0xcefaedfe,0xfeedfacf,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(bytes.readUInt32BE(0));
const privatePart = /^(?:\.git|\.data|\.local-data|\.release-assets|node_modules|diagnostics|workspace|verification-output|\.aws|\.ssh|__pycache__|\.DS_Store)$/;

export function assertRuntimePath(relative) {
  if (!relative || path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || privatePart.test(part)
    || /^\.env(?:\.|$)/i.test(part) || /^(?:credentials|cookies|login-data|login data|\.npmrc|\.netrc)$/i.test(part)
    || /\.(?:pem|key|p12|pfx)$/i.test(part))) throw Error('Private or escaping workbench resource path: ' + relative);
}

export async function stageWorkbench({layout = getLayout(), outputDir = path.join(layout.repositoryRoot, '客户端/.workbench-bundle')} = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Recovered native workbench resources currently support macOS arm64 only.');
  const destination = path.resolve(outputDir);
  const stage = destination + '.pending-' + randomUUID();
  const files = [];
  const workbenchRoot = path.join(stage, 'workbench');
  const nativeRoot = path.join(stage, 'recovered');
  await fs.mkdir(stage, {recursive: true});
  async function copy(file, target) {
    const relative = slash(path.relative(stage, target));
    assertRuntimePath(relative);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw Error('Source resource symlinks are not allowed: ' + relative);
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(file)).sort()) {
        if (/\.test\.(?:mjs|js|cjs)$/.test(entry) || /^ui-.*\.cjs$/.test(entry) || ['.DS_Store', 'verification-output'].includes(entry)) continue;
        await copy(path.join(file, entry), path.join(target, entry));
      }
    } else if (stat.isFile()) {
      const clean = sanitizeRuntimeBytes(await fs.readFile(file), relative);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.writeFile(target, clean.bytes, {mode: stat.mode & 0o777});
      files.push({path: relative, bytes: clean.bytes.length, sha256: sha(clean.bytes), mode: stat.mode & 0o777, ...(isMachO(clean.bytes)?{macho:true}:{})});
    } else throw Error('Unsupported workbench resource: ' + relative);
  }
  try {
    const webDestination = path.join(workbenchRoot, '网页端/workbench');
    for (const folder of ['server', 'public', 'plugins', 'canvas', 'figma-plugin-bridge']) {
      await copy(path.join(layout.webRoot, folder), path.join(webDestination, folder));
    }
    const desktopDestination = path.join(workbenchRoot, '客户端/workbench');
    await copy(path.join(layout.desktopRoot, 'desktop'), path.join(desktopDestination, 'desktop'));
    for (const name of ['authentic-editor-guard.cjs', 'authentic-editor-preload.cjs', 'authentic-editor-child.cjs']) {
      await copy(path.join(layout.desktopRoot, 'tools', name), path.join(desktopDestination, 'tools', name));
    }
    for (const name of ['layout.cjs', 'package.json']) {
      await copy(path.join(layout.sharedRoot, name), path.join(workbenchRoot, 'packages/astrix-workbench', name));
    }
    const runtime = await collectRuntime({sourceRoot: layout.recoveryRoot, version: layout.version});
    for (const record of runtime.records) {
      const target = path.join(nativeRoot, record.path);
      await fs.mkdir(path.dirname(target), {recursive: true});
      if (record.kind === 'symlink') {
        await fs.symlink(record.target, target);
        files.push({path: slash(path.relative(stage, target)), kind: 'symlink', target: record.target});
      } else {
        const bytes = await fs.readFile(record.source);
        if (sha(bytes) !== record.sourceSha256) throw Error('Native source changed while staging: ' + record.path);
        const clean = sanitizeRuntimeBytes(bytes, record.path).bytes;
        if (sha(clean) !== record.sha256) throw Error('Native sanitization changed: ' + record.path);
        await fs.writeFile(target, clean, {mode: record.mode});
        files.push({path: slash(path.relative(stage, target)), bytes: clean.length, sha256: record.sha256, mode: record.mode, ...(isMachO(clean)?{macho:true}:{})});
      }
    }
    const anchor = Buffer.from(JSON.stringify({name: 'astrix-recovered-runtime', version: layout.version, private: true, type: 'commonjs'}, null, 2) + '\n');
    const anchorPath = path.join(nativeRoot, 'extracted/app/package.json');
    await fs.mkdir(path.dirname(anchorPath), {recursive: true});
    await fs.writeFile(anchorPath, anchor);
    files.push({path: 'recovered/extracted/app/package.json', bytes: anchor.length, sha256: sha(anchor), mode: 0o644});
    const verification = await verifyStagedRuntime(nativeRoot);
    const manifest = {format: 'astrix-desktop-workbench-bundle-v1', version: layout.version, platform: 'darwin', arch: 'arm64', verification,
      privateDataIncluded: false, files: files.sort((a, b) => a.path.localeCompare(b.path))};
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    // Put the self-contained manifest alongside the packaged sources too.
    await fs.copyFile(path.join(stage, 'manifest.json'), path.join(workbenchRoot, 'bundle-manifest.json'));
    await fs.rm(destination, {recursive: true, force: true});
    await fs.rename(stage, destination);
    return {version: layout.version, files: files.length, outputDir: destination, verification};
  } catch (error) {
    await fs.rm(stage, {recursive: true, force: true});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await stageWorkbench(), null, 2));
}
