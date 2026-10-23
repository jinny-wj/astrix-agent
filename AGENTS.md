# Astrix repository collaboration

- Reply in concise Chinese. Follow the more specific instructions in each project.
- The user wants to share the desktop app privately with selected recipients. Do not publish a public installer or deploy the web app unless requested.
- After completing and validating requested changes, commit the relevant source and documentation and push to `origin` (`https://github.com/jinny-wj/astrix-agent.git`). This is the user's standing preference. Fetch first; never force-push or overwrite unrelated work. Report the commit and any push failure honestly.
- Keep installers, generated files, account/session data, credentials, and confidential reference material out of Git. Do not copy the developer's login state into installers.

## M0 integration

- The canonical M0 project is `m0-local/` in this repository. Keep the existing Astrix desktop/web projects and their version tags intact.
- Record every M0 version in the module package and lockfile, changelog, and catalog. Commit exact source under `m0/vX.Y.Z`; documentation-only imports use `m0/history/vX.Y.Z`.
- M0 source releases use `--latest=false`. Generated resources and recovered native components remain in restricted draft assets `m0-runtime/vX.Y.Z`, never public installer releases.
- The restored runtime is repository-root `M0-AI-recovered/` and remains ignored.
