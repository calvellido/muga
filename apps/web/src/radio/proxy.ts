import type { FetchLike } from "@muga/fsapi-core";

/**
 * Reaching radios through an HTTPS proxy at home (ADR 0017). Browsers that can't reach the radios'
 * plain HTTP from an https page (Safari, every browser on iPhone and iPad, Firefox) reach the
 * proxy instead, which forwards each request to the radio:
 *
 *   http://192.168.1.10/fsapi/GET/…  →  https://<proxy>/192.168.1.10/fsapi/GET/…
 *
 * It also answers `/muga-proxy` with the address ranges it reaches (docs/proxy).
 */
export const PROXY_INFO_PATH = "/muga-proxy";

export interface ProxyInfo {
  /** The address ranges it forwards to, as `192.168.1`. */
  ranges: string[];
}

/** A proxy's address as `https://host[:port]`, or undefined when it isn't an https address. */
export function proxyOrigin(input: string): string | undefined {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** `url` as it goes through `proxy`: plain-HTTP requests to an IP address are forwarded. */
export function throughProxy(url: string, proxy: string | undefined): string {
  if (!proxy) return url;
  const match = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)(\/.*)?$/.exec(url);
  if (!match) return url;
  const host = (match[1] ?? "").replace(/:80$/, "");
  return `${proxy}/${host}${match[2] ?? "/"}`;
}

/** `fetch`, sending radio requests through the proxy `proxy()` names, when it names one. */
export function proxiedFetch(fetch: FetchLike, proxy: () => string | undefined): FetchLike {
  return (url, init) => fetch(throughProxy(url, proxy()), init);
}

/** Asks `proxy` whether it's a Muga proxy, and what it reaches. Rejects when it isn't one. */
export async function readProxyInfo(
  proxy: string,
  fetch: FetchLike,
  timeoutMs = 6_000,
): Promise<ProxyInfo> {
  const response = await fetch(`${proxy}${PROXY_INFO_PATH}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200) throw new Error(`${proxy} answered HTTP ${response.status}`);
  const info: { muga?: unknown; ranges?: unknown } = JSON.parse(await response.text());
  if (info.muga !== 1) throw new Error(`${proxy} isn't a Muga proxy`);
  const ranges = Array.isArray(info.ranges) ? info.ranges : [];
  return {
    ranges: ranges.filter(
      (range): range is string =>
        typeof range === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(range),
    ),
  };
}
