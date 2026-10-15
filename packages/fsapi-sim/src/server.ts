import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  encodeByteArray,
  enumValue,
  lookupNode,
  NODE_DEFS,
  type NodeDef,
  type NodePath,
} from "@muga/fsapi-core";
import { createBehaviors, type SimState } from "./behaviors.ts";
import { DEFAULT_PROFILE, type SimListItem, type SimProfile } from "./profile.ts";

export interface SimulatorOptions {
  pin?: string;
  /** Interface to listen on. Default `127.0.0.1`; use `0.0.0.0` to expose it on the LAN. */
  host?: string;
  /** Default 0 (random free port). */
  port?: number;
  /** Merged over {@link DEFAULT_PROFILE} (per value / per list). */
  profile?: Partial<SimProfile>;
  /** How long GET_NOTIFIES is held before answering FS_TIMEOUT. Default 5000 ms. */
  notifyHoldMs?: number;
  /** When false, GET_MULTIPLE / SET_MULTIPLE answer HTTP 404 like older firmware. */
  supportsMultiple?: boolean;
  /** Apply radio-like side effects (e.g. selecting a preset changes what is playing). Default true. */
  behaviors?: boolean;
  /** How long `nav.status` reads WAITING after each navigation step. Default 0. */
  navDelayMs?: number;
}

export interface SimRequest {
  verb: string;
  node?: string;
  sid?: string;
}

export interface RadioSimulator {
  /** `http://<host>:<port>` */
  readonly url: string;
  /** `<host>:<port>`, usable as an FsapiClient host. */
  readonly host: string;
  readonly pin: string;
  readonly sessionId: string | undefined;
  /** Requests received so far (PIN omitted). */
  readonly requests: readonly SimRequest[];
  /** Wire-level value: enums as numbers, byte arrays as hex. */
  get(path: string): number | string | undefined;
  /** Sets a scalar from a decoded value (enum name, text); ignores read-only; emits a notification. */
  set(path: string, value: number | string): void;
  list(path: string): SimListItem[];
  setList(path: string, items: SimListItem[]): void;
  close(): Promise<void>;
}

type WireScalar = number | string;
type Outcome = { value: WireScalar } | { status: string };

const INT_TAGS: Record<string, string> = {
  u8: "u8",
  u16: "u16",
  u32: "u32",
  s8: "s8",
  s16: "s16",
  s32: "s32",
  e8: "u8",
};

const RANGES: Record<string, readonly [number, number]> = {
  u8: [0, 255],
  u16: [0, 65_535],
  u32: [0, 4_294_967_295],
  s8: [-128, 127],
  s16: [-32_768, 32_767],
  s32: [-2_147_483_648, 2_147_483_647],
  e8: [0, 255],
};

const encoder = new TextEncoder();

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => XML_ENTITIES[c] ?? c);
}

function valueXml(type: string, value: WireScalar | undefined): string {
  if (type === "c8") return `<c8_array>${escapeXml(String(value ?? ""))}</c8_array>`;
  if (type === "u8array") return `<array>${String(value ?? "")}</array>`;
  const tag = INT_TAGS[type] ?? "u32";
  return `<${tag}>${Number(value ?? 0)}</${tag}>`;
}

function fsapi(status: string, inner = ""): string {
  return `<fsapiResponse>\n<status>${status}</status>\n${inner}</fsapiResponse>\n`;
}

