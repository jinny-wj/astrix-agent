import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, lstatSync, realpathSync, readlinkSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'

if (process.platform !== 'darwin') {
  throw new Error('macOS 应用验收只能在 macOS 上运行。')
}

const options = new Map(
  process.argv.slice(2).map((argument) => {
    const [name, ...value] = argument.replace(/^--/, '').split('=')
    return [name, value.join('=')]
  }),
)
const mode = options.get('mode') ?? 'local'
const applicationPath = resolve(options.get('app') ?? 'release/mac-arm64/Astrix.app')

if (!['local', 'distribution'].includes(mode)) {
  throw new Error(`未知验收模式：${mode}`)
}
if (!existsSync(applicationPath)) {
  throw new Error(`Application bundle not found: ${applicationPath}`)
}

function run(command, args, extra = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    ...extra,
  }).trim()
}

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', applicationPath], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

const detailsResult = spawnSync(
  'codesign',
  ['--display', '--verbose=4', applicationPath],
  { encoding: 'utf8' },
)
if (detailsResult.status !== 0) {
  throw new Error(detailsResult.stderr || '无法读取代码签名信息。')
}
const signatureDetails = `${detailsResult.stdout}\n${detailsResult.stderr}`
const { build: { productName } } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const infoPlist = `${applicationPath}/Contents/Info.plist`
for (const field of ['CFBundleName', 'CFBundleDisplayName', 'CFBundleExecutable']) {
  const value = run('/usr/libexec/PlistBuddy', ['-c', `Print :${field}`, infoPlist])
  if (value !== productName) {
    throw new Error(`应用名称验收失败：${field} 应为 ${productName}，实际为 ${value}。`)
  }
}
const executablePath = `${applicationPath}/Contents/MacOS/${productName}`
const architectures = run('lipo', ['-archs', executablePath]).split(/\s+/).sort()
if (!architectures.includes('arm64')) {
  throw new Error(`工作台验收失败：当前恢复组件要求 arm64，应用架构为 ${architectures.join(', ')}。`)
}

// Verify the launch-time icon too, not just Electron's running Dock image.
const iconName = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', `${applicationPath}/Contents/Info.plist`])
const expectedIcon = resolve('build/astrix.icns')
const bundledIcon = `${applicationPath}/Contents/Resources/${iconName}`
if (iconName !== 'astrix.icns' || !existsSync(bundledIcon)) {
  throw new Error('启动图标验收失败：应用没有引用星序专用图标。')
}
if (existsSync(expectedIcon) && !readFileSync(expectedIcon).equals(readFileSync(bundledIcon))) {
  throw new Error('启动图标验收失败：打包图标与星序源图标不一致。')
}

const resourceRoot = resolve(applicationPath, 'Contents/Resources')
const manifestFile = resolve(resourceRoot, 'workbench/bundle-manifest.json')
if (!existsSync(manifestFile)) throw new Error('工作台验收失败：缺少双端运行资源清单。')
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (manifest.format !== 'astrix-desktop-workbench-bundle-v1' || manifest.version !== packageInfo.version
  || manifest.arch !== 'arm64' || manifest.platform !== 'darwin' || !Array.isArray(manifest.files)) {
  throw new Error('工作台验收失败：资源清单版本或平台不匹配。')
}
for (const record of manifest.files) {
  const file = resolve(resourceRoot, record.path)
  if (!file.startsWith(resourceRoot + sep) || !existsSync(file)) throw new Error('工作台资源缺失或越界：' + record.path)
  if (record.kind === 'symlink') {
    if (!lstatSync(file).isSymbolicLink() || readlinkSync(file) !== record.target
      || !realpathSync(file).startsWith(resourceRoot + sep)) throw new Error('工作台资源链接校验失败：' + record.path)
  } else {
    const bytes = readFileSync(file)
    if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
      // Local/Developer ID signing changes Mach-O signatures after staging.
      // The enclosing app seal was verified above; verify each changed native
      // component's own signature and arm64 architecture as well.
      if (!record.macho || !run('lipo', ['-archs', file]).split(/\s+/).includes('arm64')) {
        throw new Error('工作台资源内容校验失败：' + record.path)
      }
      run('codesign', ['--verify', '--strict', file], {stdio: ['ignore','pipe','pipe']})
    }
  }
}
for (const required of [
  'workbench/网页端/workbench/public/index.html',
  'workbench/网页端/workbench/server/index.mjs',
  'workbench/客户端/workbench/desktop/main.cjs',
  'workbench/客户端/workbench/tools/authentic-editor-guard.cjs',
  'workbench/客户端/workbench/tools/authentic-editor-preload.cjs',
  'workbench/客户端/workbench/tools/authentic-editor-child.cjs',
  'workbench/packages/astrix-workbench/layout.cjs',
  'recovered/extracted/resources/editor/out/server-main.kscode.js',
  'recovered/extracted/resources/opencode-darwin-arm64/bin/opencode',
]) {
  if (!existsSync(resolve(resourceRoot, required))) throw new Error('工作台核心资源未进入应用：' + required)
}

// Read app.asar using Electron's own ASAR-aware filesystem without launching UI.
const packagedMetadata = JSON.parse(run(executablePath, ['-e',
  'const fs=require("node:fs"),path=require("node:path");const root=process.argv[1];const p=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));process.stdout.write(JSON.stringify({main:p.main,version:p.version,entry:fs.existsSync(path.join(root,p.main))}));',
  resolve(resourceRoot, 'app.asar')], {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}}))
if (packagedMetadata.main !== 'dist-electron/main.mjs' || !packagedMetadata.entry || packagedMetadata.version !== manifest.version) {
  throw new Error('工作台验收失败：应用实际启动入口或版本不正确。')
}

if (mode === 'local') {
  if (!signatureDetails.includes('Signature=adhoc')) {
    console.warn('提示：当前本机包使用的不是临时签名。')
  }
} else {
  if (!signatureDetails.includes('Authority=Developer ID Application:')) {
    throw new Error('发行验收失败：应用未使用 Developer ID Application 签名。')
  }
  const teamIdentifier = signatureDetails.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim()
  if (!teamIdentifier || teamIdentifier === 'not set') {
    throw new Error('发行验收失败：签名中缺少 Apple TeamIdentifier。')
  }
  if (!architectures.includes('arm64') || !architectures.includes('x86_64')) {
    throw new Error(
      `发行验收失败：应用必须是 universal，目前架构为 ${architectures.join(', ')}。`,
    )
  }

  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', applicationPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  run('xcrun', ['stapler', 'validate', applicationPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

console.log(
  `macOS ${mode === 'distribution' ? '发行' : '本机'}验收通过：${architectures.join(' + ')}，签名完整。`,
)
