# 0012: Browsers that can't reach the radios from the website

Date: 2026-10-16. Status: accepted.

## Context

From `https://muga.calvellido.es/`, only Chrome and Edge reach the radios, through Local Network Access (ADR 0010). Other browsers block the radios' plain HTTP from an https page as mixed content. This records where those browsers stand, the iPhone workarounds that were considered, and when to look again.

## Checked

**Firefox 157 on Linux**, on 2026-10-16. It ran headless, driven through WebDriver BiDi, with the published site talking to the simulator on this computer's network address.

| Setup | Request to the speaker |
| --- | --- |
| Defaults | Failed at once (`NetworkError`) |
| `local-network` permission granted | Failed at once |
| Granted, and `targetAddressSpace: "local"` | Failed at once |
| Mixed content blocking off (`security.mixed_content.block_active_content`), not granted | Waited for the permission prompt |
| Mixed content blocking off, granted | Answered |
| From a plain-HTTP page on the same network (Muga served at home) | Answered, with no prompt |

- **What Firefox has:** Local Network Access, on by default since Firefox 153. It uses the spec's permission names, `local-network` and `loopback-network`, not Chrome's `local-network-access`.
- **Why it still fails:** its mixed content check runs first, with no exemption for local addresses, so the permission never applies to an https page. This is [Mozilla bug 2081728](https://bugzilla.mozilla.org/show_bug.cgi?id=2081728), filed for `.local` names and `targetAddressSpace` and still unconfirmed, under the [Local Network Access meta bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1481298).
- **A workaround, with a cost:** with `security.mixed_content.block_active_content` set to `false` in `about:config`, the requests reach the local network permission, and once that's allowed, they go through. On 2026-10-16 the user confirmed that the published app then works in Firefox. But the setting applies to every site: any https page may then load scripts, frames and requests over plain HTTP, which anyone on the network path can read or change. Firefox keeps settings per profile, so a profile used only for Muga keeps the cost to Muga.
- **Chrome 155**, for comparison, knows all three permission names.

**Safari and WebKit**, from WebKit's bug tracker on 2026-10-16:

- **Underway:** WebKit is implementing Local Network Access ([meta bug 250607](https://bugs.webkit.org/show_bug.cgi?id=250607)), and its [standards position](https://github.com/WebKit/standards-positions/issues/163) is supportive. The check itself landed on 2026-09-11 ([bug 319907](https://bugs.webkit.org/show_bug.cgi?id=319907)), with a permission for tests only and no prompt yet.
- **Still open:**
  - using the check for requests ([bug 319908](https://bugs.webkit.org/show_bug.cgi?id=319908));
  - turning it on by default ([bug 295047](https://bugs.webkit.org/show_bug.cgi?id=295047));
  - not treating loopback addresses as mixed content ([bug 171934](https://bugs.webkit.org/show_bug.cgi?id=171934)).

  No listed bug covers the exemption Muga needs, for private addresses and `.local` names.
- **Plain-HTTP pages:** the new check refuses local requests from them. A public plain-HTTP copy of Muga would stop working then; a copy served at home is on the same network, so it isn't affected.

**Other routes for the iPhone**, considered and not taken:

- **Another browser engine:** since iOS 17.4, browsers in the EU may use their own engine, and since iOS 18.2 they can add web apps to the home screen. None has shipped; Chrome for iPhone still uses WebKit.
- **A public copy over plain HTTP:**
  - It works in Safari today, but without a service worker, so not offline.
  - It needs a host with no HTTPS at all, because Safari tries HTTPS first since iOS 18.2.
  - It can be altered on the way.
  - WebKit's coming check blocks it.
- **Scriptable, or iPhone Shortcuts (Siri, widgets):** both can reach the radios, but neither is Muga. Not wanted.
- **Ruled out:**
  - Shortcuts as a bridge from the website: it switches apps for every request.
  - A web server app on the phone: iOS suspends it in the background.
  - A bookmarklet run on a radio's own page: fragile.

## Decisions

1. **Wait for the browsers.** Nothing is built around them. The workaround stays as in ADR 0010: Muga served at home over plain HTTP, which works in Safari, on iPhone and iPad, and in Firefox.
2. **Muga keeps asking for Chrome's permission name**, `local-network-access`, to tell whether an https page can reach the radios. Firefox knows `local-network` but still blocks the requests. Asking for that name would tell Firefox users to allow a prompt that never comes.
3. **The README says where Muga works**, in a few lines. The details stay here.
4. **The README mentions Firefox's setting**, as a trade-off: what to change, that it lowers a protection for every site, and to keep it to a profile for Muga. Muga can't read the setting, so it still counts Firefox as blocked. Its notice still shows there, and the README says it can be ignored.

## When to look again

- **WebKit:** when Local Network Access is on by default with a prompt, and private addresses are exempt from mixed content. Then test the published site on an iPhone, and update how Muga detects support (Safari may know only `local-network`).
- **Firefox:** when bug 2081728, or another bug, exempts local addresses. The same update applies, and the README's note about the setting can go.
- **Chrome:** if it drops the `local-network-access` name, Muga has to ask for `local-network` and tell Firefox apart some other way.