function send(res: ServerResponse, httpStatus: number, body = ""): void {
  res.writeHead(httpStatus, {
    "Content-Type": "text/xml",
    "Access-Control-Allow-Origin": "*",
    Connection: "close",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function defaultWire(def: NodeDef): WireScalar {
  if (def.type === "c8" || def.type === "u8array") return "";
  if (def.type === "e8") return Object.values(def.enum ?? {})[0] ?? 0;
  return Math.max(def.min ?? 0, 0);
}

/** Decoded value (enum names allowed) → stored wire value. Used for profiles and test setup. */
function toWire(def: NodeDef, value: WireScalar, path: string): WireScalar {
  if (def.type === "c8") return String(value);
  if (def.type === "u8array") return encodeByteArray(String(value));
  if (def.type === "e8" && typeof value === "string") {
    const n = enumValue(def, value);
    if (n === undefined) throw new Error(`${path}: unknown enum value ${value}`);
    return n;
  }
  return Number(value);
}

/** Validates a SET as a radio would (doc 09 §2): read-only → FS_PACKET_BAD, invalid → FS_FAIL. */
function acceptSet(def: NodeDef, raw: string): Outcome {
  if (def.readOnly) return { status: "FS_PACKET_BAD" };
  if (def.type === "c8") {
    const tooLong = def.maxLength !== undefined && encoder.encode(raw).length > def.maxLength - 1;
    return tooLong ? { status: "FS_FAIL" } : { value: raw };
  }
  if (def.type === "u8array") {
    return /^([0-9a-f]{2})*$/i.test(raw) ? { value: raw.toUpperCase() } : { status: "FS_FAIL" };
  }
  if (!/^-?\d+$/.test(raw)) return { status: "FS_FAIL" };
  const n = Number(raw);
  const [typeMin, typeMax] = RANGES[def.type] ?? [0, 0];
  if (n < Math.max(typeMin, def.min ?? typeMin) || n > Math.min(typeMax, def.max ?? typeMax)) {
    return { status: "FS_FAIL" };
  }
  if (def.type === "e8" && def.enum && !Object.values(def.enum).includes(n)) {
    return { status: "FS_FAIL" };
  }
  return { value: n };
}

export async function startSimulator(options: SimulatorOptions = {}): Promise<RadioSimulator> {
  const pin = options.pin ?? "1234";
  const notifyHoldMs = options.notifyHoldMs ?? 5_000;
  const supportsMultiple = options.supportsMultiple ?? true;
  const withBehaviors = options.behaviors ?? true;
  const profile: SimProfile = {
    values: { ...DEFAULT_PROFILE.values, ...options.profile?.values },
    lists: { ...DEFAULT_PROFILE.lists, ...options.profile?.lists },
    modes: { ...DEFAULT_PROFILE.modes, ...options.profile?.modes },
    missingNodes: options.profile?.missingNodes ?? DEFAULT_PROFILE.missingNodes,
  };

  const scalars = new Map<NodePath, WireScalar>();
  const lists = new Map<NodePath, SimListItem[]>();
  for (const [path, def] of Object.entries(NODE_DEFS) as [NodePath, NodeDef][]) {
    if (def.type === "list") lists.set(path, []);
    else scalars.set(path, defaultWire(def));
  }

  const resolve = (path: string) => {
    const entry = lookupNode(path);
    if (!entry) throw new Error(`Unknown node ${path}`);
    return entry;
  };
  for (const [path, value] of Object.entries(profile.values)) {
    const { path: canonical, def } = resolve(path);
    scalars.set(canonical, toWire(def, value, canonical));
  }
  for (const [path, items] of Object.entries(profile.lists)) {
    lists.set(
      resolve(path).path,
      items.map((item) => ({ ...item })),
    );
  }
  const missing = new Set(profile.missingNodes.map((p) => resolve(p).path));
  const blocked = new Set<NodePath>();

  let sessionId: string | undefined;
  const pending = new Map<NodePath, string>();
  let waiter: { res: ServerResponse; timer: NodeJS.Timeout } | undefined;
  const requests: SimRequest[] = [];
  let baseUrl = "";

  const endWaiter = (httpStatus: number, body = "") => {
    if (!waiter) return;
    const { res, timer } = waiter;
    waiter = undefined;
    clearTimeout(timer);
    send(res, httpStatus, body);
  };

  const flush = () => {
    if (!waiter || pending.size === 0) return;
    const inner = [...pending]
      .map(([path, xml]) => `<notify node="${path}"><value>${xml}</value></notify>\n`)
      .join("");
    pending.clear();
    endWaiter(200, fsapi("FS_OK", inner));
  };

  const notify = (path: NodePath, def: NodeDef) => {
    if (!sessionId || !def.notifying) return;
    pending.set(path, valueXml(def.type, scalars.get(path)));
    flush();
  };

  const state: SimState = {
    get(path) {
      const entry = lookupNode(path);
      return entry ? scalars.get(entry.path) : undefined;
    },
    set(path, value) {
      const { path: canonical, def } = resolve(path);
      if (def.type === "list") throw new Error(`${canonical} is a list; use setList`);
      scalars.set(canonical, toWire(def, value, canonical));
      notify(canonical, def);
    },
    list(path) {
      return (lists.get(resolve(path).path) ?? []).map((item) => ({ ...item }));
    },
    setList(path, items) {
      lists.set(
        resolve(path).path,
        items.map((item) => ({ ...item })),
      );
    },
    setBlocked(paths, isBlocked) {
      for (const path of paths) {
        if (isBlocked) blocked.add(resolve(path).path);
        else blocked.delete(resolve(path).path);
      }
    },
  };

  const timers = new Set<NodeJS.Timeout>();
  const behaviors = withBehaviors
    ? createBehaviors(state, {
        modes: profile.modes,
        navDelayMs: options.navDelayMs ?? 0,
        later(ms, fn) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            fn();
          }, ms);
          timers.add(timer);
        },
      })
    : undefined;

  /** Known node, implemented by this simulated model. */
  const known = (node: string | undefined) => {
    const entry = node ? lookupNode(node) : undefined;
    return entry && !missing.has(entry.path) ? entry : undefined;
  };

  const getEntryXml = (node: string): { status: string; value?: string } => {
    const entry = known(node);
    if (!entry) return { status: "FS_NODE_DOES_NOT_EXIST" };
    if (blocked.has(entry.path)) return { status: "FS_NODE_BLOCKED" };
    if (entry.def.type === "list") return { status: "FS_FAIL" };
    return { status: "FS_OK", value: valueXml(entry.def.type, scalars.get(entry.path)) };
  };

  const setEntry = (node: string, raw: string): string => {
    const entry = known(node);
    if (!entry) return "FS_NODE_DOES_NOT_EXIST";
    if (entry.def.type === "list") return "FS_FAIL";
    const outcome = acceptSet(entry.def, raw);
    if ("status" in outcome) return outcome.status;
    scalars.set(entry.path, outcome.value);
    notify(entry.path, entry.def);
    return behaviors?.apply(entry.path, outcome.value) || "FS_OK";
  };

  /** Declared fields first, then any extra ones the item carries (e.g. a preset's `url`). */
  const itemXml = (def: NodeDef, item: SimListItem) => {
    const declared = (def.fields ?? []).filter((f) => f.name.toLowerCase() !== "key");
    const names = new Set(declared.map((f) => f.name));
    const extra = Object.keys(item).filter((name) => name !== "key" && !names.has(name));
    const fields = [
      ...declared.map((f) => [f.name, valueXml(f.type, item[f.name])]),
      ...extra.map((name) => [name, valueXml("c8", item[name])]),
    ]
      .map(([name, xml]) => `<field name="${String(name).toLowerCase()}">${xml}</field>`)
      .join("");
    return `<item key="${item.key}">${fields}</item>\n`;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://sim");
    if (url.pathname === "/device") {
      const name = String(scalars.get("netRemote.sys.info.friendlyName") ?? "");
      const version = String(scalars.get("netRemote.sys.info.version") ?? "");
      return send(
        res,
        200,
        `<netRemote><friendlyName>${escapeXml(name)}</friendlyName><version>${escapeXml(version)}</version><webfsapi>${baseUrl}/fsapi</webfsapi></netRemote>\n`,
      );
    }
    const match = /^\/fsapi\/([A-Z_]+)(?:\/([^/]+))?(?:\/(-?\d+))?$/.exec(url.pathname);
    if (!match) return send(res, 404);
    const [, verb = "", node, start] = match;
    const params = url.searchParams;
    const sid = params.get("sid");
    requests.push({ verb, ...(node ? { node } : {}), ...(sid ? { sid } : {}) });

    if (params.get("pin") !== pin) return send(res, 403);
    if (sid !== null && sid !== sessionId) return send(res, 404);

    switch (verb) {
      case "GET": {
        const { status, value } = getEntryXml(node ?? "");
        return send(res, 200, fsapi(status, value ? `<value>${value}</value>\n` : ""));
      }
      case "SET":
        return send(res, 200, fsapi(setEntry(node ?? "", params.get("value") ?? "")));
      case "GET_MULTIPLE": {
        if (!supportsMultiple) return send(res, 404);
        const inner = params
          .getAll("node")
          .map((n) => {
            const { status, value } = getEntryXml(n);
            return `<fsapiResponse><node>${n}</node><status>${status}</status>${value ? `<value>${value}</value>` : ""}</fsapiResponse>\n`;
          })
          .join("");
        return send(res, 200, `<fsapiGetMultipleResponse>\n${inner}</fsapiGetMultipleResponse>\n`);
      }
      case "SET_MULTIPLE": {
        if (!supportsMultiple) return send(res, 404);
        const pairs: [string, string][] = [];
        for (const [name, value] of params) {
          if (name === "node") pairs.push([value, ""]);
          else if (name === "value" && pairs.length > 0)
            (pairs.at(-1) as [string, string])[1] = value;
        }
        const inner = pairs
          .map(
            ([n, v]) =>
              `<fsapiResponse><node>${n}</node><status>${setEntry(n, v)}</status></fsapiResponse>\n`,
          )
          .join("");
        return send(res, 200, `<fsapiSetMultipleResponse>\n${inner}</fsapiSetMultipleResponse>\n`);
      }
      case "LIST_GET_NEXT": {
        const entry = known(node);
        if (!entry) return send(res, 200, fsapi("FS_NODE_DOES_NOT_EXIST"));
        if (blocked.has(entry.path)) return send(res, 200, fsapi("FS_NODE_BLOCKED"));
        if (entry.def.type !== "list") return send(res, 200, fsapi("FS_FAIL"));
        const startKey = Number(start ?? -1);
        const maxItems = Math.max(1, Number(params.get("maxItems") ?? 20));
        const after = (lists.get(entry.path) ?? [])
          .filter((item) => item.key > startKey)
          .sort((a, b) => a.key - b.key);
        const page = after.slice(0, maxItems);
        if (page.length === 0) return send(res, 200, fsapi("FS_LIST_END"));
        const inner = page.map((item) => itemXml(entry.def, item)).join("");
        return send(
          res,
          200,
          fsapi("FS_OK", inner + (after.length <= maxItems ? "<listend/>\n" : "")),
        );
      }
      case "LIST_SET": {
        const entry = known(node);
        const key = Number(params.get("key"));
        if (entry?.def.type !== "list" || !Number.isInteger(key)) {
          return send(res, 200, fsapi("FS_FAIL"));
        }
        const items = lists.get(entry.path) ?? [];
        const item = items.find((i) => i.key === key) ?? { key };
        if (!items.includes(item)) items.push(item);
        for (const [name, value] of params) {
          if (name === "pin" || name === "sid" || name === "key") continue;
          const field = entry.def.fields?.find((f) => f.name.toLowerCase() === name.toLowerCase());
          item[field?.name ?? name] = field && field.type !== "c8" ? Number(value) : value;
        }
        lists.set(entry.path, items);
        return send(res, 200, fsapi("FS_OK"));
      }
      case "CREATE_SESSION": {
        endWaiter(404);
        pending.clear();
        sessionId = String(1_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
        return send(res, 200, fsapi("FS_OK", `<sessionId>${sessionId}</sessionId>\n`));
      }
      case "DELETE_SESSION": {
        endWaiter(404);
        pending.clear();
        sessionId = undefined;
        return send(res, 200, fsapi("FS_OK"));
      }
      case "GET_NOTIFIES": {
        if (sid === null) return send(res, 404);
        endWaiter(200, fsapi("FS_TIMEOUT"));
        waiter = {
          res,
          timer: setTimeout(() => endWaiter(200, fsapi("FS_TIMEOUT")), notifyHoldMs),
        };
        res.on("close", () => {
          if (waiter?.res === res) {
            clearTimeout(waiter.timer);
            waiter = undefined;
          }
        });
        return flush();
      }
      default:
        return send(res, 404);
    }
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => done());
  });
  const address = server.address() as AddressInfo;
  const hostname = address.family === "IPv6" ? `[${address.address}]` : address.address;
  const host = `${hostname}:${address.port}`;
  baseUrl = `http://${host}`;

  return {
    url: baseUrl,
    host,
    pin,
    get sessionId() {
      return sessionId;
    },
    requests,
    ...state,
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      endWaiter(404);
      return new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
}
