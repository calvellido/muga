/** Request verbs understood by FSAPI radios (see Analysis docs 02 and 09). */
export type Verb =
  | "GET"
  | "SET"
  | "LIST_GET_NEXT"
  | "LIST_SET"
  | "GET_MULTIPLE"
  | "SET_MULTIPLE"
  | "CREATE_SESSION"
  | "DELETE_SESSION"
  | "GET_NOTIFIES";

/** `<status>` values seen in replies. Unknown codes are passed through as strings. */
export type FsStatus =
  | "FS_OK"
  | "FS_FAIL"
  | "FS_PACKET_BAD"
  | "FS_NODE_BLOCKED"
  | "FS_NODE_DOES_NOT_EXIST"
  | "FS_TIMEOUT"
  | "FS_LIST_END"
  | "FS_REPLY_TOO_BIG"
  | "FS_ITEM_DOES_NOT_EXIST"
  | "FS_PARSE_FAIL"
  | "FS_REQUEST_INVALID"
  | "FS_TRY_AGAIN"
  | (string & {});

/** Value tags inside `<value>` / `<field>`. Enums travel as `u8`, byte arrays as `array`. */
export type WireTag = "u8" | "u16" | "u32" | "s8" | "s16" | "s32" | "c8_array" | "array";

export interface WireValue {
  /** Tag name as received (usually a {@link WireTag}). */
  tag: string;
  text: string;
}

export interface WireListItem {
  key: number;
  /** Field values keyed by lower-cased field name (radios send lower case, the catalog uses camel case). */
  fields: Record<string, WireValue>;
}

export interface WireNotification {
  node: string;
  value: WireValue;
}

/** Scalar node types after normalisation. `e8` is an enum, `u8array` a byte array (e.g. an SSID). */
export type ScalarType = "u8" | "u16" | "u32" | "s8" | "s16" | "s32" | "c8" | "e8" | "u8array";
export type NodeType = ScalarType | "list";
export type FieldType = Exclude<ScalarType, "u8array">;

export interface FieldDef {
  readonly name: string;
  readonly type: FieldType;
  /** Declared length; for `c8` the buffer size in bytes. */
  readonly length: number;
}

export interface NodeDef {
  readonly type: NodeType;
  readonly readOnly: boolean;
  readonly notifying: boolean;
  readonly cacheable: boolean;
  readonly address: number;
  /** False for the few node classes the app ships but never registers. */
  readonly registered: boolean;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  /** Enum constant name → wire value. */
  readonly enum?: Readonly<Record<string, number>>;
  /** List item fields, including `key`. */
  readonly fields?: readonly FieldDef[];
}

/** Minimal fetch shape so browsers, Node and native shells can all supply a transport. */
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;
