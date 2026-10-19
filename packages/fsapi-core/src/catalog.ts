import { FsapiError } from "./errors.ts";
import { NODE_DEFS } from "./generated/nodes.ts";
import type { NodeDef } from "./types.ts";

type Defs = typeof NODE_DEFS;

export type NodePath = keyof Defs;
export type ListPath = { [P in NodePath]: Defs[P] extends { type: "list" } ? P : never }[NodePath];
export type ScalarPath = Exclude<NodePath, ListPath>;
export type WritablePath = {
  [P in ScalarPath]: Defs[P] extends { readOnly: false } ? P : never;
}[ScalarPath];

type EnumName<D> = D extends { enum: infer E } ? Extract<keyof E, string> : never;
export type EnumNameOf<P extends NodePath> = EnumName<Defs[P]>;

/** Decoded scalar value. Enums decode to their constant name, or the raw number if unknown. */
export type NodeValue<P extends ScalarPath> = Defs[P] extends { type: "e8" }
  ? EnumName<Defs[P]> | number
  : Defs[P] extends { type: "c8" | "u8array" }
    ? string
    : number;

export type SetInput<P extends WritablePath> = NodeValue<P>;

/** `c8` fields are text, and so is a `u8` field longer than one byte: an SSID's bytes. */
type FieldValue<F> = F extends { type: "c8" }
  ? string
  : F extends { type: "u8"; length: infer L }
    ? L extends 1
      ? number
      : string
    : number;

/** A decoded list item; field names follow the catalog (camel case), plus `key`. */
export type ListItem<P extends ListPath> = Defs[P] extends { fields: readonly (infer F)[] }
  ? {
      [K in F as K extends { name: infer N extends string } ? N : never]: FieldValue<K>;
    } & Record<string, number | string>
  : never;

export interface NodeEntry {
  path: NodePath;
  def: NodeDef;
}

const PREFIX = "netremote.";
const BY_LOWER_PATH = new Map<string, NodeEntry>(
  Object.entries(NODE_DEFS).map(([path, def]) => [
    path.toLowerCase(),
    { path: path as NodePath, def: def as NodeDef },
  ]),
);

export const NODE_PATHS = Object.keys(NODE_DEFS) as NodePath[];

/** Case-insensitive lookup; the `netRemote.` prefix is optional. */
export function lookupNode(path: string): NodeEntry | undefined {
  const lower = path.trim().toLowerCase();
  return BY_LOWER_PATH.get(lower.startsWith(PREFIX) ? lower : PREFIX + lower);
}

export function requireNode(path: string): NodeEntry {
  const entry = lookupNode(path);
  if (!entry) throw new FsapiError("validation", `Unknown node ${path}`, { node: path });
  return entry;
}

export function enumName(def: NodeDef, value: number): string | undefined {
  if (!def.enum) return undefined;
  for (const [name, v] of Object.entries(def.enum)) if (v === value) return name;
  return undefined;
}

export function enumValue(def: NodeDef, name: string): number | undefined {
  if (!def.enum) return undefined;
  const lower = name.toLowerCase();
  for (const [n, v] of Object.entries(def.enum)) if (n.toLowerCase() === lower) return v;
  return undefined;
}
