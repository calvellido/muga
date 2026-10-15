import { describe, expect, it } from "vitest";
import { FsapiClient } from "../src/client.ts";
import { ensureNavReady, isNavFailure, selectNavItem, waitForNav } from "../src/nav.ts";
import type { FetchLike } from "../src/types.ts";

const reply = (status: string, inner = "") =>
  `<fsapiResponse><status>${status}</status>${inner}</fsapiResponse>`;
const navStatus = (value: number) => reply("FS_OK", `<value><u8>${value}</u8></value>`);

/** Answers GET nav.status from `statuses` (the last one repeats) and SETs from `sets`. */
function radio(statuses: number[], sets: string[] = []) {
  const calls: string[] = [];
  const fetch: FetchLike = async (raw) => {
    const url = new URL(raw);
    const [, , verb, node] = url.pathname.split("/");
    calls.push(`${verb} ${node}${verb === "SET" ? `=${url.searchParams.get("value")}` : ""}`);
    const body =
      verb === "GET"
        ? navStatus(statuses.length > 1 ? (statuses.shift() as number) : (statuses[0] ?? 2))
        : reply(sets.shift() ?? "FS_OK");
    return { status: 200, text: async () => body };
  };
  return { client: new FsapiClient({ host: "192.0.2.10", fetch }), calls };
}

const FAST = { pollMs: 1, timeoutMs: 500 };

describe("nav helpers", () => {
  it("waits through WAITING until ready", async () => {
    const { client } = radio([0, 0, 1]);
    await expect(waitForNav(client, FAST)).resolves.toBe("READY");
  });

  it("fails on FAIL, as a recognisable navigation failure", async () => {
    const { client } = radio([2]);
    const error = await waitForNav(client, FAST).catch((e) => e);
    expect(isNavFailure(error)).toBe(true);
  });

  it("turns navigation on only when it isn't ready or busy", async () => {
    const ready = radio([4]);
    await ensureNavReady(ready.client, FAST);
    expect(ready.calls).toEqual(["GET netRemote.nav.status"]);

    // A FAIL right after nav.state=ON is tolerated briefly.
    const off = radio([2, 2, 0, 1]);
    await ensureNavReady(off.client, FAST);
    expect(off.calls).toContain("SET netRemote.nav.state=1");
  });

  it("retries selectItem once on FS_TRY_AGAIN", async () => {
    const { client, calls } = radio([1], ["FS_TRY_AGAIN", "FS_OK"]);
    await selectNavItem(client, 3, FAST);
    expect(calls.filter((c) => c.startsWith("SET"))).toEqual([
      "SET netRemote.nav.action.selectItem=3",
      "SET netRemote.nav.action.selectItem=3",
    ]);
  });
});
