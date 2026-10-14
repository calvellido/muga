import type { Verb } from "./types.ts";

export type QueryParam = readonly [name: string, value: string];

export interface RequestTarget {
  node?: string | undefined;
  /** LIST_GET_NEXT start key; `-1` reads from the beginning. */
  startKey?: number | undefined;
  pin: string;
  sid?: string | undefined;
  params?: readonly QueryParam[] | undefined;
}

/**
 * Normalises a host, `host:port` or URL into an FSAPI base URL ending in `/fsapi`.
 * Bare hosts default to `http://<host>` on port 80, as radios serve FSAPI there.
 */
export function toBaseUrl(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, "");
  const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/fsapi";
  return url.toString().replace(/\/+$/, "");
}

/**
 * `<base>/<VERB>[/<node>[/<startKey>]]?pin=…[&sid=…][&…]`. Query values are form-encoded
 * (space as `+`), matching what the UNDOK app sends.
 */
export function buildUrl(baseUrl: string, verb: Verb, target: RequestTarget): string {
  let path = `${baseUrl}/${verb}`;
  if (target.node) path += `/${target.node}`;
  if (target.startKey !== undefined) path += `/${target.startKey}`;

  const query = new URLSearchParams();
  query.append("pin", target.pin);
  if (target.sid) query.append("sid", target.sid);
  for (const [name, value] of target.params ?? []) query.append(name, value);
  return `${path}?${query.toString()}`;
}
