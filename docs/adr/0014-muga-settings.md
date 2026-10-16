# 0014: Muga settings (language and theme)

Date: 2026-10-16. Status: accepted.

## Context

Muga followed the browser for its language (ADR 0013) and the device for light or dark. Both should also be choosable in Muga, and more app-wide settings will come. A speaker already has its own settings page, behind the sliders button in its header.

## Decisions

1. **A "Muga settings" page.**
   - **With speakers:** a "Muga settings" row with a gear, at the foot of the speaker list (the sidebar on a computer, the drawer on a phone), above the tagline. Its text label keeps it apart from a speaker's settings button. It was first a gear next to the logo, which looked cramped there.
   - **Before any speaker:** the welcome screen has no speaker list, so a gear sits at the right edge of the top bar. The desktop welcome screen now keeps the top bar too, so the language can be changed before connecting anything.
   - **What it shows:** the page opens in the main area, like a speaker's settings, with a back button.
   - **Leaving it:** picking or connecting a speaker shows that speaker.
   - **Naming:** "Muga settings" in English and "Ajustes de Muga" in Spanish, so they aren't confused with a speaker's settings.
2. **Language:** Automatic, English or Español.
   - **Automatic** says what it resolves to, for example "Automatic (English)".
   - **Language names** are written in their own language, with a matching `lang` attribute.
   - **Switching** loads the other language's messages and applies them without reloading the page.
3. **Theme:** Automatic, Light or Dark.
   - **Automatic** follows the device (`prefers-color-scheme`).
   - **A forced theme** sets `data-theme` on `<html>`, and that only sets `color-scheme`. The colour tokens use `light-dark()`, so each is defined once for both themes (Chrome 123, Firefox 120, Safari 17.5 and later).
   - **The address bar's colour** (`theme-color`) follows the chosen theme too.
4. **Kept in this browser**, like the speakers: `localStorage` key `muga.preferences.v1`.
   - **Best effort:** if it can't be read, or holds unknown values, everything counts as automatic.
   - **Not shared between devices.** Sharing is a later topic, together with sharing speakers.
   - **Applied before the first render**, so a reload doesn't flash the other theme or language.

## Consequences

- **More settings:** app-wide settings go on this page, as cards like a speaker's settings.
- **Older browsers:** without `light-dark()`, colours would be missing. They're older than Muga's other requirements, such as Local Network Access in Chrome (ADR 0010).
