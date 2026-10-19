import { ipv4ToU32 } from "@muga/fsapi-core";
import { type FormEvent, useId, useState } from "react";
import { type MessageId, useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import { useRegistry } from "../radio/hooks.ts";
import { hostAt, PIN_PATTERN, validPassphrase } from "../radio/settings.ts";
import type {
  NetworkChange,
  NetworkInfo,
  RadioSnapshot,
  WifiNetwork,
  WifiSecurity,
} from "../radio/types.ts";
import { ChipGroup } from "./ChipGroup.tsx";
import { Icon } from "./Icon.tsx";

interface Props {
  snapshot: RadioSnapshot;
  controller: RadioController;
}

const encoder = new TextEncoder();
const SECURITIES: WifiSecurity[] = ["WPA2", "WPA", "WEP", "NONE"];

/** How the speaker is connected, whether it stays connected in standby, and moving it. */
export function NetworkCard({ snapshot, controller }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState<{ address: string | undefined }>();
  const network = snapshot.settings.network;
  if (!network) return null;
  const online = snapshot.connection === "online";
  const name = snapshot.name;
  const rows: [MessageId, string][] = [
    [
      "settings.network.connection",
      network.connection === "ethernet"
        ? t("settings.network.ethernet")
        : network.connection === "wifi"
          ? network.ssid
            ? t("settings.network.wifiNamed", { ssid: network.ssid })
            : t("settings.network.wifi")
          : "",
    ],
    ["settings.network.address", network.address || snapshot.config.host],
    [
      "settings.network.addressing",
      network.dhcp === undefined
        ? ""
        : t(network.dhcp ? "settings.network.dhcp" : "settings.network.fixed"),
    ],
    ["settings.network.subnetMask", network.subnetMask],
    ["settings.network.gateway", network.gateway],
    ["settings.network.dns", network.dns.join(", ")],
    [
      "settings.network.mac",
      network.connection === "ethernet" ? network.ethernetMac : network.wifiMac,
    ],
  ];

  function keepConnected(on: boolean) {
    if (!on && !window.confirm(t("settings.network.keepConnectedConfirm", { name }))) return;
    void controller.settings.setKeepConnected(on);
  }

  return (
    <div className="card settings-card">
      <h3>{t("settings.network.title")}</h3>
      <dl className="facts">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        {network.signal !== undefined && (
          <div>
            <dt>{t("settings.network.signal")}</dt>
            <dd className="signal">
              <meter min={0} max={100} value={Math.min(100, network.signal)} />
              <span>{network.signal}</span>
            </dd>
          </div>
        )}
      </dl>
      {network.keepConnected !== undefined && (
        <div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={network.keepConnected}
              disabled={!online}
              onChange={(e) => keepConnected(e.currentTarget.checked)}
            />
            {t("settings.network.keepConnected")}
          </label>
          <p className="hint">{t("settings.network.keepConnectedHint")}</p>
        </div>
      )}
      {sent && (
        <p role="status">
          {sent.address
            ? t("settings.network.sentFixed", { name, address: sent.address })
            : t("settings.network.sent", { name })}
        </p>
      )}
      {network.editable && !editing && (
        <div>
          <button
            type="button"
            className="button button--ghost"
            disabled={!online}
            onClick={() => {
              setSent(undefined);
              setEditing(true);
            }}
          >
            {t("settings.network.change")}
          </button>
        </div>
      )}
      {editing && (
        <NetworkEditor
          snapshot={snapshot}
          controller={controller}
          network={network}
          onCancel={() => setEditing(false)}
          onSent={(address) => {
            setEditing(false);
            setSent({ address });
          }}
        />
      )}
    </div>
  );
}

type WifiPick = { kind: "stay" } | { kind: "scanned"; network: WifiNetwork } | { kind: "manual" };

interface EditorProps extends Props {
  network: NetworkInfo;
  onCancel(): void;
  /** The fixed address it was given, if any. */
  onSent(address: string | undefined): void;
}

/**
 * The radio's own web page's Network tab, inside Muga. A speaker on Ethernet can move to Wi-Fi,
 * but not the other way: radios don't say whether they have an Ethernet port, and choosing it
 * on one without would switch its Wi-Fi off (ADR 0019).
 */
function NetworkEditor({ snapshot, controller, network, onCancel, onSent }: EditorProps) {
  const t = useT();
  const id = useId();
  const registry = useRegistry();
  const scan = snapshot.settings.wifiScan;
  const onEthernet = network.connection === "ethernet";
  const [connection, setConnection] = useState<"wifi" | "ethernet">(
    onEthernet ? "ethernet" : "wifi",
  );
  const [pick, setPick] = useState<WifiPick>({ kind: "stay" });
  const [ssid, setSsid] = useState("");
  const [security, setSecurity] = useState<WifiSecurity>("WPA2");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [dhcp, setDhcp] = useState(network.dhcp ?? true);
  const [fixed, setFixed] = useState({
    address: network.address,
    subnetMask: network.subnetMask,
    gateway: network.gateway,
    dns1: network.dns[0] ?? "",
    dns2: network.dns[1] ?? "",
  });
  const [busy, setBusy] = useState(false);

  const wifi = connection === "wifi";
  // On Ethernet with no Wi-Fi network known yet, one has to be chosen.
  const canStay = !onEthernet || network.ssid !== "";
  const stay = pick.kind === "stay" && canStay;
  const joining = wifi && !stay;
  const needsPassphrase =
    joining &&
    (pick.kind === "scanned"
      ? pick.network.secured
      : pick.kind === "manual" && security !== "NONE");
  const passphraseOk =
    !needsPassphrase ||
    (pick.kind === "manual"
      ? validPassphrase(security, passphrase)
      : passphrase.length >= 5 && passphrase.length <= 64);
  const ssidOk =
    pick.kind !== "manual" || (ssid.trim() !== "" && encoder.encode(ssid.trim()).length <= 32);
  const addresses = dhcp
    ? []
    : [fixed.address, fixed.subnetMask, fixed.gateway, fixed.dns1, fixed.dns2].filter(
        (value, index) => index < 4 || value.trim() !== "",
      );
  const addressesOk = addresses.every((value) => ipv4ToU32(value) !== undefined);
  const badAddress = addresses.some((value) => value.trim() && ipv4ToU32(value) === undefined);
  const addressingChanged =
    dhcp !== network.dhcp ||
    (!dhcp &&
      (fixed.address.trim() !== network.address ||
        fixed.subnetMask.trim() !== network.subnetMask ||
        fixed.gateway.trim() !== network.gateway ||
        fixed.dns1.trim() !== (network.dns[0] ?? "") ||
        fixed.dns2.trim() !== (network.dns[1] ?? "")));
  const changed = connection !== network.connection || joining || addressingChanged;
  const chosen = !wifi || stay || pick.kind !== "stay";
  const valid = changed && chosen && passphraseOk && ssidOk && addressesOk;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !window.confirm(t("settings.network.confirm", { name: snapshot.name }))) return;
    const address = fixed.address.trim();
    const change: NetworkChange = {
      connection,
      ...(joining
        ? {
            wifi: {
              network:
                pick.kind === "scanned"
                  ? { kind: "scanned", ...pick.network }
                  : { kind: "manual", ssid: ssid.trim(), security },
              passphrase: needsPassphrase ? passphrase : "",
            },
          }
        : {}),
      addressing: dhcp
        ? { dhcp: true }
        : {
            dhcp: false,
            address,
            subnetMask: fixed.subnetMask.trim(),
            gateway: fixed.gateway.trim(),
            dns: [fixed.dns1.trim(), fixed.dns2.trim()],
          },
    };
    setBusy(true);
    const done = await controller.settings.changeNetwork(change);
    setBusy(false);
    if (!done) return;
    const next = dhcp ? undefined : hostAt(snapshot.config.host, address);
    if (next) void registry.expectAt(snapshot.config.id, next);
    onSent(dhcp ? undefined : address);
  }

  const field = (key: keyof typeof fixed, label: MessageId) => (
    <div className="field">
      <label htmlFor={`${id}-${key}`}>{t(label)}</label>
      <input
        id={`${id}-${key}`}
        value={fixed[key]}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          const value = e.currentTarget.value;
          setFixed((f) => ({ ...f, [key]: value }));
        }}
      />
    </div>
  );

  return (
    <form className="network-editor" onSubmit={submit}>
      {onEthernet && (
        <ChipGroup label={t("settings.network.connection")}>
          <button
            type="button"
            className="chip"
            aria-pressed={connection === "ethernet"}
            onClick={() => setConnection("ethernet")}
          >
            {t("settings.network.useEthernet")}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={wifi}
            onClick={() => setConnection("wifi")}
          >
            {t("settings.network.useWifi")}
          </button>
        </ChipGroup>
      )}
      {wifi && (
        <fieldset className="network-editor__group">
          <legend>{t("settings.network.wifiNetwork")}</legend>
          {canStay && (
            <label className="choice">
              <input
                type="radio"
                name={`${id}-wifi`}
                checked={pick.kind === "stay"}
                onChange={() => setPick({ kind: "stay" })}
              />
              {network.ssid
                ? t("settings.network.stay", { ssid: network.ssid })
                : t("settings.network.stayCurrent")}
            </label>
          )}
          {scan?.networks.map((found) => (
            <label className="choice" key={found.key}>
              <input
                type="radio"
                name={`${id}-wifi`}
                checked={pick.kind === "scanned" && pick.network.key === found.key}
                onChange={() => setPick({ kind: "scanned", network: found })}
              />
              <span className="choice__label">{found.ssid}</span>
              <span className="choice__meta">
                {found.secured && <Icon name="lock" size={14} />}
                {t(found.secured ? "settings.network.secured" : "settings.network.open")}
                {` · ${found.signal}`}
              </span>
            </label>
          ))}
          <label className="choice">
            <input
              type="radio"
              name={`${id}-wifi`}
              checked={pick.kind === "manual"}
              onChange={() => setPick({ kind: "manual" })}
            />
            {t("settings.network.other")}
          </label>
          <div>
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={scan?.status === "scanning" || snapshot.connection !== "online"}
              onClick={() => void controller.settings.scanWifi()}
            >
              {t("settings.network.scan")}
            </button>
          </div>
          {scan?.status === "scanning" && (
            <p className="hint" role="status">
              {t("settings.network.scanning")}
            </p>
          )}
          {scan?.status === "failed" && (
            <p className="form-error">{t("settings.network.scanFailed")}</p>
          )}
          {scan?.status === "ready" && scan.networks.length === 0 && (
            <p className="hint" role="status">
              {t("settings.network.noNetworks")}
            </p>
          )}
          {pick.kind === "manual" && (
            <>
              <div className="field">
                <label htmlFor={`${id}-ssid`}>{t("settings.network.ssid")}</label>
                <input
                  id={`${id}-ssid`}
                  value={ssid}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setSsid(e.currentTarget.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-security`}>{t("settings.network.security")}</label>
                <select
                  id={`${id}-security`}
                  value={security}
                  onChange={(e) => setSecurity(e.currentTarget.value as WifiSecurity)}
                >
                  {SECURITIES.map((s) => (
                    <option key={s} value={s}>
                      {t(`settings.network.security.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          {needsPassphrase && (
            <div className="field">
              <label htmlFor={`${id}-passphrase`}>{t("settings.network.passphrase")}</label>
              <input
                id={`${id}-passphrase`}
                type={showPassphrase ? "text" : "password"}
                value={passphrase}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setPassphrase(e.currentTarget.value)}
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showPassphrase}
                  onChange={(e) => setShowPassphrase(e.currentTarget.checked)}
                />
                {t("settings.network.showPassphrase")}
              </label>
              <p className="hint">{t("settings.network.passphraseHint")}</p>
            </div>
          )}
          {needsPassphrase && passphrase !== "" && !passphraseOk && (
            <p className="form-error">{t("settings.network.invalidPassphrase")}</p>
          )}
        </fieldset>
      )}
      <fieldset className="network-editor__group">
        <legend>{t("settings.network.addressing")}</legend>
        <ChipGroup label={t("settings.network.addressing")}>
          <button type="button" className="chip" aria-pressed={dhcp} onClick={() => setDhcp(true)}>
            {t("settings.network.dhcp")}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={!dhcp}
            onClick={() => setDhcp(false)}
          >
            {t("settings.network.fixed")}
          </button>
        </ChipGroup>
        {!dhcp && (
          <>
            {field("address", "settings.network.address")}
            {field("subnetMask", "settings.network.subnetMask")}
            {field("gateway", "settings.network.gateway")}
            {field("dns1", "settings.network.dns1")}
            {field("dns2", "settings.network.dns2")}
          </>
        )}
        {badAddress && <p className="form-error">{t("settings.network.invalidAddress")}</p>}
      </fieldset>
      <div className="form-actions">
        <button
          type="submit"
          className="button"
          disabled={!valid || busy || snapshot.connection !== "online"}
        >
          {t("settings.network.apply")}
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          {t("settings.network.cancel")}
        </button>
      </div>
    </form>
  );
}

