// @vitest-environment happy-dom
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FetchLike } from "@muga/fsapi-core";
import { type RadioSimulator, startSimulator } from "@muga/fsapi-sim";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.tsx";
import { applyTheme, loadPreferences, PreferencesProvider } from "../src/preferences.tsx";
import { RegistryContext } from "../src/radio/hooks.ts";
import { RadioRegistry, type StorageLike } from "../src/radio/registry.ts";

let sim: RadioSimulator | undefined;
let proxy: Server | undefined;
let registry: RadioRegistry | undefined;

afterEach(async () => {
  cleanup();
  registry?.stop();
  applyTheme("auto");
  await sim?.close();
  await new Promise((resolve) => (proxy ? proxy.close(resolve) : resolve(undefined)));
  sim = proxy = registry = undefined;
});

/** A Muga proxy (docs/proxy) in front of local servers: /muga-proxy, and /<host>/<path> forwarded. */
async function startProxy() {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    seen.push(url);
    if (url === "/muga-proxy") {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end('{"muga":1,"ranges":["127.0.0"]}');
      return;
    }
    const match = /^\/(\d+\.\d+\.\d+\.\d+(?::\d+)?)(\/.*)$/.exec(url);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const upstream = request(`http://${match[1]}${match[2]}`, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => res.writeHead(502).end());
    upstream.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  proxy = server;
  return { port: (server.address() as AddressInfo).port, seen };
}

/** node:http instead of happy-dom's fetch (see app.test.tsx); https://proxy.test is the proxy. */
const nodeFetch =
  (proxyPort: number): FetchLike =>
  (url, { signal }) =>
    new Promise((resolve, reject) => {
      const target = url.replace(/^https:\/\/proxy\.test/, `http://127.0.0.1:${proxyPort}`);
      const req = request(target, { signal }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: async () => body }));
      });
      req.on("error", reject);
      req.end();
    });

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("a proxy for the radios", () => {
  it("is set in Muga settings, and then speakers are reached through it", async () => {
    sim = await startSimulator();
    const { port, seen } = await startProxy();
    const storage = memory();
    registry = new RadioRegistry({
      storage,
      fetch: nodeFetch(port),
      controller: { activeIntervalMs: 100 },
      multiroom: { intervalMs: 60_000, settleMs: 0 },
    });
    const user = userEvent.setup();
    render(
      <PreferencesProvider storage={storage} initial={await loadPreferences(storage)}>
        <RegistryContext.Provider value={registry}>
          <App />
        </RegistryContext.Provider>
      </PreferencesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Muga settings" }));
    await user.type(screen.getByLabelText("Proxy address"), "http://proxy.test");
    await user.click(screen.getByRole("button", { name: "Use this proxy" }));
    expect(await screen.findByText("Enter an address that starts with https://.")).toBeTruthy();

    await user.clear(screen.getByLabelText("Proxy address"));
    await user.type(screen.getByLabelText("Proxy address"), "https://proxy.test");
    await user.click(screen.getByRole("button", { name: "Use this proxy" }));
    expect(
      await screen.findByText(/Muga reaches your radios through https:\/\/proxy\.test\./),
    ).toBeTruthy();
    expect(screen.getByText(/It reaches 127\.0\.0\.x\./)).toBeTruthy();
    expect(JSON.parse(storage.data.get("muga.preferences.v1") ?? "{}").proxy).toBe(
      "https://proxy.test",
    );

    // Connecting by address, as always: the requests go through the proxy.
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.type(screen.getByLabelText("IP address"), sim.host);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Muga Simulator" })).toBeTruthy();
    expect(seen.some((url) => url.startsWith(`/${sim?.host}/fsapi/`))).toBe(true);
  });
});
