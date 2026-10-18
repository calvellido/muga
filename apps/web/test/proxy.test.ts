import type { FetchLike } from "@muga/fsapi-core";
import { describe, expect, it } from "vitest";
import { SpeakerFinder } from "../src/radio/finder.ts";
import { proxyOrigin, readProxyInfo, throughProxy } from "../src/radio/proxy.ts";

const PROXY = "https://radios.example.com";

describe("throughProxy", () => {
  it("forwards plain-HTTP requests to an IP address, keeping the path and query", () => {
    expect(throughProxy("http://192.0.2.10/fsapi/GET/netRemote.sys.power?pin=1234", PROXY)).toBe(
      `${PROXY}/192.0.2.10/fsapi/GET/netRemote.sys.power?pin=1234`,
    );
    expect(throughProxy("http://192.0.2.10:80/device", PROXY)).toBe(`${PROXY}/192.0.2.10/device`);
    expect(throughProxy("http://192.0.2.10:8099/device", PROXY)).toBe(
      `${PROXY}/192.0.2.10:8099/device`,
    );
  });

  it("leaves everything else as it is", () => {
    expect(throughProxy("http://192.0.2.10/device", undefined)).toBe("http://192.0.2.10/device");
    expect(throughProxy("http://kitchen.local/device", PROXY)).toBe("http://kitchen.local/device");
    expect(throughProxy(`${PROXY}/muga-proxy`, PROXY)).toBe(`${PROXY}/muga-proxy`);
    expect(throughProxy("https://192.0.2.10/fsapi", PROXY)).toBe("https://192.0.2.10/fsapi");
  });
});

describe("proxyOrigin", () => {
  it("keeps an https address's origin, and refuses anything else", () => {
    expect(proxyOrigin(" https://radios.example.com/some/path ")).toBe(PROXY);
    expect(proxyOrigin("https://radios.example.com:8443")).toBe("https://radios.example.com:8443");
    expect(proxyOrigin("http://radios.example.com")).toBeUndefined();
    expect(proxyOrigin("radios.example.com")).toBeUndefined();
  });
});

describe("readProxyInfo", () => {
  const answering =
    (status: number, body: string): FetchLike =>
    async () => ({ status, text: async () => body });

  it("reads the ranges a Muga proxy reaches", async () => {
    const fetch = answering(200, '{"muga":1,"ranges":["192.168.1","nonsense",4]}');
    expect(await readProxyInfo(PROXY, fetch)).toEqual({ ranges: ["192.168.1"] });
  });

  it("rejects anything that isn't a Muga proxy", async () => {
    await expect(readProxyInfo(PROXY, answering(404, ""))).rejects.toThrow();
    await expect(readProxyInfo(PROXY, answering(200, "<html>"))).rejects.toThrow();
    await expect(readProxyInfo(PROXY, answering(200, '{"ranges":[]}'))).rejects.toThrow();
  });
});

describe("Find speakers through a proxy", () => {
  it("looks where the proxy says, without guessing the network", async () => {
    const asked: string[] = [];
    const fetch: FetchLike = async (url) => {
      asked.push(url);
      throw new TypeError("Failed to fetch");
    };
    const finder = new SpeakerFinder(
      { radios: () => [] },
      {
        fetch,
        timeoutMs: 50,
        concurrency: 64,
        proxyRanges: async () => ["192.0.2"],
        answers: async () => {
          throw new Error("no router check through a proxy");
        },
      },
    );
    await finder.scan();
    expect(finder.getSnapshot()).toMatchObject({ subnets: ["192.0.2"], total: 254 });
    expect(asked.every((url) => url.startsWith("http://192.0.2."))).toBe(true);
  });
});