/** Changing the PIN the speaker asks controllers for; Muga keeps using the new one. */
export function PinCard({ snapshot, controller }: Props) {
  const t = useT();
  const id = useId();
  const registry = useRegistry();
  const [pin, setPin] = useState("");
  const [saved, setSaved] = useState(false);
  if (!snapshot.settings.pinChangeable) return null;
  const current = snapshot.config.pin;
  const valid = PIN_PATTERN.test(pin) && pin !== current;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (!valid || !window.confirm(t("settings.pin.confirm", { name: snapshot.name, pin }))) {
      return;
    }
    if (await controller.settings.changePin(pin)) {
      registry.updatePin(snapshot.config.id, pin);
      setPin("");
      setSaved(true);
    }
  }

  return (
    <form className="card settings-card" onSubmit={submit}>
      <h3>{t("settings.pin.title")}</h3>
      <p className="hint">{t("settings.pin.current", { pin: current })}</p>
      <div className="field">
        <label htmlFor={id}>{t("settings.pin.label")}</label>
        <input
          id={id}
          value={pin}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          onChange={(e) => {
            setPin(e.currentTarget.value.replace(/\D/g, ""));
            setSaved(false);
          }}
        />
        <p className="hint">{t("settings.pin.hint")}</p>
      </div>
      <p className="hint">{t("settings.pin.warning")}</p>
      <div className="form-actions">
        <button
          type="submit"
          className="button"
          disabled={!valid || snapshot.connection !== "online"}
        >
          {t("settings.pin.save")}
        </button>
        {saved && (
          <span className="hint" role="status">
            {t("settings.pin.saved")}
          </span>
        )}
      </div>
    </form>
  );
}
