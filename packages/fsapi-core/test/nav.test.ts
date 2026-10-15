import { describe, expect, it } from "vitest";
import { FsapiClient } from "../src/client.ts";
import { enableNav, isNavFailure, selectNavItem, waitForNav } from "../src/nav.ts";
import type { FetchLike } from "../src/types.ts";

const reply = (status: string, inner = "") =>
  `<fsapiResponse><status>${status}</status>${inner}</fsapiResponse>`;
const navStatus = (value: number) => reply("FS_OK", `<value><u8>${value}</u8></value>`);

/**
 * Answers GET nav.status from `statuses` (the last one repeats; "blocked" answers
 * FS_NODE_BLOCKED, as a radio does while navigation is off) and SETs from `sets`.
 */
function radio(statuses: (number | "blocked")[], sets: string[] = []) {
  const calls: string[] = [];
  const fetch: FetchLike = async (raw) => {
    const url = new URL(raw);
    const [, , verb, node] = url.pathname.split("/");
    calls.push(`${verb} ${node}${verb === "SET" ? `=${url.searchParams.get("value")}` : ""}`);
    const status = statuses.length > 1 ? statuses.shift() : statuses[0];
    const body =
      verb !== "GET"
        ? reply(sets.shift() ?? "FS_OK")
        : status === "blocked"
          ? reply("FS_NODE_BLOCKED")
          : navStatus(status ?? 2);
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
    await expect(enableNav(ready.client, FAST)).resolves.toBe("READY_ROOT");
    expect(ready.calls).toEqual(["GET netRemote.nav.status"]);

    const busy = radio([0, 1]);
    await enableNav(busy.client, FAST);
    expect(busy.calls).not.toContain("SET netRemote.nav.state=1");
  });

  it("treats a blocked nav.status as navigation being off", async () => {
    const { client, calls } = radio(["blocked", 0, 1]);
    await expect(enableNav(client, FAST)).resolves.toBe("READY");
    expect(calls).toContain("SET netRemote.nav.state=1");
  });

  it("reports where navigation settled without throwing", async () => {
    // A source without a menu (FM on an ICD2018) settles on FATAL_ERR; presets still work.
    const { client } = radio(["blocked", 3]);
    await expect(enableNav(client, FAST)).resolves.toBe("FATAL_ERR");
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
