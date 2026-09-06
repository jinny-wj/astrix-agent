import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

if (process.platform !== 'darwin') {
  throw new Error('Local macOS signing can only run on macOS.')
}

const applicationPath = resolve('release/mac-arm64/Design Studio.app')
const entitlementsPath = resolve('build/entitlements.mac.plist')

if (!existsSync(applicationPath)) {
  throw new Error(`Application bundle not found: ${applicationPath}`)
}

execFileSync(
  'codesign',
  [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--options',
    'runtime',
    '--timestamp=none',
    '--entitlements',
    entitlementsPath,
    applicationPath,
  ],
  { stdio: 'inherit' },
)

execFileSync(
  'codesign',
  ['--verify', '--deep', '--strict', '--verbose=2', applicationPath],
  { stdio: 'inherit' },
)
