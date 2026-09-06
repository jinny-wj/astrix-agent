import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
const applicationPath = resolve(options.get('app') ?? 'release/mac-arm64/Design Studio.app')

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
const executablePath = `${applicationPath}/Contents/MacOS/Design Studio`
const architectures = run('lipo', ['-archs', executablePath]).split(/\s+/).sort()

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
