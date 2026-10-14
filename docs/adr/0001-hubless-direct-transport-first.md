# 0001: Hub-less, direct-to-radio first

Date: 2026-10-14. Status: accepted.

## Context

A browser can only read FSAPI replies if the radio sends CORS headers. On 2026-10-14 all four target radios returned `Access-Control-Allow-Origin: *` to a read-only GET:

- Eliteline ICD2018, V2.13.21c;
- Silvercrest SMRS35A1, V2.11.11;
- Silvercrest SMRS30A1, V2.11.11;
- Ruark MRx, V2.14.35.

The remaining constraints:

- HTTPS pages can't call `http://` radios (mixed content).
- Browsers can't run SSDP/mDNS.
- Each radio allows a single session.

## Decision

- Build the web app talking to radios **directly from the browser** first. Serve it from `localhost` on the desktop (secure context, installable).
- Radios are added by IP.
- Live state comes from **polling plain GETs**, which needs no session and so doesn't take over from other controllers.
- `@muga/fsapi-core` keeps the transport injectable (`fetch`-like function), so a LAN hub (discovery, notification fan-out, HTTPS) or native shells can be added later without changing the protocol code.

## Consequences

- No automatic discovery yet, and no proper install on the phone until the app is served from the LAN (plan §4.2, options B/C).
- `NotificationSession` exists for the future hub and for the CLI, but the web app should prefer polling.
- Any web page the user opens can also reach the radios (Analysis doc 08, S18). That's not something Muga can fix, but it shouldn't make it worse.
