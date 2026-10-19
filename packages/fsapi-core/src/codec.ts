import { enumName, enumValue } from "./catalog.ts";
import { FsapiError } from "./errors.ts";
import type { FieldDef, FieldType, NodeDef, ScalarType, WireListItem, WireValue } from "./types.ts";

export type ScalarValue = number | string;

type IntegerType = Exclude<ScalarType, "c8" | "e8" | "u8array">;

const INTEGER_RANGES: Record<IntegerType | "e8", readonly [number, number]> = {
  u8: [0, 255],
  u16: [0, 65_535],
  u32: [0, 4_294_967_295],
  s8: [-128, 127],
  s16: [-32_768, 32_767],
  s32: [-2_147_483_648, 2_147_483_647],
  e8: [0, 255],
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function parseInteger(text: string, node: string): number {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new FsapiError("parse", `Expected an integer for ${node}, got "${text}"`, { node });
  }
  return Number(trimmed);
}

/** `<array>` values are hex strings; SSIDs are zero-padded UTF-8. Non-hex text is returned as-is. */
export function decodeByteArray(text: string): string {
  const hex = text.trim();
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return text;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return decoder.decode(bytes.subarray(0, end));
}

export function encodeByteArray(text: string): string {
  return Array.from(encoder.encode(text), (b) =>
    b.toString(16).padStart(2, "0").toUpperCase(),
  ).join("");
}

function decodeTyped(
  type: FieldType | "u8array",
  def: NodeDef | undefined,
  wire: WireValue,
  node: string,
) {
  switch (type) {
    case "c8":
      return wire.text;
    case "u8array":
      return decodeByteArray(wire.text);
    case "e8": {
      const value = parseInteger(wire.text, node);
      return (def && enumName(def, value)) ?? value;
    }
    default:
      return parseInteger(wire.text, node);
  }
}

export function decodeScalar(def: NodeDef, wire: WireValue, node = "node"): ScalarValue {
  if (def.type === "list") {
    throw new FsapiError("validation", `${node} is a list; use the list methods`, { node });
  }
  return decodeTyped(def.type, def, wire, node);
}

/** Validates against the catalog and returns the `value=` query parameter. Never sends invalid data. */
export function encodeScalar(def: NodeDef, input: ScalarValue, node = "node"): string {
  const reject = (reason: string): never => {
    throw new FsapiError("validation", `Refusing to SET ${node}: ${reason}`, { node });
  };
  if (def.type === "list") reject("it is a list node");
  if (def.readOnly) reject("it is read-only");

  switch (def.type) {
    case "c8": {
      if (typeof input !== "string") reject("expected a string");
      const bytes = encoder.encode(input as string).length;
      // maxLength is the buffer size; assume one byte is reserved for the terminator.
      if (def.maxLength !== undefined && bytes > def.maxLength - 1) {
        reject(`${bytes} bytes exceeds the limit of ${def.maxLength - 1}`);
      }
      return input as string;
    }
    case "u8array": {
      if (typeof input !== "string") reject("expected a string");
      const hex = encodeByteArray(input as string);
      if (def.maxLength !== undefined && hex.length / 2 > def.maxLength) {
        reject(`more than ${def.maxLength} bytes`);
      }
      return hex;
    }
    case "e8": {
      const value = typeof input === "string" ? enumValue(def, input) : input;
      if (value === undefined) {
        reject(`unknown value "${input}" (known: ${Object.keys(def.enum ?? {}).join(", ")})`);
      }
      return encodeInteger("e8", def, value as number, reject);
    }
    default:
      if (typeof input !== "number") reject("expected a number");
      return encodeInteger(def.type as IntegerType, def, input as number, reject);
  }
}

function encodeInteger(
  type: IntegerType | "e8",
  def: NodeDef,
  value: number,
  reject: (reason: string) => never,
): string {
  if (!Number.isInteger(value)) reject(`${value} is not an integer`);
  const [typeMin, typeMax] = INTEGER_RANGES[type];
  const min = Math.max(typeMin, def.min ?? typeMin);
  const max = Math.min(typeMax, def.max ?? typeMax);
  if (value < min || value > max) reject(`${value} is outside ${min}..${max}`);
  return String(value);
}

/** A `u8` field longer than one byte holds bytes, such as the SSID in `sys.net.wlan.scanList`. */
export function isByteArrayField(field: FieldDef): boolean {
  return field.type === "u8" && field.length > 1;
}

/**
 * Decodes a list item using the catalog's field definitions (matched case-insensitively).
 * Fields the catalog doesn't know are kept as raw text under their lower-cased name.
 */
export function decodeListItem(
  def: NodeDef,
  item: WireListItem,
  node = "list",
): Record<string, ScalarValue> {
  const out: Record<string, ScalarValue> = { key: item.key };
  const known = new Set<string>();
  for (const field of def.fields ?? []) {
    const lower = field.name.toLowerCase();
    known.add(lower);
    if (lower === "key") continue;
    const wire = item.fields[lower];
    if (!wire) continue;
    out[field.name] = isByteArrayField(field)
      ? wire.tag === "c8_array"
        ? wire.text
        : decodeByteArray(wire.text)
      : decodeTyped(field.type, undefined, wire, `${node}.${field.name}`);
  }
  for (const [name, wire] of Object.entries(item.fields)) {
    if (!known.has(name) && !(name in out)) out[name] = wire.text;
  }
  return out;
}
