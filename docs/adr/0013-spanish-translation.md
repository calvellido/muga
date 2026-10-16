# 0013: Spanish translation

Date: 2026-10-16. Status: accepted.

## Context

Every UI string already has a message id, with English as the source catalog (ADR 0004, decision 5). Spanish is the first other language.

UNDOK's own Spanish was looked at for terms only. It mixes "Presets" with "Preajuste", "Standby" with "modo de espera", and the informal "tú" with the formal "usted", so it isn't followed.

## Decisions

1. **Spanish from Spain, with the informal "tú"**, as in Chrome's own Spanish. Every Spanish variant (`es-ES`, `es-MX`, …) gets it.
2. **The language follows the browser's preferred languages**: the first supported one wins, otherwise English. There's no choice inside Muga yet.
3. **The catalog is loaded only when needed**: `messages/es.json` is a separate download of about 14 KB, and the service worker caches it for offline use.
4. **One word per idea**, keeping ADR 0009's verbs:

   | English | Spanish |
   | --- | --- |
   | speaker | altavoz |
   | connect / forget (a speaker) | conectar / olvidar |
   | preset (a station) | presintonía |
   | preset (equalizer) | preajuste |
   | standby | en espera |
   | source | fuente |
   | browse | explorar |
   | station | emisora |
   | multiroom group | grupo multisala |
   | leads (a group) | lidera |
   | ungroup | desagrupar |
   | sleep timer | temporizador de apagado |
   | streaming quality | calidad de transmisión |
   | not reachable | no responde |
   | plain HTTP | HTTP sin cifrar |
   | the "Local network access" permission | «Red local», Chrome's own Spanish name for it |

5. **Typography:**
   - «» for quotes;
   - opening ¿ and ¡;
   - a plain hyphen, never a long dash.

6. **Left as they are:**
   - **Text from the radio:** station and source names, menus, equalizer presets and time zones, in the radio's own language (its "Radio language" setting).
   - **Technical details in error messages**, which come from the protocol.
   - **"Loudness"**, as Spanish hi-fi menus call it.
   - **The install manifest's description.**

## Consequences

- **New messages:** a message added to `en.json` needs its Spanish too. A test checks that every language has exactly the English keys, and that every message is valid ICU and renders in each language.
- **Checked:** the app was looked at in Spanish against the simulator, on a desktop and a phone, with no text overflowing.
