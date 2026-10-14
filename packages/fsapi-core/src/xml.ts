import { XMLParser } from "fast-xml-parser";
import { FsapiError } from "./errors.ts";
import type { FsStatus, WireListItem, WireNotification, WireValue } from "./types.ts";

export interface FsapiResponse {
  status: FsStatus;
  value?: WireValue;
  items: WireListItem[];
  listEnd: boolean;
  notifications: WireNotification[];
  sessionId?: string;
}

export interface MultipleEntry {
  node: string;
  status: FsStatus;
  value?: WireValue;
}

export interface DeviceDocument {
  friendlyName?: string;
  version?: string;
  /** FSAPI base URL advertised by the radio, e.g. `http://192.0.2.10:80/fsapi`. */
  webfsapi?: string;
}

type XmlNode = Record<string, unknown>;

const ALWAYS_ARRAY = new Set(["item", "field", "notify"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // GET_MULTIPLE wraps one <fsapiResponse> per node inside another root element.
  isArray: (name: string, jpath: unknown) =>
    ALWAYS_ARRAY.has(name) || (name === "fsapiResponse" && String(jpath).includes(".")),
});

function parseDocument(xml: string): XmlNode {
  try {
    return parser.parse(xml) as XmlNode;
  } catch (cause) {
    throw new FsapiError("parse", "Malformed XML in FSAPI reply", { cause });
  }
}

function asNode(value: unknown): XmlNode | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlNode)
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Reads `<value><u8>3</u8></value>`-style content: the first child element is the type tag. */
export function readWireValue(container: unknown): WireValue | undefined {
  const node = asNode(container);
  if (!node) return undefined;
  const tag = Object.keys(node).find((k) => !k.startsWith("@_") && k !== "#text");
  return tag === undefined ? undefined : { tag, text: asText(node[tag]) };
}

function readItems(items: unknown): WireListItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw) => {
    const item = asNode(raw);
    const key = Number(asText(item?.["@_key"]));
    if (!item || !Number.isInteger(key)) return [];
    const fields: Record<string, WireValue> = {};
    for (const rawField of (item.field as unknown[] | undefined) ?? []) {
      const field = asNode(rawField);
      const name = asText(field?.["@_name"]).toLowerCase();
      const value = readWireValue(field);
      if (name && value) fields[name] = value;
    }
    return [{ key, fields }];
  });
}

function readNotifications(notes: unknown): WireNotification[] {
  if (!Array.isArray(notes)) return [];
  return notes.flatMap((raw) => {
    const note = asNode(raw);
    const node = asText(note?.["@_node"]);
    const value = readWireValue(note?.value);
    return note && node && value ? [{ node, value }] : [];
  });
}

export function parseResponse(xml: string): FsapiResponse {
  const root = asNode(parseDocument(xml).fsapiResponse);
  const status = asText(root?.status);
  if (!root || !status) throw new FsapiError("parse", "Reply has no <fsapiResponse><status>");

  const response: FsapiResponse = {
    status,
    items: readItems(root.item),
    listEnd: "listend" in root,
    notifications: readNotifications(root.notify),
  };
  const value = readWireValue(root.value);
  if (value) response.value = value;
  const sessionId = asText(root.sessionId);
  if (sessionId) response.sessionId = sessionId;
  return response;
}

/** Parses GET_MULTIPLE / SET_MULTIPLE replies; the root element name is not checked. */
export function parseMultipleResponse(xml: string): MultipleEntry[] {
  const doc = parseDocument(xml);
  const rootName = Object.keys(doc).find((k) => !k.startsWith("?"));
  const root = asNode(rootName ? doc[rootName] : undefined);
  if (!root) throw new FsapiError("parse", "Empty multiple-reply document");

  const entries = Array.isArray(root.fsapiResponse) ? root.fsapiResponse : [];
  return entries.flatMap((raw) => {
    const entry = asNode(raw);
    const node = asText(entry?.node);
    const status = asText(entry?.status);
    if (!entry || !node || !status) return [];
    const value = readWireValue(entry.value);
    return [value ? { node, status, value } : { node, status }];
  });
}

/** Parses the radio's `/device` document (`<netRemote>…<webfsapi>…</webfsapi></netRemote>`). */
export function parseDeviceDocument(xml: string): DeviceDocument {
  const root = asNode(parseDocument(xml).netRemote);
  if (!root) throw new FsapiError("parse", "Reply is not a <netRemote> device document");
  const doc: DeviceDocument = {};
  const friendlyName = asText(root.friendlyName);
  const version = asText(root.version);
  const webfsapi = asText(root.webfsapi);
  if (friendlyName) doc.friendlyName = friendlyName;
  if (version) doc.version = version;
  if (webfsapi) doc.webfsapi = webfsapi;
  return doc;
}
