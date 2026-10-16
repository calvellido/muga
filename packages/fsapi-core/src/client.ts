import {
  type ListItem,
  type ListPath,
  lookupNode,
  type NodePath,
  type NodeValue,
  requireNode,
  type ScalarPath,
  type SetInput,
  type WritablePath,
} from "./catalog.ts";
import { decodeListItem, decodeScalar, encodeScalar, type ScalarValue } from "./codec.ts";
import { FsapiError, isFsapiError, redactPin } from "./errors.ts";
import { RequestQueue } from "./queue.ts";
import type { FetchLike, Verb, WireListItem, WireValue } from "./types.ts";
import { buildUrl, type QueryParam, type RequestTarget, toBaseUrl } from "./url.ts";
import {
  type DeviceDocument,
  type FsapiResponse,
  parseDeviceDocument,
  parseMultipleResponse,
  parseResponse,
} from "./xml.ts";

export const DEFAULT_PIN = "1234";

export interface FsapiClientOptions {
  /** `192.0.2.10`, `host:2244`, or a full FSAPI base URL. */
  host: string;
  pin?: string;
  fetch?: FetchLike;
  /** Per-request timeout. UNDOK uses 10 s. */
  timeoutMs?: number;
  /** GET_NOTIFIES long-poll timeout. UNDOK uses 40 s. */
  notifyTimeoutMs?: number;
  /** Concurrent requests per radio (the notification long-poll is not counted). */
  maxConcurrent?: number;
  /**
   * Longest path and query a GET_/SET_MULTIPLE may use; longer ones are split into several
   * requests. Radios answer HTTP 400 past about 385 characters (a 400-byte request line, seen on
   * an ICD2018, an SMRS30A1 and a Ruark MRx). Default 360.
   */
  maxRequestLength?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ListPage<T> {
  items: T[];
  listEnd: boolean;
}

export interface MultipleResult<P extends ScalarPath> {
  values: Partial<{ [K in P]: NodeValue<K> }>;
  errors: Partial<Record<P, FsapiError>>;
}

export interface Notification {
  /** Node name as sent by the radio. */
  node: string;
  /** Canonical catalog path, when the node is known. */
  path?: NodePath;
  value: ScalarValue;
  wire: WireValue;
}

interface SendOptions extends RequestOptions {
  timeoutMs?: number;
  queued?: boolean;
}

function expectOk(response: FsapiResponse, node?: string): void {
  if (response.status !== "FS_OK") {
    throw new FsapiError("status", `${node ?? "Request"} failed with ${response.status}`, {
      fsStatus: response.status,
      ...(node ? { node } : {}),
    });
  }
}

export class FsapiClient {
  readonly baseUrl: string;
  pin: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly notifyTimeoutMs: number;
  private readonly queue: RequestQueue;
  private readonly maxRequestLength: number;
  private multipleVerbs = true;

  constructor(options: FsapiClientOptions) {
    this.baseUrl = toBaseUrl(options.host);
    this.pin = options.pin ?? DEFAULT_PIN;
    this.fetchFn = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.notifyTimeoutMs = options.notifyTimeoutMs ?? 40_000;
    this.queue = new RequestQueue(options.maxConcurrent ?? 1);
    this.maxRequestLength = options.maxRequestLength ?? 360;
  }

  /** False once the radio answered GET_/SET_MULTIPLE with 404; single requests are used after that. */
  get supportsMultiple(): boolean {
    return this.multipleVerbs;
  }

  // Scalars

  async getRaw(node: string, options: RequestOptions = {}): Promise<WireValue> {
    const response = parseResponse(await this.send("GET", { node }, options));
    expectOk(response, node);
    if (!response.value) throw new FsapiError("parse", `GET ${node} returned no <value>`, { node });
    return response.value;
  }

  async get<P extends ScalarPath>(path: P, options: RequestOptions = {}): Promise<NodeValue<P>> {
    const { def } = requireNode(path);
    return decodeScalar(def, await this.getRaw(path, options), path) as NodeValue<P>;
  }

