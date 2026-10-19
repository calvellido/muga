import { describe, expect, it } from "vitest";
import { stableBuilds } from "../pages.ts";

describe("stable.json", () => {
  it("lists each major version's stable release", () => {
    expect(stableBuilds('{ "1": "1.2.1", "2": "2.4.0" }')).toEqual([
      { major: "1", version: "1.2.1" },
      { major: "2", version: "2.4.0" },
    ]);
    expect(stableBuilds("{}")).toEqual([]);
  });

  it("refuses anything that isn't a major version and one of its releases", () => {
    expect(() => stableBuilds('{ "1": "2.0.0" }')).toThrow();
    expect(() => stableBuilds('{ "v1": "1.2.1" }')).toThrow();
    expect(() => stableBuilds('{ "0": "0.1.0" }')).toThrow();
    expect(() => stableBuilds('{ "1": "1.2" }')).toThrow();
    expect(() => stableBuilds('["1.2.1"]')).toThrow();
  });
});
