import { encryptForRadio, FsapiClient, ipv4ToU32 } from "@muga/fsapi-core";
import { afterEach, describe, expect, it } from "vitest";
import { type RadioSimulator, startSimulator } from "../src/index.ts";

let sim: RadioSimulator | undefined;

afterEach(async () => {
  await sim?.close();
  sim = undefined;
});

async function waitForScan(client: FsapiClient) {
  for (let i = 0; i < 50 && (await client.get("netRemote.sys.net.wlan.scan")) !== "IDLE"; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("simulated network settings", () => {
  it("scans for Wi-Fi networks and lists them with their names as bytes", async () => {
    sim = await startSimulator({ wifiScanMs: 20 });
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.sys.net.wlan.scan", "SCAN");
    await waitForScan(client);
    const found = await client.listAllItems("netRemote.sys.net.wlan.scanList");
    expect(found.map((n) => n.ssid)).toEqual([
      "MugaNet",
      "Frontera 5G",
      "MugaNet",
      "Café Muga",
      "",
    ]);
    expect(found[3]).toMatchObject({ privacy: 0, rssi: 35 });
  });

  it("joins a scanned network on commit, with the passphrase decrypted from RSA", async () => {
    sim = await startSimulator({ wifiScanMs: 20 });
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.sys.net.wlan.scan", "SCAN");
    await waitForScan(client);
    expect(await client.get("netRemote.sys.rsa.status")).toBe("KEY_AVAILABLE");
    const key = await client.get("netRemote.sys.rsa.publicKey");
    await client.set("netRemote.sys.net.wlan.setPassphrase", encryptForRadio(key, "frontier!"));
    await client.set("netRemote.sys.net.wlan.selectAP", 1);
    await client.set("netRemote.sys.net.ipConfig.dhcp", "NO");
    await client.set("netRemote.sys.net.ipConfig.address", ipv4ToU32("192.0.2.42") ?? 0);
    expect(sim.networkCommits).toEqual([]);
    await client.set("netRemote.sys.net.commitChanges", "YES");
    expect(sim.networkCommits).toEqual([
      expect.objectContaining({
        ssid: "Frontera 5G",
        passphrase: "frontier!",
        wifi: true,
        dhcp: false,
        address: ipv4ToU32("192.0.2.42"),
      }),
    ]);
    await expect(client.get("netRemote.sys.net.wlan.connectedSSID")).resolves.toBe("Frontera 5G");
  });

  it("refuses a passphrase that wasn't encrypted with its key", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await expect(
      client.set("netRemote.sys.net.wlan.setPassphrase", "plain text"),
    ).rejects.toMatchObject({ kind: "status" });
  });

  it("takes a new four-digit PIN, after which only that PIN is accepted", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await expect(client.get("netRemote.sys.info.radioPin")).resolves.toBe("1234");
    await expect(client.set("netRemote.sys.info.radioPin", "12a4")).rejects.toMatchObject({
      kind: "status",
    });
    await client.set("netRemote.sys.info.radioPin", "4321");
    expect(sim.pin).toBe("4321");
    await expect(client.get("netRemote.sys.power")).rejects.toMatchObject({ kind: "pin" });
    client.pin = "4321";
    await expect(client.get("netRemote.sys.power")).resolves.toBe("ON");
  });
});
