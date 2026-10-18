# 0017: A proxy for the radios

Date: 2026-10-18. Status: accepted.

## Context

From `https://muga.calvellido.es/`, only Chrome and Edge reach the radios, through Local Network Access (ADR 0010). Safari, so every browser on iPhone and iPad, and Firefox block the radios' plain HTTP as mixed content (ADR 0012). The radios have no HTTPS ([radio firmware wishes](../radio-firmware-wishes.md)).

An HTTPS proxy on the home network removes the mixed content. The page calls the proxy over HTTPS, and the proxy calls the radio over HTTP. It needs an always-on machine at home, as the hub would, but no code of its own: Caddy and a configuration file.

## Checked

On 2026-10-18, on a Home Assistant Green (Home Assistant 2026.10.2):

- **The certificate:** the DuckDNS add-on published a duckdns.org name pointing to the Green's local address (its `ipv4` option). It obtained a Let's Encrypt certificate through DuckDNS's DNS challenge. Nothing was reachable from the internet. The router resolved the name to the local address.
- **The proxy:** the Caddy 2 add-on (host network) used that certificate from `/ssl`, with the [Caddyfile](../proxy/Caddyfile) in `docs/proxy`. From a desktop:
  - three radios answered through it, in under 0.25 s, with their `Access-Control-Allow-Origin: *` intact;
  - the router's pages, other paths and addresses outside the range got 404;
  - an empty address got 502 after 3 s.
- **On an iPhone,** in Safari on the published site, a speaker connected as `https://<name>/<radio IP>/fsapi` worked: playback, volume and browsing.
- **Renewals:** Caddy reads certificate files only when it starts, and DuckDNS renews 30 days before expiry, while the old certificate stays valid. Home Assistant's Certificate Expiry integration watches the certificate Caddy serves. A daily automation restarts Caddy when that certificate expires within 29 days, which means a renewed one is waiting. It leaves a notification if, after the restart, the certificate still expires within 10 days.

## Decisions

1. **A proxy contract,** documented in [docs/proxy](../proxy/README.md):
   - `/<radio IP>/fsapi/…` and `/<radio IP>/device` are forwarded to the radio;
   - `/muga-proxy` answers `{"muga":1,"ranges":[…]}` with the address ranges it reaches;
   - anything else is refused.

   The repository ships a Caddyfile that follows it and a Home Assistant guide. Other proxies can follow the contract too.
2. **Transparent to the rest of Muga.** Speakers keep their IP addresses. With a proxy in Muga settings, every plain-HTTP request to an IP address is sent to `https://<proxy>/<IP>/…` instead. That covers the controllers, multiroom, connecting, finding speakers and following moved ones. A proxy's own address and `.local` names go out as they are.
3. **Set in Muga settings,** in this browser, like the language and theme (ADR 0014):
   - only an `https://` address is accepted;
   - Muga asks it for `/muga-proxy` before saving it, so a typo or a wrong machine is caught;
   - the ranges it reaches are shown.

   Changing it reaches every speaker the new way right away.
4. **"Find speakers" asks the proxy where to look.** Through a proxy, the browser can't check which network has a router, so it scans the ranges `/muga-proxy` lists. As without a proxy, the saved speakers' ranges come first.
5. **No "can't reach your radios" warnings with a proxy.** A browser that blocks local requests (ADR 0010) reaches the radios through the proxy, so Muga treats it as able to. The warning for such browsers now also mentions the proxy.

## Consequences

- **iPhone, iPad, Safari and Firefox** can use the published app, installed too, with a proxy at home.
- **Away from home** the proxy isn't reachable, unless the home network is reached through a VPN such as Tailscale.
- **Artwork** that a radio serves from its own address isn't forwarded: the contract only covers FSAPI and `/device`.
- **Chrome and Edge** can use the proxy too. They still ask for local network access, since the proxy's name points to a local address.
- **The hub (later)** could follow the same contract, so Muga wouldn't need to tell them apart.
