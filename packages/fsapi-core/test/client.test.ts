import { describe, expect, it } from "vitest";
import { FsapiClient } from "../src/client.ts";
import type { FetchLike } from "../src/types.ts";

interface Route {
  status?: number;
  body?: string;
  /** Never resolves (until aborted). */
  hang?: boolean;
}

/** A fetch stand-in that answers by verb and records the URLs it was called with. */
function fakeFetch(routes: Record<string, Route | ((url: URL) => Route)>) {
  const calls: URL[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch: FetchLike = async (raw, { signal }) => {
    const url = new URL(raw);
    calls.push(url);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const verb = url.pathname.split("/")[2] ?? "";
      const entry = routes[verb];
      const route = typeof entry === "function" ? entry(url) : entry;
      if (!route) return { status: 404, text: async () => "" };
      if (route.hang) {
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        );
      }
      await new Promise((r) => setTimeout(r, 5));
      return { status: route.status ?? 200, text: async () => route.body ?? "" };
    } finally {
      inFlight--;
    }
  };
  return { fetch, calls, maxInFlight: () => maxInFlight };
}

const ok = (inner: string) => `<fsapiResponse><status>FS_OK</status>${inner}</fsapiResponse>`;

describe("FsapiClient", () => {
  it("reads and decodes typed values", async () => {
    const { fetch, calls } = fakeFetch({ GET: { body: ok("<value><u8>2</u8></value>") } });
    const client = new FsapiClient({ host: "192.0.2.10", fetch });
    await expect(client.get("netRemote.play.status")).resolves.toBe("PLAYING");
    expect(calls[0]?.toString()).toBe("http://192.0.2.10/fsapi/GET/netRemote.play.status?pin=1234");
  });

  it("validates locally and never sends an invalid SET", async () => {
    const { fetch, calls } = fakeFetch({ SET: { body: ok("") } });
    const client = new FsapiClient({ host: "radio", fetch });
    await expect(client.set("netRemote.sys.audio.volume", 999)).rejects.toMatchObject({
      kind: "validation",
    });
    expect(calls).toHaveLength(0);
    await client.set("netRemote.play.control", "PLAY");
    expect(calls[0]?.searchParams.get("value")).toBe("1");
  });

  it("maps HTTP 403 to a PIN error and redacts the PIN", async () => {
    const { fetch } = fakeFetch({ GET: { status: 403 } });
    const client = new FsapiClient({ host: "radio", pin: "9999", fetch });
    const error = await client.get("netRemote.sys.power").catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "pin", httpStatus: 403 });
    expect((error as { url: string }).url).toContain("pin=***");
    expect((error as { url: string }).url).not.toContain("9999");
  });

  it("maps non-OK statuses to status errors", async () => {
    const { fetch } = fakeFetch({
      SET: { body: "<fsapiResponse><status>FS_NODE_BLOCKED</status></fsapiResponse>" },
    });
    const client = new FsapiClient({ host: "radio", fetch });
    await expect(client.set("netRemote.play.control", "NEXT")).rejects.toMatchObject({
      kind: "status",
      fsStatus: "FS_NODE_BLOCKED",
      node: "netRemote.play.control",
    });
  });

  it("times out slow requests", async () => {
    const { fetch } = fakeFetch({ GET: { hang: true } });
    const client = new FsapiClient({ host: "radio", fetch, timeoutMs: 30 });
    await expect(client.get("netRemote.sys.power")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("falls back to single GETs after GET_MULTIPLE answers 404, and remembers it", async () => {
    const { fetch, calls } = fakeFetch({
      GET: (url) => ({
        body: url.pathname.endsWith("netRemote.sys.power")
          ? ok("<value><u8>1</u8></value>")
          : "<fsapiResponse><status>FS_NODE_DOES_NOT_EXIST</status></fsapiResponse>",
      }),
    });
    const client = new FsapiClient({ host: "radio", fetch });
    const result = await client.getMultiple(["netRemote.sys.power", "netRemote.sys.caps.fsdca"]);
    expect(result.values).toEqual({ "netRemote.sys.power": "ON" });
    expect(result.errors["netRemote.sys.caps.fsdca"]).toMatchObject({
      fsStatus: "FS_NODE_DOES_NOT_EXIST",
    });
    expect(client.supportsMultiple).toBe(false);

    calls.length = 0;
    await client.getMultiple(["netRemote.sys.power", "netRemote.sys.power"]);
    expect(calls.map((c) => c.pathname.split("/")[2])).toEqual(["GET", "GET"]);
  });

  it("splits GET_ and SET_MULTIPLE that would be too long for a radio", async () => {
    // Like an ICD2018: HTTP 400 once the path and query pass about 385 characters.
    const tooLong = (url: URL) => url.pathname.length + url.search.length > 385;
    const answer = (url: URL, wrap: string) => {
      if (tooLong(url)) return { status: 400 };
      const nodes = url.searchParams.getAll("node");
      const inner = nodes
        .map(
          (n) =>
            `<fsapiResponse><node>${n}</node><status>FS_OK</status><value><u8>1</u8></value></fsapiResponse>`,
        )
        .join("");
      return { body: `<${wrap}>${inner}</${wrap}>` };
    };
    const { fetch, calls } = fakeFetch({
      GET_MULTIPLE: (url) => answer(url, "fsapiGetMultipleResponse"),
      SET_MULTIPLE: (url) => answer(url, "fsapiSetMultipleResponse"),
    });
    const client = new FsapiClient({ host: "192.0.2.10", fetch });
    const volumes = [
      "netRemote.multiroom.client.volume0",
      "netRemote.multiroom.client.volume1",
      "netRemote.multiroom.client.volume2",
      "netRemote.multiroom.client.volume3",
    ] as const;
    const mutes = [
      "netRemote.multiroom.client.mute0",
      "netRemote.multiroom.client.mute1",
      "netRemote.multiroom.client.mute2",
      "netRemote.multiroom.client.mute3",
    ] as const;
    const nodes = [
      "netRemote.multiroom.group.masterVolume",
      ...volumes,
      ...mutes,
      "netRemote.sys.power",
    ] as const;

    const result = await client.getMultiple(nodes);
    expect(Object.keys(result.values)).toHaveLength(nodes.length);
    expect(result.errors).toEqual({});
    expect(calls.length).toBe(2);
    expect(calls.every((url) => !tooLong(url))).toBe(true);

    calls.length = 0;
    const errors = await client.setMultiple(mutes.map((path) => [path, "MUTE"] as const));
    expect(errors).toEqual({});
    expect(calls.every((url) => !tooLong(url))).toBe(true);
    expect(calls.flatMap((url) => url.searchParams.getAll("node"))).toEqual(mutes);
  });

  it("serialises requests per radio by default", async () => {
    const { fetch, maxInFlight } = fakeFetch({ GET: { body: ok("<value><u8>1</u8></value>") } });
    const client = new FsapiClient({ host: "radio", fetch });
    await Promise.all(Array.from({ length: 5 }, () => client.get("netRemote.sys.power")));
    expect(maxInFlight()).toBe(1);
  });

  it("sends queued requests with the PIN in force when they leave the queue", async () => {
    const { fetch, calls } = fakeFetch({ GET: { body: ok("<value><u8>1</u8></value>") } });
    const client = new FsapiClient({ host: "radio", fetch });
    const first = client.get("netRemote.sys.power");
    const second = client.get("netRemote.sys.power");
    client.pin = "4321";
    await Promise.all([first, second]);
    expect(calls.map((url) => url.searchParams.get("pin"))).toEqual(["1234", "4321"]);
  });

  it("does not queue the notification long-poll behind normal requests", async () => {
    const { fetch } = fakeFetch({
      GET_NOTIFIES: { hang: true },
      GET: { body: ok("<value><u8>1</u8></value>") },
    });
    const client = new FsapiClient({ host: "radio", fetch, notifyTimeoutMs: 1_000 });
    const controller = new AbortController();
    const poll = client.getNotifies("1", { signal: controller.signal }).catch((e: unknown) => e);
    await expect(client.get("netRemote.sys.power")).resolves.toBe("ON");
    controller.abort();
    await expect(poll).resolves.toMatchObject({ kind: "aborted" });
  });

  it("treats FS_TIMEOUT on GET_NOTIFIES as no changes", async () => {
    const { fetch } = fakeFetch({
      GET_NOTIFIES: { body: "<fsapiResponse><status>FS_TIMEOUT</status></fsapiResponse>" },
    });
    const client = new FsapiClient({ host: "radio", fetch });
    await expect(client.getNotifies("1")).resolves.toEqual([]);
  });
});
