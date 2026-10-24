import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import layoutModule from '../../packages/astrix-workbench/layout.cjs'

if (process.platform !== 'darwin') {
  throw new Error('macOS 发行包只能在 macOS 上签名和公证。')
}

// The existing release command builds universal Electron, but this workbench's
// recovered native editor and engine currently ship only arm64 components.
// Do not label that combination as an Intel-capable full application.
const runtimeManifest = join(layoutModule.getLayout().recoveryRoot, 'runtime-manifest.json')
const nativeRuntime = existsSync(runtimeManifest) ? JSON.parse(readFileSync(runtimeManifest, 'utf8')) : null
const nativeArchitectures = nativeRuntime?.supportedArchitectures ?? [nativeRuntime?.arch]
if (!nativeArchitectures.includes('arm64') || !nativeArchitectures.includes('x86_64')) {
  throw new Error('完整工作台当前仅有 macOS arm64 原生运行组件，尚不支持 universal 正式发行。请使用 desktop:dist:mac:private 生成 Apple 芯片本机试用包。')
}

function hasCompleteGroup(names) {
  const configured = names.filter((name) => Boolean(process.env[name]))
  if (configured.length > 0 && configured.length < names.length) {
    throw new Error(`公证凭证不完整：${names.join('、')} 必须成组配置。`)
  }
  return configured.length === names.length
}

const identities = execFileSync(
  'security',
  ['find-identity', '-v', '-p', 'codesigning'],
  { encoding: 'utf8' },
)

if (!identities.includes('Developer ID Application:')) {
  throw new Error(
    '未找到 Developer ID Application 证书。请先把有效证书及私钥导入当前用户钥匙串。',
  )
}

const hasApiKey = hasCompleteGroup([
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
])
const hasAppleId = hasCompleteGroup([
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
])
const hasKeychainProfile = Boolean(process.env.APPLE_KEYCHAIN_PROFILE)

if (!hasApiKey && !hasAppleId && !hasKeychainProfile) {
  throw new Error(
    '未配置 Apple 公证凭证。请配置 App Store Connect API Key、Apple ID 三件套，或 APPLE_KEYCHAIN_PROFILE。',
  )
}

execFileSync('xcrun', ['notarytool', '--version'], { stdio: 'ignore' })

console.log('macOS 发行预检通过：Developer ID 与公证凭证均可用。')
