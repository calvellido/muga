# 0009: "Connect" and "Forget" a speaker

Date: 2026-10-15. Status: accepted.

## Context

Muga keeps a list of speakers, "your speakers". Bringing a speaker into that list was called "Add". Multiroom made that ambiguous: the drawer lists a group's speakers, and a button saying "Add" next to a group member that isn't in Muga reads as "add to the group".

## Decision

1. **A speaker is connected to Muga, and forgotten.** These are the words for joining and leaving the speaker list, everywhere: the welcome screen, the sidebar button ("Connect a speaker"), the form ("Connect"), buttons for speakers found on the network ("Connect", read as "Connect Bedroom" by screen readers), errors ("Couldn't connect to the speaker…") and "Forget this speaker". The code uses the same words: `RadioRegistry.connect` / `forget`, `ConnectForm`, the `connect.*` messages. iPhone Bluetooth settings use the same pair ("Connect", "Forget This Device"), and Muga already said "Connecting…" while it checks a new speaker.
2. **A speaker that isn't connected has a dashed outline**, in a group or under "On your network". Its note says "Not in your speakers", not "Not connected": that could be read as offline, which shows as "Not reachable".
3. **Words kept for other things**, so they don't mean two things:

   | Word | Means |
   | --- | --- |
   | Add / Remove | speakers in a group (`group.addClient` / `removeClient`) |
   | Save | storing a preset |
   | Pair | Bluetooth, and stereo pairs |
   | Set up | putting a new radio on Wi-Fi (onboarding) |
   | Join / Leave | a group |

## Consequences

- New features use "connect" only for the speaker list. Group, preset and Bluetooth flows use their own verbs from the table above.
- The status "Connecting…" now covers both connecting a speaker and reaching one that's already connected. Both mean Muga is trying to talk to it.
