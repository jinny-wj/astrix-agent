import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

if (process.platform !== 'darwin') {
  throw new Error('Local macOS signing can only run on macOS.')
}

const applicationPath = resolve(process.argv[2] ?? 'release/mac-arm64/Astrix.app')
const entitlementsPath = resolve('build/entitlements.mac.plist')

if (!existsSync(applicationPath)) {
  throw new Error(`Application bundle not found: ${applicationPath}`)
}

// Finder metadata on generated bundles prevents codesign from sealing resources.
for (const attribute of ['com.apple.FinderInfo', 'com.apple.ResourceFork']) {
  execFileSync('xattr', ['-dr', attribute, applicationPath], { stdio: 'inherit' })
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
