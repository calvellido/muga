# 0015: Versions and releases

Date: 2026-10-17. Status: accepted.

## Context

Muga 1.0.0 was released by hand: version numbers edited, a tag pushed and a GitHub Release written. From then on every change should carry a version, so the version shown in Muga settings says exactly what an installed app runs.

## Decisions

1. **One semver version for the whole repository.** The root `package.json` and every workspace package have the same version.
2. **Every pull request raises it**, with `pnpm bump patch|minor|major`:
   - **patch:** fixes, and changes people using Muga won't notice;
   - **minor:** new features;
   - **major:** changes that break how Muga is used, or a milestone.

   `pnpm bump` sets the version in every `package.json` and starts the version's section in `CHANGELOG.md` with a TODO, to be replaced with what changed, written for people using Muga.
3. **CI checks it** (`pnpm version:check`):
   - **every pull request:** the version must be above the base branch's;
   - **always:** every package has the same version, and `CHANGELOG.md` has a section for it with the TODO replaced.
4. **Merging publishes the release.** The Release workflow runs on every push to `main`. For a version that isn't released yet, it tags the merge commit `v<version>` and publishes a GitHub Release, "Muga <version>", whose notes are the version's `CHANGELOG.md` section (`pnpm version:notes`). It uses the workflow's own token (`contents: write`), so no personal token is stored.

## Consequences

- **Pull requests open side by side** both raise the version from the same base. Whichever merges second has to be brought up to date and bumped again.
- **Tags and releases** no longer need to be made by hand.
- **The version shown in Muga settings** (`apps/web/package.json`) always matches a tag.
