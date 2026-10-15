# 0005: Menu browsing and preset editing

Date: 2026-10-15. Status: accepted.

## Decisions

1. **Protocol steps live in `fsapi-core` (`nav.ts`), UI state in the web app.** The core library has these steps, which the CLI (`muga browse`) and the web app share:
   - `enableNav`, `resetNav`, `navigate`, `selectNavItem`, `searchNav`;
   - `readNavInfo`, `readNavPage`;
   - `settleNav`, `waitForNav`.

   Each follows UNDOK (Analysis doc 05 §3): wait on `nav.status` after every step, 30 s limit, `0xFFFFFFFF` for "up", pages of 14, search as one `SET_MULTIPLE` of `nav.searchTerm` and `nav.action.navigate`, and one retry of `selectItem` on `FS_TRY_AGAIN`. Polls start at 100 ms and double up to 500 ms (UNDOK always waits 500 ms). The radio usually settles in under 300 ms.
2. **Navigation states as the radio reports them.** `FS_NODE_BLOCKED` on `nav.status` means navigation is off, and so does `nav.state` OFF (also after a source change and in standby).
   - `enableNav` turns navigation on, waits while WAITING, and returns where the status settled without throwing, as UNDOK's ensureNavReady does. Presets use it. A source without a menu settles on FATAL_ERR, yet its preset list still reads.
   - `resetNav` and `navigate` need READY or READY_ROOT; anything else is a `NavFailure`.
   - There's no grace period for a stale FAIL: on the ICD2018 the status reads WAITING within about 10 ms of `nav.state=ON`.
3. **The radio holds the menu position; the app mirrors it as a path.** The web app keeps a path of folders (key and name) and searches (key and term). Opening the Browse tab resets the menu (`nav.state` OFF then ON) and replays the path, as UNDOK does. If the replay fails, it starts again from the top menu. When a step is refused (an `FS_*` status or a navigation failure), the app replays the path once and retries, because someone may have used the radio's own menu. "Back" goes up one level, from search results too (one step on the ICD2018, where UNDOK rebuilds the level), and rebuilds the level only if the radio refuses.
4. **Steps run one at a time, and stale results are dropped.** Browsing steps are queued. A step skips itself if the level changed while it waited. A source change or standby invalidates the session, and a running step then discards its result.
5. **`nav.caps` is per source.** It's re-read with the track details, so it follows source changes. The Browse tab shows when bit 0 (navigation) is set, or while `nav.caps` is unknown.
6. **Preset editing follows the radio's capabilities, with no write probes.**
   - **Store** (`play.addPreset`) needs `play.caps` AddPreset.
   - **Delete** (`nav.preset.delete`) and **reorder** need `nav.caps` bit 2 (preset editing). UNDOK probes delete support by writing an out-of-range key. Muga doesn't; it learns from `FS_NODE_DOES_NOT_EXIST` instead.
   - **Reorder** swaps neighbours with two `LIST_SET` calls (name, type, url), as UNDOK does. Moving into an empty slot writes the preset there and deletes the original. Reorder is offered only when every stored preset has the `url` field UNDOK sends back. Rewriting a preset without it could leave a slot that doesn't play.
7. **A menu that doesn't open says so.** If the top menu fails to open (DAB before any scan reports FATAL_ERR), the Browse tab says there's nothing to browse right now, rather than showing an error.
8. **Unsupported menu items are shown, not hidden.** Forms, logins (OAuth) and unknown item types appear as disabled entries marked "Not available in Muga yet". Message and error items appear as text.

## Checked on a real radio

On 2026-10-15, on an ICD2018 (FS2026, V2.13.21c), with Muga's own browse and preset code against the radio:

- **Standby, or `nav.state` OFF:** reading `nav.status`, `nav.list` or `nav.presets` answers `FS_NODE_BLOCKED`.
- **Source change:** turns `nav.state` OFF.
- **`nav.caps` per source:**
  - Internet radio: 3 (menu and presets);
  - FM: 2 (presets only);
  - DAB: 3.
  - None of them sets preset editing, and `nav.preset.delete` doesn't exist on this firmware.
- **FM:** with navigation on, `nav.status` is FATAL_ERR, but the 20-slot preset list reads (names padded: " 90.80MHz").
- **DAB with no stations:** FATAL_ERR, `numItems` −1.
- **Internet radio:** WAITING, then READY_ROOT after about 280 ms. Search sits under "Estaciones", and depth counts search results as a level. Paging from the last key works (103-item list).
- **Presets:** fields are `name` and `type` only (no `url`, `uniqid` or `blob`), so reorder isn't offered there.
- **No current preset:** `nav.preset.currentPreset` doesn't exist.

## Consequences

- Opening the Browse tab moves the radio's menu, as UNDOK does.
- Keys are positions in the current level. If the menu changes underneath without a refusal, a tap can open the wrong entry; replaying the path doesn't catch that. UNDOK has the same limit.
- Reordering touches only `name`, `type` and `url`, so a moved preset may lose its artwork or `blob`, as with UNDOK.
- The simulator now models menus per source (`SimProfile.modes`), following the ICD2018:
  - nav nodes are blocked while navigation is off;
  - a source without a menu reports FATAL_ERR, with presets still readable;
  - a source change turns navigation off.

  It also serves undeclared list fields, such as a preset's `url`, and can hold `nav.status` at WAITING (`navDelayMs`).
