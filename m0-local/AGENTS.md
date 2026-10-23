# Project instructions

## Version publication

The user requires every project version to be recorded on GitHub. For each future version change:

- Update `package.json`, the root package entries in `package-lock.json`, `CHANGELOG.md`, and `versions/index.json` together.
- Save a version note at `versions/vX.Y.Z.md`, explaining the result, verification and remaining limits.
- Run the appropriate tests, commit the exact source, create an annotated `m0/vX.Y.Z` tag and push the commit and tag to this project's configured GitHub remote. Never force push or move an existing version tag.
- Publish a source-only GitHub Release with `--latest=false`. Generated resources and native runtime archives/checksums belong only to the restricted draft `m0-runtime/vX.Y.Z`; keep that release a draft. Use `npm run release -- --publish` after preparing the version files.
- Keep model keys, login state, local projects, sessions, `.local-data`, `.data`, diagnostics and dependencies out of commits and release attachments.
- Versions 0.1.0 through 0.5.0 were created before Git tracking. Their `m0/history/vX.Y.Z` tags contain historical documentation only, and are not source snapshots. Never relabel current code as one of those old versions.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), use CodeGraph before grep/find or reading files to understand or locate code. Prefer `codegraph_explore`; the shell equivalent is `codegraph explore "<symbols or question>"`. If `.codegraph/` does not exist, skip CodeGraph; indexing is the user's decision.
<!-- CODEGRAPH_END -->

The canonical repository is `jinny-wj/astrix-agent`, this module lives in `m0-local/`. Keep `public/`, `plugins/recovered/`, `frontend-tools/extra-assets/`, `desktop/icon.icns` and `resources-manifest.json` out of public Git. Limit staging to this module; refuse unrelated dirty Astrix files.
