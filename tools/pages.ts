/**
 * Builds the GitHub Pages site (ADR 0018): main at the root, and each stable major version that
 * stable.json lists at /<major>/, built from its release tag.
 *
 * Usage: pnpm pages:build [base path]   writes the site to ./pages
 *   The base path is "" on the site's own domain (muga.calvellido.es), or "/muga" without one.
 *
 * stable.json maps a major version to its stable release: { "1": "1.2.1" }. A version that isn't
 * tagged yet is built from this checkout, if it's the version here (the release being merged).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const SITE = join(ROOT, "pages");
const WORKTREES = join(ROOT, ".stable");

export interface StableBuild {
  major: string;
  version: string;
}

/** The stable versions stable.json lists, checked; throws on anything malformed. */
export function stableBuilds(json: string): StableBuild[] {
  const listed: unknown = JSON.parse(json);
  if (typeof listed !== "object" || listed === null || Array.isArray(listed)) {
    throw new Error('stable.json must be an object such as { "1": "1.2.1" }');
  }
  return Object.entries(listed).map(([major, version]) => {
    if (!/^[1-9]\d*$/.test(major)) throw new Error(`stable.json: "${major}" isn't a major version`);
    if (typeof version !== "string" || !new RegExp(`^${major}\\.\\d+\\.\\d+$`).test(version)) {
      throw new Error(`stable.json: ${major} must map to a ${major}.x.y version, not ${version}`);
    }
    return { major, version };
  });
}

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  execFileSync(command, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

function tagged(version: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/v${version}`], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

/** Builds the web app in `dir` for `base`, and copies it to `target`. */
function build(dir: string, base: string, target: string) {
  run("pnpm", ["web:build"], dir, { MUGA_BASE: base });
  mkdirSync(target, { recursive: true });
  cpSync(join(dir, "apps/web/dist"), target, { recursive: true });
}

function main(basePath: string) {
  const current: string = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const stable = stableBuilds(readFileSync(join(ROOT, "stable.json"), "utf8"));
  rmSync(SITE, { recursive: true, force: true });

  console.log(`main (${current}) at ${basePath}/`);
  build(ROOT, `${basePath}/`, SITE);

  for (const { major, version } of stable) {
    const base = `${basePath}/${major}/`;
    const target = join(SITE, major);
    if (tagged(version)) {
      console.log(`${version} at ${base}, from v${version}`);
      const dir = join(WORKTREES, major);
      rmSync(dir, { recursive: true, force: true });
      run("git", ["worktree", "add", "--force", "--detach", dir, `v${version}`], ROOT);
      try {
        run("pnpm", ["install", "--frozen-lockfile"], dir);
        build(dir, base, target);
      } finally {
        run("git", ["worktree", "remove", "--force", dir], ROOT);
      }
    } else if (version === current) {
      console.log(`${version} at ${base}, from this checkout (not tagged yet)`);
      build(ROOT, base, target);
    } else {
      throw new Error(`stable.json lists ${version}, but there's no v${version} tag`);
    }
  }
  if (!existsSync(join(SITE, "index.html"))) throw new Error("the site has no index.html");
  console.log(`Site written to ${SITE}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv[2] ?? "");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
