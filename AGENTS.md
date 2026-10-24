# Astrix repository collaboration

- Reply in concise Chinese. Follow the more specific instructions in each project.
- The user wants to share the desktop app privately with selected recipients. Do not publish a public installer or deploy the web app unless requested.
- After completing and validating requested changes, commit the relevant source and documentation and push to `origin` (`https://github.com/jinny-wj/astrix-agent.git`). This is the user's standing preference. Fetch first; never force-push or overwrite unrelated work. Report the commit and any push failure honestly.
- Keep installers, generated files, account/session data, credentials, and confidential reference material out of Git. Do not copy the developer's login state into installers.

## Workbench integration

- Workbench implementation lives in `网页端/workbench/` (browser UI and local services) and `客户端/workbench/` (Electron, native editor, terminal and guards). `packages/astrix-workbench/` contains shared paths, tests and version records only; do not recreate a third application or probe an old standalone directory.
- Update both application package versions/locks and the shared package/lock, changelog and version catalog together. Preserve original Astrix desktop/web capabilities and all existing version tags.
- Keep annotated `m0/vX.Y.Z` source tags and documentation-only `m0/history/vX.Y.Z` imports immutable. Public source Releases use `--latest=false`; generated resources and recovered native components remain in restricted draft assets `m0-runtime/vX.Y.Z`.
- Run shared verification from `packages/astrix-workbench/` and the affected application tests. The publisher has an explicit cross-application allowlist; do not broaden it to the entire repository to bypass unrelated changes.
- Native recovery remains repository-root `M0-AI-recovered/`. Resource layout 2 restores browser resources to `网页端/workbench/` and desktop icons to `客户端/workbench/`; stage private application bundles only in ignored `客户端/.workbench-bundle/`.
- Development state belongs to each application's `workbench/.local-data` and `workbench/.data` directories. Preserve migrated user projects, login state, pairing credentials and model settings; local migration backups belong only in ignored `客户端/.local-archive/` and must never be published.
