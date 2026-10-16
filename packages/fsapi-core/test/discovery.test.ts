import { describe, expect, it } from "vitest";
import { probeRadio, scanForRadios, subnetHosts, subnetOf } from "../src/discovery.ts";
import type { FetchLike } from "../src/types.ts";

const device = (name: string) =>
  `<netRemote><friendlyName>${name}</friendlyName><version>V2.13</version><webfsapi>http://x/fsapi</webfsapi></netRemote>`;
const ok = (value: string) =>
  `<fsapiResponse><status>FS_OK</status><value><c8_array>${value}</c8_array></value></fsapiResponse>`;

/** Radios by address: what each answers. Anything else fails like an empty address. */
function network(
  radios: Record<string, { name?: string; id?: string; pin?: string; noDevice?: boolean }>,
) {
  const asked: string[] = [];
  const fetch: FetchLike = async (raw) => {
    const url = new URL(raw);
    asked.push(`${url.host}${url.pathname}`);
    const radio = radios[url.host];
    if (!radio) throw new TypeError("Failed to fetch");
    if (url.pathname === "/device") {
      return radio.noDevice
        ? { status: 404, text: async () => "" }
        : { status: 200, text: async () => device(radio.name ?? "") };
    }
    if (url.searchParams.get("pin") !== (radio.pin ?? "1234")) {
      return { status: 403, text: async () => "403 Error" };
    }
    const node = url.pathname.split("/").at(-1);
    return {
      status: 200,
      text: async () =>
        ok(node === "netRemote.sys.info.radioId" ? (radio.id ?? "") : (radio.name ?? "")),
    };
  };
  return { fetch, asked };
}

describe("discovery", () => {
  it("knows private /24 ranges", () => {
    expect(subnetOf("192.168.1.57")).toBe("192.168.1");
    expect(subnetOf("http://10.0.0.8:80/fsapi")).toBe("10.0.0");
    expect(subnetOf("172.20.4.9:2244")).toBe("172.20.4");
    expect(subnetOf("8.8.8.8")).toBeUndefined();
    expect(subnetOf("Kitchen.local")).toBeUndefined();
    const hosts = subnetHosts("192.168.1");
    expect([hosts.length, hosts[0], hosts.at(-1)]).toEqual([254, "192.168.1.1", "192.168.1.254"]);
  });

  it("recognises a radio, one with another PIN, and one without a device document", async () => {
    const { fetch } = network({
      "192.0.2.10": { name: "Kitchen", id: "002261AABBCC" },
      "192.0.2.11": { name: "Study", pin: "4321" },
      "192.0.2.12": { name: "Attic", id: "002261DDEEFF", noDevice: true },
    });
    await expect(probeRadio("192.0.2.10", { fetch })).resolves.toEqual({
      host: "192.0.2.10",
      name: "Kitchen",
      version: "V2.13",
      radioId: "002261AABBCC",
      pinRequired: false,
    });
    await expect(probeRadio("192.0.2.11", { fetch })).resolves.toMatchObject({
      name: "Study",
      radioId: undefined,
      pinRequired: true,
    });
    await expect(probeRadio("192.0.2.12", { fetch })).resolves.toMatchObject({
      name: "Attic",
      radioId: "002261DDEEFF",
    });
    await expect(probeRadio("192.0.2.13", { fetch })).resolves.toBeUndefined();
  });

  it("scans addresses a few at a time, reporting progress, and can stop at a radio", async () => {
    const { fetch, asked } = network({
      "192.0.2.3": { name: "Kitchen", id: "A" },
      "192.0.2.7": { name: "Study", id: "B" },
    });
    const hosts = Array.from({ length: 10 }, (_, i) => `192.0.2.${i + 1}`);
    const progress: number[] = [];
    const found = await scanForRadios(hosts, {
      fetch,
      concurrency: 3,
      onProgress: (done) => progress.push(done),
    });
    expect(found.map((r) => r.name).sort()).toEqual(["Kitchen", "Study"]);
    expect(progress.at(-1)).toBe(10);

    asked.length = 0;
    const first = await scanForRadios(hosts, {
      fetch,
      concurrency: 1,
      until: (r) => r.radioId === "A",
    });
    expect(first.map((r) => r.name)).toEqual(["Kitchen"]);
    // Stopped at the third address.
    expect(asked.filter((a) => a.endsWith("/device"))).toHaveLength(3);
  });
});
