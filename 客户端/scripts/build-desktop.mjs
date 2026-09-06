import { build } from 'esbuild'
import { rmSync } from 'node:fs'

// Keep desktop bundles reproducible: stale preloads must never leak into ASAR.
rmSync('dist-electron', { recursive: true, force: true })

const shared = {
  bundle: true,
  logLevel: 'info',
  platform: 'node',
  sourcemap: true,
  target: 'node22',
}

await build({
  ...shared,
  entryPoints: ['desktop/main.ts'],
  external: ['electron', '@anthropic-ai/claude-agent-sdk'],
  format: 'esm',
  outfile: 'dist-electron/main.mjs',
})

await build({
  ...shared,
  entryNames: 'preload-[name]',
  entryPoints: {
    shell: 'desktop/preload/shell.ts',
    home: 'desktop/preload/home.ts',
    agent: 'desktop/preload/agent.ts',
  },
  external: ['electron'],
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
})
