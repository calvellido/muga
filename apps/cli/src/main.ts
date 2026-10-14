import { parseArgs } from "node:util";
import {
  decodeListItem,
  decodeScalar,
  encodeScalar,
  FsapiClient,
  isFsapiError,
  lookupNode,
  NODE_DEFS,
  NotificationSession,
  type ScalarValue,
} from "@muga/fsapi-core";
import { startSimulator } from "@muga/fsapi-sim";

const HELP = `muga: FSAPI command-line tool

Usage:
  muga get <host> <node>              Read one node (e.g. sys.audio.volume)
  muga set <host> <node> <value>      Write one node; validated against the catalog first
  muga list <host> <node> [--max n]   Read a list node (e.g. sys.caps.validModes)
  muga info <host>                    Name, version, power, source, volume, now playing
  muga watch <host> [--seconds n]     Stream notifications (creates a session, see below)
  muga device <host>                  Fetch the /device document
  muga nodes [filter]                 Search the node catalog (offline)
  muga sim [--port n] [--host h]      Run a simulated radio

Options:
  --pin <pin>       Radio PIN (default $MUGA_PIN or 1234)
  --timeout <ms>    Request timeout (default 10000)
  --json            Print JSON
  -h, --help        Show this help

<host> is an IP, host:port, or FSAPI base URL. The "netRemote." prefix of node names is optional.
"watch" takes the radio's single session: other controllers (e.g. UNDOK) lose live updates while it runs.`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pin: { type: "string" },
    timeout: { type: "string" },
    json: { type: "boolean", default: false },
    max: { type: "string" },
    seconds: { type: "string" },
    port: { type: "string" },
    host: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command, ...args] = positionals;

function print(value: unknown, text: () => string): void {
  console.log(opts.json ? JSON.stringify(value, null, 2) : text());
}

function fail(message: string): never {
  console.error(`muga: ${message}`);
  process.exit(1);
}

function client(host: string | undefined): FsapiClient {
  if (!host) fail("missing <host>");
  return new FsapiClient({
    host,
    pin: opts.pin ?? process.env.MUGA_PIN ?? "1234",
    ...(opts.timeout ? { timeoutMs: Number(opts.timeout) } : {}),
  });
}

function node(name: string | undefined) {
  if (!name) fail("missing <node>");
  const entry = lookupNode(name);
  return { name: entry?.path ?? name, entry };
}

async function get(host?: string, name?: string) {
  const radio = client(host);
  const { name: path, entry } = node(name);
  const wire = await radio.getRaw(path);
  const value =
    entry && entry.def.type !== "list" ? decodeScalar(entry.def, wire, path) : wire.text;
  print({ node: path, value, wire }, () => String(value));
}

async function set(host?: string, name?: string, raw?: string) {
  const radio = client(host);
  const { name: path, entry } = node(name);
  if (raw === undefined) fail("missing <value>");
  if (!entry) fail(`${path} is not in the catalog; refusing to write an unknown node`);
  const numeric = /^-?\d+$/.test(raw) ? Number(raw) : undefined;
  const input: ScalarValue =
    entry.def.type === "c8" || entry.def.type === "u8array" ? raw : (numeric ?? raw);
  await radio.setRaw(path, encodeScalar(entry.def, input, path));
  print({ node: path, value: input, ok: true }, () => `${path} = ${input}`);
}

async function list(host?: string, name?: string) {
  const radio = client(host);
  const { name: path, entry } = node(name);
  const limit = opts.max ? Number(opts.max) : 100;
  const items: Record<string, ScalarValue>[] = [];
  let startKey = -1;
  while (items.length < limit) {
    const page = await radio.listGetNextRaw(path, startKey, Math.min(20, limit - items.length));
    for (const item of page.items) {
      items.push(
        entry
          ? decodeListItem(entry.def, item, path)
          : {
              key: item.key,
              ...Object.fromEntries(Object.entries(item.fields).map(([k, v]) => [k, v.text])),
            },
      );
    }
    const last = page.items.at(-1);
    if (page.listEnd || !last || last.key <= startKey) break;
    startKey = last.key;
  }
  print(items, () =>
    items
      .map((item) =>
        Object.entries(item)
          .map(([k, v]) => `${k}=${v}`)
          .join("  "),
      )
      .join("\n"),
  );
}