  async setRaw(node: string, value: string, options: RequestOptions = {}): Promise<void> {
    const xml = await this.send("SET", { node, params: [["value", value]] }, options);
    expectOk(parseResponse(xml), node);
  }

  async set<P extends WritablePath>(
    path: P,
    value: SetInput<P>,
    options: RequestOptions = {},
  ): Promise<void> {
    const { def } = requireNode(path);
    await this.setRaw(path, encodeScalar(def, value, path), options);
  }

  // Multiple

  /**
   * Results keyed by the requested node name. Per-node FS_* failures are returned, not thrown.
   * Long node lists go out as several requests (see `maxRequestLength`).
   */
  async getMultipleRaw(
    nodes: readonly string[],
    options: RequestOptions = {},
  ): Promise<Map<string, WireValue | FsapiError>> {
    const results = new Map<string, WireValue | FsapiError>();
    if (this.multipleVerbs && nodes.length > 1) {
      try {
        for (const batch of this.batches("GET_MULTIPLE", nodes, (node) => [["node", node]])) {
          const params = batch.map((node): QueryParam => ["node", node]);
          const xml = await this.send("GET_MULTIPLE", { params }, options);
          const byLower = new Map(parseMultipleResponse(xml).map((e) => [e.node.toLowerCase(), e]));
          for (const node of batch) {
            const entry = byLower.get(node.toLowerCase());
            if (entry?.status === "FS_OK" && entry.value) results.set(node, entry.value);
            else {
              const fsStatus = entry?.status ?? "FS_NODE_DOES_NOT_EXIST";
              results.set(
                node,
                new FsapiError("status", `${node} failed with ${fsStatus}`, { fsStatus, node }),
              );
            }
          }
        }
        return results;
      } catch (error) {
        if (!isFsapiError(error, "not-found")) throw error;
        this.multipleVerbs = false;
      }
    }
    for (const node of nodes) {
      try {
        results.set(node, await this.getRaw(node, options));
      } catch (error) {
        if (!isFsapiError(error, "status")) throw error;
        results.set(node, error);
      }
    }
    return results;
  }

  async getMultiple<P extends ScalarPath>(
    paths: readonly P[],
    options: RequestOptions = {},
  ): Promise<MultipleResult<P>> {
    const raw = await this.getMultipleRaw(paths, options);
    const result: MultipleResult<P> = { values: {}, errors: {} };
    for (const path of paths) {
      const entry = raw.get(path);
      if (entry instanceof FsapiError) result.errors[path] = entry;
      else if (entry) {
        try {
          result.values[path] = decodeScalar(requireNode(path).def, entry, path) as NodeValue<P>;
        } catch (error) {
          if (!isFsapiError(error)) throw error;
          result.errors[path] = error;
        }
      }
    }
    return result;
  }

  /** Writes several nodes; returns per-node failures (empty when everything succeeded). */
  async setMultiple(
    entries: readonly (readonly [WritablePath, ScalarValue])[],
    options: RequestOptions = {},
  ): Promise<Partial<Record<WritablePath, FsapiError>>> {
    const encoded = entries.map(([path, value]) => {
      const { def } = requireNode(path);
      return [path, encodeScalar(def, value, path)] as const;
    });
    const errors: Partial<Record<WritablePath, FsapiError>> = {};
    if (this.multipleVerbs && encoded.length > 1) {
      try {
        const toParams = ([node, value]: (typeof encoded)[number]): QueryParam[] => [
          ["node", node],
          ["value", value],
        ];
        for (const batch of this.batches("SET_MULTIPLE", encoded, toParams)) {
          const xml = await this.send("SET_MULTIPLE", { params: batch.flatMap(toParams) }, options);
          const byLower = new Map(parseMultipleResponse(xml).map((r) => [r.node.toLowerCase(), r]));
          for (const [path] of batch) {
            const fsStatus = byLower.get(path.toLowerCase())?.status ?? "FS_FAIL";
            if (fsStatus !== "FS_OK") {
              errors[path] = new FsapiError("status", `${path} failed with ${fsStatus}`, {
                fsStatus,
                node: path,
              });
            }
          }
        }
        return errors;
      } catch (error) {
        if (!isFsapiError(error, "not-found")) throw error;
        this.multipleVerbs = false;
      }
    }
    for (const [path, value] of encoded) {
      try {
        await this.setRaw(path, value, options);
      } catch (error) {
        if (!isFsapiError(error, "status")) throw error;
        errors[path] = error;
      }
    }
    return errors;
  }

