# Muga

A web controller for internet radios built on Frontier Silicon's FSAPI ("netRemote"). These are the radios the UNDOK app controls (Roberts, Ruark, Silvercrest, Eliteline, Hama, Medion, …). *Muga* is Basque for "frontier".

Not affiliated with or endorsed by Frontier Smart or any radio vendor.

## Status

Phase 1 (protocol core, simulator and CLI) and the first hub-less web app (Phase 1b) are done. Phase 4 is under way: menu browsing, preset editing, the FM tuner and DAB scanning are in; settings come next.

| Package | What it is |
| --- | --- |
| [`packages/fsapi-core`](packages/fsapi-core) | Typed FSAPI client for browsers and Node: URL building, XML parsing, catalog-based validation, lists, GET/SET_MULTIPLE with fallback, sessions and notifications |
| [`packages/fsapi-sim`](packages/fsapi-sim) | Simulated radio (HTTP) driven by the node catalog, for tests and hardware-free development |
| [`apps/web`](apps/web) | The web app: an installable PWA (React) that talks to radios directly from the browser |
| [`apps/cli`](apps/cli) | `muga` command-line tool |
| [`data/node-catalog.json`](data/node-catalog.json) | 284 FSAPI nodes (paths, types, flags, enums, list fields): the source for the generated types |

## Getting started

Requires Node ≥ 22 and pnpm 10.

```sh
pnpm install
pnpm check                         # codegen check, typecheck, lint, tests

pnpm sim                           # simulated radio on http://127.0.0.1:8099
pnpm muga info 127.0.0.1:8099      # …or a real radio: pnpm muga info <radio-ip>
pnpm muga get 127.0.0.1:8099 play.status
pnpm muga set 127.0.0.1:8099 sys.audio.volume 12
pnpm muga list 127.0.0.1:8099 sys.caps.validModes
pnpm muga browse 127.0.0.1:8099 2 0  # the current source's menu, after entering folders 2 then 0
pnpm muga nodes multiroom          # search the catalog offline
pnpm muga --help
```

The web app:

```sh
pnpm sim                           # terminal 1: simulated radio on 127.0.0.1:8099
pnpm web                           # terminal 2: http://localhost:5173, then add 127.0.0.1:8099
pnpm web:build && pnpm web:preview # production build on http://localhost:4173 (installable)
```

Add a real radio by its IP address (for example `192.0.2.10`) and PIN (usually `1234`). The browser and the radio must be on the same network. The app currently supports:

- now playing, with artwork;
- play/pause/stop/next/previous, shuffle and repeat, following each radio's capabilities;
- volume and mute;
- standby and on;
- switching source;
- browsing the source's menu: folders, search, long lists, playing an item;
- presets: recall, save what's playing into a slot, delete, and reorder (where the radio allows it);
- FM: tune with a dial or one step at a time, and seek to the next station;
- DAB: scan for stations, with progress, then remove stations that can't be received.

Using the library:

```ts
import { FsapiClient } from "@muga/fsapi-core";

const radio = new FsapiClient({ host: "192.0.2.10", pin: "1234" });
await radio.get("netRemote.play.status");          // "PLAYING" (typed enum name)
await radio.set("netRemote.play.control", "PAUSE"); // validated before sending
const modes = await radio.listAllItems("netRemote.sys.caps.validModes");
```

## How the node catalog works

`data/node-catalog.json` holds protocol facts only. It was produced by `pnpm catalog:curate` from a private static analysis of the UNDOK app; the analysis itself is not part of this repository. `pnpm gen` turns it into `packages/fsapi-core/src/generated/nodes.ts`, from which all value and list types are derived. Never edit the generated file; `pnpm check` fails when it is stale.

## Working with real radios

- FSAPI is plain HTTP with the PIN in the URL; the default PIN is `1234`. The radios answer with `Access-Control-Allow-Origin: *`, which is what makes a hub-less web app possible (see ADR 0001).
- Browsing and presets move the radio's menu (`nav.state`, `nav.action.*`). That's harmless, but someone using the radio's own menu at the same time will see it jump, as with UNDOK.
- Plain GET/SET needs no session. `muga watch` and `NotificationSession` create the radio's **single** session, so other controllers (e.g. UNDOK) lose live updates while they run.
- Writes are validated against the catalog and refused locally if invalid. Don't point automated tests at real radios for factory reset, firmware update or network nodes.

## Repository rules

- Never commit the UNDOK APK, decompiled sources, firmware images or analysis evidence. `.gitignore` blocks `*.apk` and `*.isu.bin` as a safety net.
- Decisions are recorded in [`docs/adr`](docs/adr).

## Licence

[MIT](LICENSE)
