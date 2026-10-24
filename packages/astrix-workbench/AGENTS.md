# Project instructions

## Version publication

The user requires every project version to be recorded on GitHub. For each future version change:

- Update the desktop/web application versions and lockfiles plus this shared `package.json`, `package-lock.json`, `CHANGELOG.md`, and `versions/index.json` together.
- Save a version note at `versions/vX.Y.Z.md`, explaining the result, verification and remaining limits.
- Run the appropriate tests, commit the exact source, create an annotated `m0/vX.Y.Z` tag and push the commit and tag to this project's configured GitHub remote. Never force push or move an existing version tag.
- Publish a source-only GitHub Release with `--latest=false`. Generated resources and native runtime archives/checksums belong only to the restricted draft `m0-runtime/vX.Y.Z`; keep that release a draft. Use `npm run release -- --publish` after preparing the version files.
- Keep model keys, login state, local projects, sessions, `.local-data`, `.data`, diagnostics and dependencies out of commits and release attachments.
- Versions 0.1.0 through 0.5.0 were created before Git tracking. Their `m0/history/vX.Y.Z` tags contain historical documentation only, and are not source snapshots. Never relabel current code as one of those old versions.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), use CodeGraph before grep/find or reading files to understand or locate code. Prefer `codegraph_explore`; the shell equivalent is `codegraph explore "<symbols or question>"`. If `.codegraph/` does not exist, skip CodeGraph; indexing is the user's decision.
<!-- CODEGRAPH_END -->

The canonical repository is `jinny-wj/astrix-agent`. Implementation source is physically in `网页端/workbench/` and `客户端/workbench/`; this shared package is not an application. Use `layout.cjs` rather than counting relative parents. Keep generated web assets, recovered plugins, native icons, local state and private bundle staging out of Git. The publisher may include only its explicit cross-application source/configuration allowlist; the completed 0.7.0 migration grants no exception for retired application paths. Never stage unrelated repository changes, user state or local archives. Historical version-note contents and existing tags remain unchanged.
