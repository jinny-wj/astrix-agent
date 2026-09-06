import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export function whichBin(name: string) {
  const home = homedir()
  const extras = [
    join(home, '.local', 'bin'),
    join(home, '.hermes', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  for (const dir of [...extras, ...pathDirs]) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function childEnv() {
  const home = homedir()
  const extras = [
    join(home, '.local', 'bin'),
    join(home, '.hermes', 'bin'),
    '/opt/homebrew/bin',
  ]
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [...extras, process.env.PATH ?? ''].join(':'),
    HOME: process.env.HOME ?? home,
  }
  // Do not leak the parent Codex session identity into a child agent. These
  // markers can make nested CLIs believe they are already inside a managed
  // run and may cause false startup failures.
  delete env.CODEX_CI
  delete env.CODEX_SANDBOX
  delete env.CODEX_THREAD_ID
  delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE
  delete env.CODEX_SHELL
  return env
}
