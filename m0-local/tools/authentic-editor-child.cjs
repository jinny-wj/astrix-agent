'use strict';
// Preloaded before each allowlisted original VS Code helper, including language
// servers. The renderer never receives this process-spawning permission.
const fs = require('node:fs');
const path = require('node:path');
const encoded = process.env.M0_EDITOR_CHILD_POLICY;
if (!encoded) throw new Error('Missing local editor child policy');
const policy = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
delete process.env.M0_EDITOR_CHILD_POLICY;
const audit = path.join(policy.sandbox, 'process-audit.jsonl');
const record = operation => {
  try { fs.appendFileSync(audit, JSON.stringify({ time: Date.now(), pid: process.pid, role: policy.role, operation }) + '\n'); } catch {}
};
record('started');
require('./authentic-editor-guard.cjs')({ ...policy, record });
process.on('exit', code => record(`exit:${code}`));
