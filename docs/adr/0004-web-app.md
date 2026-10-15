# 0004: Web app (hub-less PWA)

Date: 2026-10-14. Status: accepted.

## Decisions

1. **Direct transport, plain HTTP.** The app runs on `http://localhost` (a secure context, so service workers and install work) and calls radios at `http://<ip>/fsapi` directly (ADR 0001). It must never be served over HTTPS without a hub, because mixed-content rules would block every radio request.
2. **Polling, not sessions.** Each radio gets a `RadioController` that polls plain GETs:
   - every 2 s for the selected radio and every 15 s for the others;
   - backing off while a radio is offline;
   - paused while the page is hidden.

   Track details (artist, artwork, caps, …) are re-read only when the track changes, or every 5th poll. This mirrors UNDOK's notification-driven refresh, without taking the radio's single session.
3. **Framework-free state.** Controllers and the registry are plain classes exposing `subscribe`/`getSnapshot`, read through `useSyncExternalStore`. They're tested against `@muga/fsapi-sim` without a DOM.
4. **Radio-like UX rules from the analysis:**
   - choosing a source in standby powers on first;
   - volume uses latest-wins with one SET in flight;
   - play/pause/stop follows `play.caps`;
   - presets require `nav.caps` bit 1 and "navigation ready" (`nav.state=ON`, then wait on `nav.status`);
   - artwork is upgraded from 150×150 to 500×500.
5. **Typed message IDs instead of message extraction.** `en.json` is the source catalog; `MessageId = keyof typeof en`, so a missing key is a type error. A test checks that every locale file has exactly the English keys and that every message parses as ICU. This deviates from the plan's `@formatjs/cli` extraction step. It's simpler, with the same safety.
6. **Accessibility basics:**
   - labelled icon buttons;
   - a `fieldset` for transport;
   - ARIA tabs with arrow keys;
   - the off-canvas drawer is `inert` while closed, and focus moves into it when it opens and back to the switcher when it closes;
   - visible focus rings;
   - reduced-motion support.
7. **Storage is best-effort.** `localStorage` access is wrapped (private browsing, blocked storage). Radios (host, PIN, name, id) and the selected radio are stored per browser. PINs are stored in plain text there; they also travel in plain text on the LAN (Analysis doc 08, S1).

## Consequences

- No live push: changes made elsewhere (radio buttons, UNDOK) appear within about 2 s.
- No discovery yet: radios are connected by IP address.
- happy-dom's fetch preflights simple GETs (real browsers don't), so the UI test injects a `node:http` transport.