  // Lists

  async listGetNextRaw(
    node: string,
    startKey = -1,
    maxItems = 20,
    options: RequestOptions = {},
  ): Promise<ListPage<WireListItem>> {
    const params: QueryParam[] = [["maxItems", String(maxItems)]];
    const response = parseResponse(
      await this.send("LIST_GET_NEXT", { node, startKey, params }, options),
    );
    if (response.status === "FS_LIST_END") return { items: [], listEnd: true };
    expectOk(response, node);
    return { items: response.items, listEnd: response.listEnd };
  }

  async listGetNext<P extends ListPath>(
    path: P,
    {
      startKey = -1,
      maxItems = 20,
      signal,
    }: { startKey?: number; maxItems?: number } & RequestOptions = {},
  ): Promise<ListPage<ListItem<P>>> {
    const { def } = requireNode(path);
    const page = await this.listGetNextRaw(path, startKey, maxItems, signal ? { signal } : {});
    return {
      items: page.items.map((item) => decodeListItem(def, item, path) as ListItem<P>),
      listEnd: page.listEnd,
    };
  }

  /** Pages through a list from the start; each page starts after the last key received. */
  async *listAll<P extends ListPath>(
    path: P,
    {
      pageSize = 20,
      limit = Number.POSITIVE_INFINITY,
      signal,
    }: { pageSize?: number; limit?: number } & RequestOptions = {},
  ): AsyncGenerator<ListItem<P>> {
    const { def } = requireNode(path);
    let startKey = -1;
    let count = 0;
    while (count < limit) {
      const maxItems = Math.min(pageSize, limit - count);
      const page = await this.listGetNextRaw(path, startKey, maxItems, signal ? { signal } : {});
      for (const item of page.items) {
        yield decodeListItem(def, item, path) as ListItem<P>;
        if (++count >= limit) return;
      }
      const last = page.items.at(-1);
      if (page.listEnd || !last || last.key <= startKey) return;
      startKey = last.key;
    }
  }

  async listAllItems<P extends ListPath>(
    path: P,
    options: { pageSize?: number; limit?: number } & RequestOptions = {},
  ): Promise<ListItem<P>[]> {
    const items: ListItem<P>[] = [];
    for await (const item of this.listAll(path, options)) items.push(item);
    return items;
  }

  /** LIST_SET (used for preset reordering): `?key=<key>&<name>=<value>…`. */
  async listSet(
    node: string,
    key: number,
    fields: Readonly<Record<string, string | number>>,
    options: RequestOptions = {},
  ): Promise<void> {
    const params: QueryParam[] = [
      ["key", String(key)],
      ...Object.entries(fields).map(([name, value]): QueryParam => [name, String(value)]),
    ];
    expectOk(parseResponse(await this.send("LIST_SET", { node, params }, options)), node);
  }

  // Sessions and notifications

  /** Creates a session. The radio keeps only one; this ends any other controller's session. */
  async createSession(options: RequestOptions = {}): Promise<string> {
    const response = parseResponse(await this.send("CREATE_SESSION", {}, options));
    expectOk(response, "CREATE_SESSION");
    if (!response.sessionId) throw new FsapiError("parse", "CREATE_SESSION returned no sessionId");
    return response.sessionId;
  }