async function info(host?: string) {
  const radio = client(host);
  const { values, errors } = await radio.getMultiple([
    "netRemote.sys.info.friendlyName",
    "netRemote.sys.info.version",
    "netRemote.sys.power",
    "netRemote.sys.mode",
    "netRemote.sys.audio.volume",
    "netRemote.sys.caps.volumeSteps",
    "netRemote.sys.audio.mute",
    "netRemote.play.status",
    "netRemote.play.info.name",
    "netRemote.play.info.text",
  ]);
  const modes = await radio.listAllItems("netRemote.sys.caps.validModes").catch(() => []);
  const mode = modes.find((m) => m.key === values["netRemote.sys.mode"]);
  const summary = {
    name: values["netRemote.sys.info.friendlyName"],
    version: values["netRemote.sys.info.version"],
    power: values["netRemote.sys.power"],
    source: mode ? `${mode.label} (${mode.id}, key ${mode.key})` : values["netRemote.sys.mode"],
    volume: `${values["netRemote.sys.audio.volume"]} / ${Number(values["netRemote.sys.caps.volumeSteps"]) - 1}${values["netRemote.sys.audio.mute"] === "MUTE" ? " (muted)" : ""}`,
    status: values["netRemote.play.status"],
    playing: values["netRemote.play.info.name"],
    text: values["netRemote.play.info.text"],
    unavailable: Object.keys(errors),
  };
  print(summary, () =>
    Object.entries(summary)
      .filter(([k, v]) => k !== "unavailable" || (Array.isArray(v) && v.length > 0))
      .map(([k, v]) => `${k.padEnd(12)} ${Array.isArray(v) ? v.join(", ") : (v ?? "-")}`)
      .join("\n"),
  );
}

async function watch(host?: string) {
  const radio = client(host);
  const seconds = Number(opts.seconds ?? 30);
  console.error(
    `Watching ${radio.baseUrl} for ${seconds}s. This takes the radio's session; other controllers lose live updates meanwhile.`,
  );
  const session = new NotificationSession(radio, {
    onNotification: (n) =>
      print(n, () => `${new Date().toISOString()}  ${n.path ?? n.node} = ${n.value}`),
    onSessionLost: () => console.error("Session taken over by another controller; backing off."),
    onError: (e) => console.error(`error: ${e.message}`),
  });
  session.start();
  await new Promise<void>((done) => {
    const timer = setTimeout(done, seconds * 1000);
    process.once("SIGINT", () => {
      clearTimeout(timer);
      done();
    });
  });
  await session.stop();
}

async function device(host?: string) {
  const doc = await client(host).getDeviceDocument();
  print(doc, () =>
    Object.entries(doc)
      .map(([k, v]) => `${k.padEnd(12)} ${v}`)
      .join("\n"),
  );
}

function nodes(filter = "") {
  const lower = filter.toLowerCase();
  const rows = Object.entries(NODE_DEFS)
    .filter(([path]) => path.toLowerCase().includes(lower))
    .map(([path, def]) => ({
      path,
      type: def.type,
      readOnly: def.readOnly,
      notifying: def.notifying,
      ...("enum" in def ? { enum: Object.keys(def.enum).join("|") } : {}),
    }));
  print(rows, () =>
    rows
      .map(
        (r) =>
          `${r.path.padEnd(52)} ${r.type.padEnd(7)} ${r.readOnly ? "ro" : "rw"} ${r.notifying ? "notify" : "      "} ${r.enum ?? ""}`,
      )
      .join("\n"),
  );
}

async function sim() {
  const radio = await startSimulator({
    ...(opts.port ? { port: Number(opts.port) } : { port: 8099 }),
    ...(opts.host ? { host: opts.host } : {}),
    ...(opts.pin ? { pin: opts.pin } : {}),
  });
  console.log(
    `Simulated radio at ${radio.url} (PIN ${radio.pin}). Try: pnpm muga info ${radio.host}`,
  );
  await new Promise<void>((done) => process.once("SIGINT", () => done()));
  await radio.close();
}

async function main() {
  if (opts.help || !command) return console.log(HELP);
  switch (command) {
    case "get":
      return get(args[0], args[1]);
    case "set":
      return set(args[0], args[1], args[2]);
    case "list":
      return list(args[0], args[1]);
    case "info":
      return info(args[0]);
    case "watch":
      return watch(args[0]);
    case "device":
      return device(args[0]);
    case "nodes":
      return nodes(args[0]);
    case "sim":
      return sim();
    default:
      fail(`unknown command "${command}" (see --help)`);
  }
}

main().catch((error: unknown) => {
  if (isFsapiError(error))
    fail(`${error.message} [${error.kind}${error.fsStatus ? ` ${error.fsStatus}` : ""}]`);
  throw error;
});
