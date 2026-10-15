# 0005: Menu browsing and preset editing

Date: 2026-10-15. Status: accepted.

## Decisions

1. **Protocol steps live in `fsapi-core` (`nav.ts`), UI state in the web app.** The core library has these steps, which the CLI (`muga browse`) and the web app share:
   - `ensureNavReady`, `resetNav`, `navigate`, `selectNavItem`, `searchNav`;
   - `readNavInfo`, `readNavPage`;
   - `waitForNav`.

   Each follows UNDOK (Analysis doc 05 §3): wait on `nav.status` after every step, 500 ms polls, 30 s limit, `0xFFFFFFFF` for "up", pages of 14, search as one `SET_MULTIPLE` of `nav.searchTerm` and `nav.action.navigate`, and one retry of `selectItem` on `FS_TRY_AGAIN`.
2. **Tolerate FAIL briefly after turning navigation on.** For 2 s after `nav.state=ON`, a FAIL status keeps the wait going; after that it ends it. Whether real firmware reports FAIL for a moment before WAITING is unverified, so this is a cheap guard.
3. **The radio holds the menu position; the app mirrors it as a path.** The web app keeps a path of folders (key and name) and searches (key and term). Opening the Browse tab resets the menu (`nav.state` OFF then ON) and replays the path, as UNDOK does. When a step is refused (an `FS_*` status or a navigation failure), the app replays the path once and retries, because someone may have used the radio's own menu. Leaving search results replays the path instead of going up.
4. **Steps run one at a time, and stale results are dropped.** Browsing steps are queued. A step skips itself if the level changed while it waited. A source change or standby invalidates the session, and a running step then discards its result.
5. **`nav.caps` is per source.** It's re-read with the track details, so it follows source changes. The Browse tab shows when bit 0 (navigation) is set, or while `nav.caps` is unknown.
6. **Preset editing follows the radio's capabilities, with no write probes.**
   - **Store** (`play.addPreset`) needs `play.caps` AddPreset.
   - **Delete** (`nav.preset.delete`) and **reorder** need `nav.caps` bit 2 (preset editing). UNDOK probes delete support by writing an out-of-range key. Muga doesn't; it learns from `FS_NODE_DOES_NOT_EXIST` instead.
   - **Reorder** swaps neighbours with two `LIST_SET` calls (name, type, url), as UNDOK does. Moving into an empty slot writes the preset there and deletes the original. Reorder is offered only when every stored preset has the `url` field UNDOK sends back. Rewriting a preset without it could leave a slot that doesn't play.
7. **Unsupported menu items are shown, not hidden.** Forms, logins (OAuth) and unknown item types appear as disabled entries marked "Not available in Muga yet". Message and error items appear as text.

## Consequences

- Opening the Browse tab moves the radio's menu, as UNDOK does.
- Keys are positions in the current level. If the menu changes underneath without a refusal, a tap can open the wrong entry; replaying the path doesn't catch that. UNDOK has the same limit.
- Reordering touches only `name`, `type` and `url`, so a moved preset may lose its artwork or `blob`, as with UNDOK.
- The simulator now models menus per source (`SimProfile.modes`). It also serves undeclared list fields, such as a preset's `url`, and can hold `nav.status` at WAITING (`navDelayMs`).
