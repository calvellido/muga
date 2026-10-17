import { describe, expect, it } from "vitest";
import {
  addChangelogSection,
  changelogSection,
  compareVersions,
  nextVersion,
  PLACEHOLDER,
  sectionProblems,
} from "../version.ts";

const CHANGELOG = `# Changelog

## 1.1.0 (2026-10-20)

- Check for updates.

## 1.0.0 (2026-10-16)

The first release.

### Listening

- Now playing.
`;

describe("versions", () => {
  it("raises the right part, and resets the ones after it", () => {
    expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
    expect(() => nextVersion("1.2", "patch")).toThrow();
  });

  it("compares numerically, part by part", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });
});

describe("CHANGELOG.md", () => {
  it("finds a version's section, up to the next version", () => {
    expect(changelogSection(CHANGELOG, "1.1.0")).toBe("- Check for updates.");
    expect(changelogSection(CHANGELOG, "1.0.0")).toBe(
      "The first release.\n\n### Listening\n\n- Now playing.",
    );
    expect(changelogSection(CHANGELOG, "1.0.1")).toBeUndefined();
  });

  it("starts a new section at the top, with a placeholder the check refuses", () => {
    const updated = addChangelogSection(CHANGELOG, "1.1.1", "2026-10-21");
    expect(updated.startsWith("# Changelog\n\n## 1.1.1 (2026-10-21)\n\n- TODO")).toBe(true);
    expect(changelogSection(updated, "1.1.0")).toBe("- Check for updates.");
    expect(addChangelogSection(updated, "1.1.1", "2026-10-22")).toBe(updated);

    const section = changelogSection(updated, "1.1.1");
    expect(section).toBe(`- ${PLACEHOLDER}`);
    expect(sectionProblems(section, "1.1.1")).toHaveLength(1);
    expect(sectionProblems("- Fixed the clock.", "1.1.1")).toEqual([]);
    expect(sectionProblems(undefined, "1.1.1")).toHaveLength(1);
    expect(sectionProblems("", "1.1.1")).toHaveLength(1);
  });
});
