import { generateKeyPairSync } from "node:crypto";
import type { SimState } from "./behaviors.ts";

/** A Wi-Fi network the simulated radio finds when it scans. */
export interface SimWifiNetwork {
  ssid: string;
  /** Needs a passphrase (`privacy` 1). */
  secured: boolean;
  /** `rssi` as the radio reports it. */
  signal: number;
}

/** What the radio applied at a `sys.net.commitChanges`, for tests to check. */
export interface SimNetworkCommit {
  wifi: boolean;
  ethernet: boolean;
  /** The network joined, when Wi-Fi settings were given since the last commit. */
  ssid?: string;
  /** Decrypted from `sys.net.wlan.setPassphrase`. */
  passphrase?: string;
  /** From `selectAP`, or `setAuthType`/`setEncType` for a network typed by hand. */
  auth?: number;
  encryption?: number;
  dhcp: boolean;
  address: number;
  subnetMask: number;
  gateway: number;
  dns: [number, number];
}

export interface NetworkOptions {
  networks: readonly SimWifiNetwork[];
  /** How long a Wi-Fi scan takes. */
  scanMs: number;
  later(ms: number, fn: () => void): void;
}

export interface SimNetwork {
  /** Side effects of an accepted SET; a status to answer instead of FS_OK. */
  apply(path: string, value: number | string): string | undefined;
  readonly commits: readonly SimNetworkCommit[];
}

interface RadioKey {
  publicKey: string;
  n: bigint;
  d: bigint;
}

let key: RadioKey | undefined;

/** One RSA-1024 key per process, generated on first use, as a radio makes its own. */
function radioKey(): RadioKey {
  if (key) return key;
  const jwk = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({
    format: "jwk",
  });
  const big = (b64: string | undefined) =>
    BigInt(`0x${Buffer.from(b64 ?? "", "base64url").toString("hex")}`);
  const [n, e, d] = [big(jwk.n), big(jwk.e), big(jwk.d)];
  key = { publicKey: `${e.toString(16)}:${n.toString(16)}`, n, d };
  return key;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  for (let b = base % modulus, e = exponent; e > 0n; e >>= 1n, b = (b * b) % modulus) {
    if (e & 1n) result = (result * b) % modulus;
  }
  return result;
}

/** Undoes `encryptForRadio`; undefined when the block isn't PKCS#1 v1.5 type 2. */
function decrypt(hex: string, { n, d }: RadioKey): string | undefined {
  if (!/^[0-9a-f]+$/i.test(hex)) return undefined;
  const size = Math.ceil(n.toString(16).length / 2);
  const block = Buffer.from(
    modPow(BigInt(`0x${hex}`), d, n)
      .toString(16)
      .padStart(size * 2, "0"),
    "hex",
  );
  const end = block.indexOf(0, 2);
  if (block[0] !== 0 || block[1] !== 2 || end < 10) return undefined;
  return block.subarray(end + 1).toString("utf8");
}

const WIFI_ENABLE = "netRemote.sys.net.wlan.interfaceEnable";
const WIRED_ENABLE = "netRemote.sys.net.wired.interfaceEnable";

/**
 * Network settings, as the radio's own web page drives them (ADR 0019):
 * a scan fills `sys.net.wlan.scanList`; the passphrase arrives RSA-encrypted with the radio's
 * key; `selectAP` picks a scanned network, or `setSSID` with `setAuthType`/`setEncType` names
 * one; nothing changes until `sys.net.commitChanges`. The simulator keeps answering at its
 * address whatever is committed.
 */
export function createNetwork(state: SimState, options: NetworkOptions): SimNetwork {
  const radio = radioKey();
  state.set("netRemote.sys.rsa.publicKey", radio.publicKey);
  state.set("netRemote.sys.rsa.status", "KEY_AVAILABLE");
  let pending: Partial<SimNetworkCommit> = {};
  const commits: SimNetworkCommit[] = [];
  const num = (path: string) => Number(state.get(path) ?? 0);

  return {
    commits,
    apply(path, value) {
      switch (path) {
        case "netRemote.sys.net.wlan.scan":
          if (Number(value) === 1) {
            options.later(options.scanMs, () => {
              state.setList(
                "netRemote.sys.net.wlan.scanList",
                options.networks.map((net, index) => ({
                  key: index,
                  ssid: net.ssid,
                  privacy: net.secured ? 1 : 0,
                  wpsCapability: 0,
                  rssi: net.signal,
                })),
              );
              state.set("netRemote.sys.net.wlan.scan", "IDLE");
            });
          }
          return undefined;
        case "netRemote.sys.net.wlan.setPassphrase": {
          const passphrase = decrypt(String(value), radio);
          if (passphrase === undefined) return "FS_FAIL";
          pending.passphrase = passphrase;
          return undefined;
        }
        case "netRemote.sys.net.wlan.selectAP": {
          const item = state
            .list("netRemote.sys.net.wlan.scanList")
            .find((i) => i.key === Number(value));
          if (!item) return "FS_FAIL";
          pending.ssid = String(item.ssid);
          return undefined;
        }
        case "netRemote.sys.net.wlan.setSSID":
          pending.ssid = String(value);
          return undefined;
        case "netRemote.sys.net.wlan.setAuthType":
          pending.auth = Number(value);
          return undefined;
        case "netRemote.sys.net.wlan.setEncType":
          pending.encryption = Number(value);
          return undefined;
        case "netRemote.sys.net.commitChanges": {
          if (Number(value) !== 1) return undefined;
          const commit: SimNetworkCommit = {
            ...pending,
            wifi: num(WIFI_ENABLE) === 1,
            ethernet: num(WIRED_ENABLE) === 1,
            dhcp: num("netRemote.sys.net.ipConfig.dhcp") === 1,
            address: num("netRemote.sys.net.ipConfig.address"),
            subnetMask: num("netRemote.sys.net.ipConfig.subnetMask"),
            gateway: num("netRemote.sys.net.ipConfig.gateway"),
            dns: [
              num("netRemote.sys.net.ipConfig.dnsPrimary"),
              num("netRemote.sys.net.ipConfig.dnsSecondary"),
            ],
          };
          commits.push(commit);
          if (commit.ssid !== undefined && commit.wifi) {
            state.set("netRemote.sys.net.wlan.connectedSSID", commit.ssid);
            const found = options.networks.find((net) => net.ssid === commit.ssid);
            if (found) state.set("netRemote.sys.net.wlan.rssi", found.signal);
          }
          pending = {};
          return undefined;
        }
        default:
          return undefined;
      }
    },
  };
}