  async deleteSession(sid?: string, options: RequestOptions = {}): Promise<void> {
    expectOk(parseResponse(await this.send("DELETE_SESSION", { sid }, options)), "DELETE_SESSION");
  }

  /**
   * One long-poll. Resolves with the changes since the last call, or `[]` when the radio
   * answers FS_TIMEOUT. Rejects with `not-found` when the session is no longer valid.
   */
  async getNotifies(sid: string, options: RequestOptions = {}): Promise<Notification[]> {
    const xml = await this.send(
      "GET_NOTIFIES",
      { sid },
      { ...options, timeoutMs: this.notifyTimeoutMs, queued: false },
    );
    const response = parseResponse(xml);
    if (response.status === "FS_TIMEOUT") return [];
    expectOk(response, "GET_NOTIFIES");
    return response.notifications.map(({ node, value: wire }) => {
      const entry = lookupNode(node);
      if (!entry || entry.def.type === "list") return { node, value: wire.text, wire };
      return { node, path: entry.path, value: decodeScalar(entry.def, wire, node), wire };
    });
  }

  // Device document

  /** Fetches `http://<radio>/device` (no PIN), which advertises the FSAPI base URL. */
  async getDeviceDocument(options: RequestOptions = {}): Promise<DeviceDocument> {
    const url = `${new URL(this.baseUrl).origin}/device`;
    const xml = await this.queue.run(() => this.fetchText(url, this.timeoutMs, options.signal));
    return parseDeviceDocument(xml);
  }

  // Transport

  /** Splits items into requests whose path and query fit in `maxRequestLength`. */
  private batches<T>(verb: Verb, items: readonly T[], toParams: (item: T) => QueryParam[]): T[][] {
    const length = (batch: readonly T[]) => {
      const url = new URL(
        buildUrl(this.baseUrl, verb, { pin: this.pin, params: batch.flatMap(toParams) }),
      );
      return url.pathname.length + url.search.length;
    };
    const out: T[][] = [];
    let current: T[] = [];
    for (const item of items) {
      if (current.length > 0 && length([...current, item]) > this.maxRequestLength) {
        out.push(current);
        current = [];
      }
      current.push(item);
    }
    if (current.length > 0) out.push(current);
    return out;
  }

  private send(
    verb: Verb,
    target: Omit<RequestTarget, "pin">,
    options: SendOptions = {},
  ): Promise<string> {
    const url = buildUrl(this.baseUrl, verb, { ...target, pin: this.pin });
    const run = () =>
      this.fetchText(url, options.timeoutMs ?? this.timeoutMs, options.signal, target.node);
    return options.queued === false ? run() : this.queue.run(run);
  }

  private async fetchText(
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
    node?: string,
  ): Promise<string> {
    const details = { url: redactPin(url), ...(node ? { node } : {}) };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const transportError = (cause: unknown) =>
      timedOut
        ? new FsapiError("timeout", `No reply within ${timeoutMs} ms`, { ...details, cause })
        : signal?.aborted
          ? new FsapiError("aborted", "Request aborted", { ...details, cause })
          : new FsapiError("network", "Radio unreachable", { ...details, cause });

    try {
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await this.fetchFn(url, { signal: controller.signal });
      } catch (cause) {
        throw transportError(cause);
      }
      const httpStatus = response.status;
      if (httpStatus === 403) {
        throw new FsapiError("pin", "The radio rejected the PIN (HTTP 403)", {
          ...details,
          httpStatus,
        });
      }
      if (httpStatus === 404) {
        throw new FsapiError(
          "not-found",
          "HTTP 404: invalid session, unsupported verb or unknown path",
          {
            ...details,
            httpStatus,
          },
        );
      }
      if (httpStatus !== 200) {
        throw new FsapiError("http", `Unexpected HTTP ${httpStatus}`, { ...details, httpStatus });
      }
      try {
        return await response.text();
      } catch (cause) {
        throw transportError(cause);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
