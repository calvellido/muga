import { describe, expect, it } from "vitest";
import { storageKey } from "../src/scope.ts";

describe("storageKey", () => {
  it("keeps the root's keys, and gives each other path its own", () => {
    expect(storageKey("radios.v1", "/")).toBe("muga.radios.v1");
    expect(storageKey("radios.v1", "/1/")).toBe("muga/1.radios.v1");
    expect(storageKey("radios.v1", "/2/")).toBe("muga/2.radios.v1");
    expect(storageKey("radios.v1", "/muga/1/")).toBe("muga/muga/1.radios.v1");
  });

  it("uses the build's own path by default (the root, in tests)", () => {
    expect(storageKey("preferences.v1")).toBe("muga.preferences.v1");
  });
});
