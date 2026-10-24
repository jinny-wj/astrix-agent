'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// One source for development and private packaged resource paths. This package
// contains shared configuration and verification, not a third application.
function getLayout(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.env.ASTRIX_BUNDLE_ROOT || path.join(__dirname, '../..'));
  const sharedRoot = path.join(repositoryRoot, 'packages', 'astrix-workbench');
  const webRoot = path.join(repositoryRoot, '网页端', 'workbench');
  const desktopRoot = path.join(repositoryRoot, '客户端', 'workbench');
  const recoveryRoot = path.resolve(options.recoveryRoot || process.env.ASTRIX_RECOVERY_ROOT || path.join(repositoryRoot, 'M0-AI-recovered'));
  const publicRoot = path.resolve(options.publicRoot || process.env.ASTRIX_PUBLIC_ROOT || path.join(webRoot, 'public'));
  const legacyRoot = path.join(repositoryRoot, 'm0-local');
  const version = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'package.json'), 'utf8')).version;
  return {repositoryRoot, sharedRoot, webRoot, desktopRoot, recoveryRoot, publicRoot, legacyRoot, version};
}

function getStatePaths({surface = 'web', profile = 'electron', packaged = false, userData, layout = getLayout()} = {}) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profile)) throw Error('Invalid local profile name');
  const legacyData = path.join(layout.legacyRoot, '.local-data');
  const legacyProfile = path.join(layout.legacyRoot, '.data', profile);
  const base = path.resolve(process.env.ASTRIX_STATE_ROOT || userData || (packaged
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Astrix', 'workbench')
    : surface === 'desktop' ? layout.desktopRoot : layout.webRoot));
  const dataDir = path.resolve(process.env.ASTRIX_DATA_DIR || process.env.M0_LOCAL_DATA_DIR ||
    (surface === 'desktop' && !packaged && !process.env.ASTRIX_STATE_ROOT && fs.existsSync(legacyData) ? legacyData : path.join(base, '.local-data')));
  const profileDir = path.resolve(process.env.ASTRIX_PROFILE_ROOT
    ? path.join(process.env.ASTRIX_PROFILE_ROOT, profile)
    : surface === 'desktop' && !packaged && !process.env.ASTRIX_STATE_ROOT && fs.existsSync(legacyProfile) ? legacyProfile : path.join(base, '.data', profile));
  const workspaceRoot = path.resolve(process.env.ASTRIX_WORKSPACE || process.env.M0_LOCAL_WORKSPACE || path.join(dataDir, 'workspace'));
  return {base, dataDir, profileDir, workspaceRoot, diagnosticsDir: path.resolve(process.env.ASTRIX_DIAGNOSTICS_DIR || path.join(base, 'diagnostics'))};
}

module.exports = {getLayout, getStatePaths};
