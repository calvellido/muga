import { parseArgs } from "node:util";
import {
  decodeListItem,
  decodeScalar,
  encodeScalar,
  FsapiClient,
  isFsapiError,
  lookupNode,
  NAV_PAGE_SIZE,
  NavItemType,
  type NavListItem,
  NODE_DEFS,
  NotificationSession,
  navigate,
  readMultiroomDevices,
  readNavInfo,
  readNavPage,
  resetNav,
  type ScalarValue,
  udnSuffix,
} from "@muga/fsapi-core";
import { startSimulatedHome, startSimulator } from "@muga/fsapi-sim";

const HELP = `muga: FSAPI command-line tool

Usage:
  muga get <host> <node>              Read one node (e.g. sys.audio.volume)
  muga set <host> <node> <value>      Write one node; validated against the catalog first
  muga list <host> <node> [--max n]   Read a list node (e.g. sys.caps.validModes)
  muga info <host>                    Name, version, power, source, volume, now playing
  muga browse <host> [key ...]        List the current source's menu, after entering folders by key
  muga groups <host>                  Multiroom: this radio's group and every speaker it knows of
  muga watch <host> [--seconds n]     Stream notifications (creates a session, see below)
  muga device <host>                  Fetch the /device document
  muga nodes [filter]                 Search the node catalog (offline)
  muga sim [--port n] [--host h]      Run a simulated radio
           [--speakers n]             …or n speakers that can group, on ports from --port up

Options:
  --pin <pin>       Radio PIN (default $MUGA_PIN or 1234)
  --timeout <ms>    Request timeout (default 10000)
  --json            Print JSON
  -h, --help        Show this help

<host> is an IP, host:port, or FSAPI base URL. The "netRemote." prefix of node names is optional.
"watch" takes the radio's single session: other controllers (e.g. UNDOK) lose live updates while it runs.
"browse" turns the radio's menu on and resets its position (nav.state OFF, then ON), as UNDOK does.`;

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
    speakers: { type: "string" },
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

async function browse(host?: string, keys: string[] = []) {
  const radio = client(host);
  const path = keys.map((key) => {
    if (!/^\d+$/.test(key)) fail(`folder keys are numbers, got "${key}"`);
    return Number(key);
  });
  await resetNav(radio);
  for (const key of path) await navigate(radio, key);
  const { numItems, depth } = await readNavInfo(radio);
  const limit = opts.max ? Number(opts.max) : 100;
  const items: NavListItem[] = [];
  let startKey = -1;
  while (items.length < limit) {
    const page = await readNavPage(radio, startKey);
    items.push(...page.items.slice(0, limit - items.length));
    const last = page.items.at(-1);
    if (page.listEnd || !last || page.items.length < NAV_PAGE_SIZE) break;
    startKey = last.key;
  }
  const typeNames = new Map<number, string>(Object.entries(NavItemType).map(([k, v]) => [v, k]));
  print({ depth, numItems, items }, () =>
    [
      `depth ${depth ?? "?"}, ${numItems ?? "?"} items`,
      ...items.map(
        (i) =>
          `${String(i.key).padStart(4)}  ${(typeNames.get(i.type) ?? String(i.type)).padEnd(15)} ${i.name}${i.artist ? `  (${i.artist})` : ""}`,
      ),
    ].join("\n"),
  );
}

async function groups(host?: string) {
  const radio = client(host);
  const { values, errors } = await radio.getMultiple([
    "netRemote.sys.info.friendlyName",
    "netRemote.sys.info.radioId",
    "netRemote.sys.info.dmruuid",
    "netRemote.multiroom.caps.protocolVersion",
    "netRemote.multiroom.caps.maxClients",
    "netRemote.multiroom.group.state",
    "netRemote.multiroom.group.name",
    "netRemote.multiroom.group.streamable",
    "netRemote.multiroom.device.listAllVersion",
  ]);
  const devices = await readMultiroomDevices(radio);
  // Which entry is this radio: its UDN ends like its radio id or its UPnP UDN (doc 05 §6.1).
  const ids = [values["netRemote.sys.info.radioId"], values["netRemote.sys.info.dmruuid"]]
    .map((id) => (id ? udnSuffix(id) : ""))
    .filter(Boolean);
  const self = devices.find((d) => ids.includes(udnSuffix(d.udn)));
  const role = values["netRemote.multiroom.group.state"];
  const groupsById = Map.groupBy(
    devices.filter((d) => d.groupId),
    (d) => d.groupId,
  );
  const line = (d: (typeof devices)[number]) =>
    `    ${(d.role === "CLIENT" ? `CLIENT ${d.clientNumber ?? "?"}` : d.role).padEnd(9)} ${d.name.padEnd(20)} ${d.ip.padEnd(15)} ${d.udn}${d === self ? "  (this radio)" : ""}${d.syncVersion ? `  protocol ${d.syncVersion}` : ""}`;
  print({ radio: values, unavailable: Object.keys(errors), devices }, () =>
    [
      `${values["netRemote.sys.info.friendlyName"] ?? radio.baseUrl}: ${role ?? "?"}${role === "NO_GROUP" || role === undefined ? "" : ` of "${values["netRemote.multiroom.group.name"] ?? ""}"`}`,
      `  source can be shared: ${values["netRemote.multiroom.group.streamable"] ?? "?"}, protocol ${values["netRemote.multiroom.caps.protocolVersion"] ?? "?"}, up to ${values["netRemote.multiroom.caps.maxClients"] ?? "?"} clients`,
      `  radio id ${values["netRemote.sys.info.radioId"] ?? "?"}, UPnP UDN ${values["netRemote.sys.info.dmruuid"] || "?"}${self ? "" : ", not found in the speaker list below"}`,
      `${devices.length} speakers (list version ${values["netRemote.multiroom.device.listAllVersion"] ?? "?"}):`,
      ...[...groupsById].flatMap(([, members]) => [
        `  ${members[0]?.groupName || "(unnamed group)"}`,
        ...[...members]
          .sort((a, b) => (a.role === "SERVER" ? -1 : b.role === "SERVER" ? 1 : 0))
          .map(line),
      ]),
      ...(devices.some((d) => !d.groupId)
        ? ["  Not grouped", ...devices.filter((d) => !d.groupId).map(line)]
        : []),
    ].join("\n"),
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
  if (opts.speakers) return simHome(Number(opts.speakers));
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

async function simHome(count: number) {
  if (!Number.isInteger(count) || count < 1) fail("--speakers takes a number of speakers");
  const home = await startSimulatedHome({
    speakers: count,
    basePort: opts.port ? Number(opts.port) : 8099,
    ...(opts.host ? { host: opts.host } : {}),
    ...(opts.pin ? { pin: opts.pin } : {}),
  });
  console.log(
    `${count} simulated speakers on one multiroom network (PIN ${home.speakers[0]?.pin}):`,
  );
  for (const radio of home.speakers) {
    const name = radio.get("netRemote.sys.info.friendlyName");
    console.log(`  ${String(name).padEnd(12)} ${radio.url}`);
  }
  console.log(`Try: pnpm muga groups ${home.speakers[0]?.host}`);
  await new Promise<void>((done) => process.once("SIGINT", () => done()));
  await home.close();
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
    case "browse":
      return browse(args[0], args.slice(1));
    case "groups":
      return groups(args[0]);
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
