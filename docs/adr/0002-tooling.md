# 0002: Monorepo and tooling

Date: 2026-10-14. Status: accepted.

## Decision

- **Workspace:** pnpm workspaces (`packages/*`, `apps/*`), Node ≥ 22, ESM only.
- **Language:** TypeScript 7 in strict mode, with `noUncheckedIndexedAccess`.
  - Imports use explicit `.ts` extensions.
  - Internal packages export their TypeScript sources directly (`"exports": "./src/index.ts"`). No build step is needed for tests, `tsx` or Vite.
- **Tests:** Vitest. Type-level tests use `expectTypeOf` and are enforced by `pnpm typecheck`.
- **Lint and format:** Biome (one tool, no plugin stack). This may be revisited when the React app needs `eslint-plugin-react-hooks`-level checks.
- **XML:** `fast-xml-parser`, which is isomorphic, small and needs no DOM.
- **Generated code:** `tools/gen-nodes.ts`. `pnpm check` fails if `generated/nodes.ts` is stale.
- **Frontend (next):** React + Vite + TypeScript, `react-intl` with ICU messages, English first (plan §7.6).

## Consequences

Publishing packages to npm would need a build step (`tsc` emit or a bundler). That's not needed while everything is consumed inside the monorepo.
