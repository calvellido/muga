/**
 * One semver version for the whole repository, raised by every pull request (ADR 0015).
 *
 * Usage: pnpm bump patch|minor|major           raise it everywhere and start its CHANGELOG section
 *        pnpm version:check [--base <git ref>]  exit 1 unless every package has the same version,
 *                                               its CHANGELOG section is written, and (with --base)
 *                                               it's above the version on that ref
 *        pnpm version:notes                     print its CHANGELOG section (the release notes)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const CHANGELOG = join(ROOT, "CHANGELOG.md");
/** Left in a new CHANGELOG section; the check fails until it's replaced. */
export const PLACEHOLDER = "TODO: what changed, for people using Muga.";

export type Level = "patch" | "minor" | "major";
const LEVELS: readonly Level[] = ["patch", "minor", "major"];

function parts(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`"${version}" isn't a version like 1.2.3`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function nextVersion(version: string, level: Level): string {
  const [major, minor, patch] = parts(version);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Negative when `a` is lower than `b`, 0 when equal, positive when higher. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** The text under `## <version>`, up to the next version's heading. */
export function changelogSection(changelog: string, version: string): string | undefined {
  const lines = changelog.split("\n");
  const start = lines.findIndex(
    (line) => line.split(" ")[0] === "##" && line.split(" ")[1] === version,
  );
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

/** A new section at the top, with a placeholder to replace. */
export function addChangelogSection(changelog: string, version: string, date: string): string {
  if (changelogSection(changelog, version) !== undefined) return changelog;
  const section = `## ${version} (${date})\n\n- ${PLACEHOLDER}\n\n`;
  const first = changelog.indexOf("\n## ");
  return first < 0
    ? `${changelog.trimEnd()}\n\n${section}`
    : `${changelog.slice(0, first + 1)}${section}${changelog.slice(first + 1)}`;
}

/** What's wrong with a version's CHANGELOG section, if anything. */
export function sectionProblems(section: string | undefined, version: string): string[] {
  if (section === undefined) return [`CHANGELOG.md has no "## ${version}" section.`];
  if (!section) return [`CHANGELOG.md's ${version} section is empty.`];
  if (section.includes(PLACEHOLDER))
    return [`CHANGELOG.md's ${version} section still has the TODO.`];
  return [];
}

function packageFiles(): string[] {
  const nested = ["apps", "packages"].flatMap((dir) =>
    readdirSync(join(ROOT, dir)).map((name) => join(ROOT, dir, name, "package.json")),
  );
  return [join(ROOT, "package.json"), ...nested.filter((file) => existsSync(file))];
}

const versionOf = (json: string): string => JSON.parse(json).version;

function main(argv: string[]): void {
  const [command, ...args] = argv;
  const files = packageFiles();
  const rootVersion = versionOf(readFileSync(files[0] ?? "", "utf8"));
  const changelog = readFileSync(CHANGELOG, "utf8");

  if (command === "bump") {
    const level = args[0] as Level;
    if (!LEVELS.includes(level)) throw new Error("Usage: pnpm bump patch|minor|major");
    const next = nextVersion(rootVersion, level);
    for (const file of files) {
      const json = readFileSync(file, "utf8");
      writeFileSync(file, json.replace(/"version": "[^"]*"/, `"version": "${next}"`));
    }
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(CHANGELOG, addChangelogSection(changelog, next, today));
    console.log(`${rootVersion} → ${next}. Now describe the change in CHANGELOG.md.`);
    return;
  }

  if (command === "check") {
    const problems = files
      .filter((file) => versionOf(readFileSync(file, "utf8")) !== rootVersion)
      .map((file) => `${relative(ROOT, file)} doesn't have version ${rootVersion}.`);
    problems.push(...sectionProblems(changelogSection(changelog, rootVersion), rootVersion));
    const base = args[args.indexOf("--base") + 1];
    if (args.includes("--base") && base) {
      const baseVersion = versionOf(
        execFileSync("git", ["show", `${base}:package.json`], { encoding: "utf8" }),
      );
      if (compareVersions(rootVersion, baseVersion) <= 0) {
        problems.push(
          `Version ${rootVersion} isn't above ${baseVersion} on ${base}: run \`pnpm bump patch\` (a fix) or \`pnpm bump minor\` (a feature).`,
        );
      }
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      process.exit(1);
    }
    console.log(`Version ${rootVersion} is consistent and in CHANGELOG.md.`);
    return;
  }

  if (command === "notes") {
    const section = changelogSection(changelog, rootVersion);
    if (!section) throw new Error(`CHANGELOG.md has no ${rootVersion} section.`);
    console.log(section);
    return;
  }

  throw new Error("Usage: pnpm bump patch|minor|major | pnpm version:check | pnpm version:notes");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
