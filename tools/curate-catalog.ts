/**
 * Builds data/node-catalog.json (protocol facts only) from the static-analysis catalog.
 *
 * Usage: pnpm catalog:curate <analysis-catalog.json> [out.json]
 * The analysis catalog is not part of this repository.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FieldType, NodeType } from "../packages/fsapi-core/src/types.ts";

interface AnalysisNode {
  path: string;
  group: string;
  value_type: string;
  read_only: boolean;
  notifying: boolean;
  cacheable: boolean;
  address_dec: number;
  registered_in_nodedefs: boolean;
  max_length?: number | null;
  integer_range?: { min: number; max: number } | null;
  enum?: { values: { value: number; name: string }[] } | null;
  prototype?: { name: string | null; type: string; length: number }[] | null;
  parse_errors?: unknown[];
}

export interface CuratedNode {
  path: string;
  group: string;
  type: NodeType;
  readOnly: boolean;
  notifying: boolean;
  cacheable: boolean;
  address: number;
  registered: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: { name: string; value: number }[];
  fields?: { name: string; type: FieldType; length: number }[];
}

export interface CuratedCatalog {
  description: string;
  source: { app: string; version: string; apkSha256: string };
  nodes: CuratedNode[];
}

const VALUE_TYPES: Record<string, NodeType> = {
  NodeU8: "u8",
  NodeU16: "u16",
  NodeU32: "u32",
  NodeS8: "s8",
  NodeS16: "s16",
  NodeS32: "s32",
  NodeC: "c8",
  NodeE8: "e8",
  NodeU: "u8array",
  NodeList: "list",
};

const FIELD_TYPES: Record<string, FieldType> = {
  U8: "u8",
  U16: "u16",
  U32: "u32",
  S8: "s8",
  S16: "s16",
  S32: "s32",
  C8: "c8",
  E8: "e8",
};

function curate(node: AnalysisNode): CuratedNode {
  const type = VALUE_TYPES[node.value_type];
  if (!type) throw new Error(`${node.path}: unknown value_type ${node.value_type}`);
  if (node.parse_errors?.length) throw new Error(`${node.path}: catalog has parse errors`);

  const out: CuratedNode = {
    path: node.path,
    group: node.group,
    type,
    readOnly: node.read_only,
    notifying: node.notifying,
    cacheable: node.cacheable,
    address: node.address_dec,
    registered: node.registered_in_nodedefs,
  };
  if (type === "c8" || type === "u8array") {
    const length = node.max_length ?? node.prototype?.[0]?.length;
    if (length) out.maxLength = length;
  }
  if (node.integer_range) {
    out.min = node.integer_range.min;
    out.max = node.integer_range.max;
  }
  if (type === "e8" && node.enum?.values.length) {
    out.enum = [...node.enum.values]
      .sort((a, b) => a.value - b.value)
      .map(({ name, value }) => ({ name, value }));
  }
  if (type === "list") {
    out.fields = (node.prototype ?? []).map((field) => {
      const fieldType = FIELD_TYPES[field.type];
      if (!field.name || !fieldType) {
        throw new Error(`${node.path}: unsupported list field ${JSON.stringify(field)}`);
      }
      return { name: field.name, type: fieldType, length: field.length };
    });
  }
  return out;
}

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg) {
  console.error("Usage: pnpm catalog:curate <analysis-catalog.json> [out.json]");
  process.exit(1);
}
const input = resolve(inputArg);
const output = resolve(outputArg ?? "data/node-catalog.json");

const nodes = (JSON.parse(readFileSync(input, "utf8")) as AnalysisNode[])
  .map(curate)
  .sort((a, b) => a.path.localeCompare(b.path));

const catalog: CuratedCatalog = {
  description:
    "FSAPI node facts (paths, types, flags, enums, list fields) derived from a static analysis of the UNDOK app. Data only; no vendor code.",
  source: {
    app: "com.frontier_silicon.fsirc.dok2",
    version: "3.3.36",
    apkSha256: "6ae294d62d69757dda405992362c6f0d518ac7472386c15186eeddd4ead744fa",
  },
  nodes,
};

writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${nodes.length} nodes to ${output}`);
