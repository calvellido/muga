import { describe, expect, it } from "vitest";
import { localAccess } from "../src/radio/access.ts";

/** A Permissions API that knows `local-network-access`, in the given state, or doesn't know it. */
const permissions = (state?: PermissionState) => ({
  query: async ({ name }: PermissionDescriptor) => {
    if (state === undefined || String(name) !== "local-network-access") {
      throw new TypeError(`'${name}' is not a valid value for enumeration PermissionName.`);
    }
    return { state } as PermissionStatus;
  },
});

describe("localAccess", () => {
  it("is open from a plain HTTP page, which reaches radios like any site", async () => {
    expect(await localAccess({ protocol: "http:", permissions: permissions() })).toEqual({
      access: "open",
    });
  });

  it("follows the local network permission on a secure page in Chrome and Edge", async () => {
    for (const [state, access] of [
      ["prompt", "ask"],
      ["granted", "granted"],
      ["denied", "denied"],
    ] as const) {
      const result = await localAccess({ protocol: "https:", permissions: permissions(state) });
      expect(result.access).toBe(access);
    }
  });

  it("is blocked on a secure page in browsers without Local Network Access", async () => {
    // Safari knows neither name, and blocks plain HTTP from https pages.
    expect((await localAccess({ protocol: "https:", permissions: permissions() })).access).toBe(
      "blocked",
    );
    expect((await localAccess({ protocol: "https:" })).access).toBe("blocked");
  });

  it("is blocked in Firefox, which has the permission but no exemption from mixed content", async () => {
    const firefox = {
      query: async ({ name }: PermissionDescriptor) => {
        if (String(name) !== "local-network") throw new TypeError(`'${name}' is not valid.`);
        return { state: "granted" } as PermissionStatus;
      },
    };
    expect((await localAccess({ protocol: "https:", permissions: firefox })).access).toBe(
      "blocked",
    );
  });
});
