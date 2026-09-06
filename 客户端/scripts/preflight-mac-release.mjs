import { execFileSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  throw new Error('macOS 发行包只能在 macOS 上签名和公证。')
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
