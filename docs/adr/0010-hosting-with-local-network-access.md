# 0010: Hosting on HTTPS, with Local Network Access

Date: 2026-10-16. Status: accepted.

## Context

Muga is published at `https://calvellido.es/muga/` (GitHub Pages), to be installed from there on a computer or a phone and then used without the website: everything it does happens on the local network. Radios only speak plain HTTP, and browsers block plain-HTTP requests from HTTPS pages as mixed content (ADR 0001).

Nothing web-only can bridge that. A service worker is bound by the same rules as the page, and the website can't reach anyone's home network. A proxy would have to run at home, which is the hub.

Chrome's [Local Network Access](https://developer.chrome.com/blog/local-network-access) changes it for Chromium browsers. A public page needs the user's permission ("local network access") to send requests to local addresses. With that permission, requests to private IP addresses and `.local` names are exempt from mixed content checks. WebKit, so Safari and every browser on iPhone and iPad, and Firefox have no such exemption that could be found.

## Checked

On 2026-10-16, a `/muga/` build was served over HTTPS and opened in Chrome 155 (headless), talking to the simulator on this computer's network address. With `--ip-address-space-overrides`, the page counts as public, as on `calvellido.es`.

- **Before the permission:** requests to the speaker were refused: "Permission was denied for this request to access the local network". Headless Chrome declines the prompt; a user sees a prompt.
- **With the permission:** requests went through, with a console warning about mixed content, and Muga connected through its own UI. Artwork from the speaker's private address loaded too, without being upgraded to HTTPS.
- **Offline:** the service worker served the app with the web server stopped, in a reload and in a new window, and the speaker still answered.
- **For contrast:** the same page treated as local or loopback reached the speaker without a permission.

## Decisions

1. **The supported way to use Muga is the installed app from `https://calvellido.es/muga/`, in Chrome or Edge, on a computer or Android.** After installing, it needs the website only for updates.
2. **The build takes its path from `MUGA_BASE`.** The default is `/`; Pages builds use `/muga/`. The manifest's `id`, `start_url` and `scope` follow it, so the installed app stays inside `/muga/`. In-app asset URLs use `import.meta.env.BASE_URL`.
3. **Muga says when the browser is the problem.** On a secure page it asks for the `local-network-access` permission's state:
   - unknown to the browser (Safari, Firefox): "can't reach your radios from this page", with what works instead;
   - denied: how to turn it back on;
   - not decided yet: a hint to allow the browser's question.

   A connection error, and an unreachable speaker, mention the browser instead of the radio in those cases. Plain-HTTP pages (served at home, or `localhost`) are unaffected.
4. **Pages is deployed by a workflow on every push to `main`** (`.github/workflows/pages.yml`), with actions pinned like CI's. Pages has to be enabled once in the repository settings, with "GitHub Actions" as the source.
5. **iPhone and iPad:** the website can't reach the radios there, so the app says so. The options are to serve Muga at home over plain HTTP (README), and later a native wrapper or the hub.

## Consequences

- **Logos:** station logos at public plain-HTTP addresses may be upgraded to HTTPS by Chrome and fail; Muga then shows its placeholder. Logos served by the radio itself load.
- **First run:** the local network prompt appears the first time a radio is contacted.
- **Discovery:** still by IP address, plus multiroom discovery (ADR 0008); there's no SSDP in a browser.
