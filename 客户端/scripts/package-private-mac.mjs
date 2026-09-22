import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A private, ad-hoc signed build. This never uploads artifacts or invokes notarization.
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('此命令目前只在 Apple 芯片 Mac 上生成 arm64 私发包。')
}
const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const electronDist = join(root, 'node_modules/electron/dist')
if (!existsSync(join(electronDist, 'Electron.app'))) throw new Error('请先完成 Electron 依赖安装。')
const installedVersion = readFileSync(join(electronDist, 'version'), 'utf8').trim().replace(/^v/, '')
if (installedVersion !== pkg.devDependencies.electron) throw new Error('Electron 本地运行时与锁定版本不一致，请重新安装依赖。')
const run = (command, args, extra = {}) => execFileSync(command, args, { cwd: root, stdio: 'inherit', ...extra })
const output = resolve(root, 'release/private')
mkdirSync(output, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'astrix-private-'))
const artifact = `${pkg.build.productName}-${pkg.version}-arm64-private.dmg`
try {
  for (const script of ['build', 'desktop:typecheck', 'desktop:bundle']) run('pnpm', ['run', script])
  run('pnpm', ['exec', 'electron-builder', '--mac', 'dir', '--arm64', '--publish', 'never',
    `-c.electronDist=${electronDist}`, `-c.directories.output=${join(scratch, 'build')}`], {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  })
  const volume = join(scratch, 'volume')
  mkdirSync(volume)
  const app = join(volume, `${pkg.build.productName}.app`)
  run('ditto', ['--norsrc', '--noextattr', join(scratch, 'build/mac-arm64', `${pkg.build.productName}.app`), app])
  run(process.execPath, ['scripts/sign-mac-local.mjs', app])
  run(process.execPath, ['scripts/verify-mac-release.mjs', '--mode=local', `--app=${app}`])
  symlinkSync('/Applications', join(volume, 'Applications'))
  cpSync(join(root, 'docs/private-install.txt'), join(volume, '安装与首次使用.txt'))
  const dmg = join(scratch, artifact)
  run('hdiutil', ['create', '-volname', 'Astrix 安装', '-srcfolder', volume, '-format', 'UDZO', dmg])
  run('hdiutil', ['verify', dmg])
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(dmg)) hash.update(chunk)
  const checksum = `${hash.digest('hex')}  ${artifact}\n`
  cpSync(dmg, join(output, artifact))
  writeFileSync(join(output, `${artifact}.sha256`), checksum)
  cpSync(join(root, 'docs/private-install.txt'), join(output, '安装与首次使用.txt'))
  console.log(`私发安装包已生成：${join(output, artifact)}\n仅 Apple 芯片 / macOS 13+；临时签名，未公证。`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
