# 0018: Stable versions at numbered paths

Date: 2026-10-19. Status: accepted.

## Context

Muga 1 reached parity with UNDOK for the tested radios. New, more experimental features should keep landing at `https://muga.calvellido.es/`, which the README, the installed apps and the proxy setups point to. A version known to work should stay available next to it.

GitHub Pages serves one site, with one domain, per repository. A second domain such as `muga-1.calvellido.es` would need a second repository, which was ruled out, and so was moving to another host.

## Decisions

1. **The site's root follows `main`,** as before. Every merge deploys it (ADR 0015).
2. **Each stable major version is served at its own path:** `/1/`, later `/2/`, and so on.
   - **`stable.json`** maps a major version to its stable release, such as `{ "1": "1.2.1" }`.
   - **Promoting a release** means changing that file in a pull request.
   - **When a major version's path is outdated,** its entry can be removed, and that path disappears with the next deploy.
3. **The Pages workflow builds the whole site** (`pnpm pages:build`, `tools/pages.ts`), because Pages replaces the site on each deploy:
   - `main` is built for the root;
   - each entry of `stable.json` is built for `/<major>/` from its tag `v<version>`, in a git worktree, with that version's own lockfile;
   - a version that isn't tagged yet is built from the checkout if it's the version being merged. That's the case the first time, when the Release workflow is still tagging it.
4. **Builds at different paths keep apart, though they share one origin:**
   - **Saved data:** builds keep their data under their own keys. The root keeps `muga.<name>`, so data from before is untouched, and `/1/` uses `muga/1.<name>`. A stable version starts with no speakers, and experiments at the root can't change its data.
   - **Offline caches:** the root's service worker doesn't answer navigations to numbered paths (`navigateFallbackDenylist`), so it can't serve the root's app at `/1/` before Muga 1's own service worker is installed. Each build's service worker is scoped to its path.
   - **Installed apps:** a numbered build installs as "Muga 1", "Muga 2", and so on, with its path as the manifest's `id`, `start_url` and `scope`.
   - **Shared, as the origin is:** Chrome's local network permission (ADR 0010).
5. **The first stable version is 1.2.1,** at `/1/`. It's 1.2.0 plus the separate keys and the service worker rule, which a stable build needs too. After it, `main` starts the 2.x cycle.

## Consequences

- **A new major version means installing its app,** at its new path, and connecting the speakers there again, since its data is separate. That's accepted as the price of staying on one repository.
- **Each deploy builds every listed version,** which takes longer as the list grows. Old majors can be dropped from `stable.json`.
- **Checked on 2026-10-19,** with the built site served locally and two simulated speakers:
  - the root and `/1/` each kept their own speaker, their own data keys and their own service worker;
  - `/1/` loaded Muga 1 on its first visit, with the root's service worker already installed.
