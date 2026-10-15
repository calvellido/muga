# 0008: Multiroom groups

Date: 2026-10-15. Status: accepted; not yet checked on real radios.

## Context

A multiroom group is one speaker, the **server**, streaming to up to four **clients**. UNDOK runs every change as a SET on the server (doc 05 §6). Any speaker lists every multiroom speaker on the network in `multiroom.device.listAll`: name, address, multiroom UDN, group id and name, role, and client number.

## Decisions

1. **The network is read from one saved speaker.** A directory reads `listAll` from the selected speaker, or else from any saved speaker that is online. It checks `listAllVersion` every 10 s and reads the list again when the version changes, or after 60 s anyway. A radio answering FS_NODE_DOES_NOT_EXIST has no multiroom and isn't asked again. If the list leaves out the radio that was asked, Muga adds it from that radio's `group.*` nodes. Whether real radios list themselves is unverified.
2. **Saved speakers are matched to list entries by identity, then by address.** A multiroom UDN ends with the same part as the radio id and the UPnP UDN (`sys.info.dmruuid`), usually the MAC address. Muga compares those parts without case or separators, and falls back to the IP address. Speakers in the list that aren't connected to Muga can be connected in one tap, with the default PIN: discovery without SSDP. They have a dashed outline, in a group or under "On your network" (ADR 0009).
3. **Group changes follow UNDOK, waits included.**

   | Change | Requests |
   | --- | --- |
   | Create | on the server: `GET group.streamable` (must be TRUE), `SET group.create=<name>`, wait 500 ms, `GET group.id` |
   | Add a speaker | on the server: `SET group.addClient=<UDN>`, wait 1 s. A speaker in another group moves |
   | Remove a speaker | on the server: `SET group.removeClient=<UDN>` |
   | Ungroup | on the server: `SET group.destroy=DESTROY`, wait 500 ms |
   | The server leaves | on the first client: `SET group.state=SERVER`, wait 4 s, then `SET group.removeClient=<old server>` |
   | Rename | `group.name` is read-only, so ungroup, create again under the new name and add the speakers back |

   A change that would leave fewer than two speakers ungroups instead, as UNDOK does. After each change Muga waits 3 s, as UNDOK does, then reads the list again. During a change the periodic reads are skipped, so a half-done group never shows.
4. **Checks before a change, from reads only.**
   - The server's source must be shareable: the `streamable` field of `sys.caps.validModes`. If it isn't, the editor offers the sources that are.
   - The group can't grow past five speakers (`multiroom.client.*0..3`).
   - Speakers with a different multiroom version (`AudioSyncVersion`) can't join. Neither can a stereo secondary, or a speaker that leads another group.
   - A duplicate name gets a warning but is allowed, as UNDOK allows it.
5. **A group is shown through its server.** Selecting a group makes its server the selected radio, so the server is polled at the fast rate. The view shows what the server plays, its controls and its library.
   - **Volumes:** the main slider is the master volume (`group.masterVolume`). Each speaker gets its own row: the server's own volume, and `client.volumeN` / `muteN` for the clients. All are written on the server, in the server's volume steps, as UNDOK does. Mute mutes the server and every client in one SET_MULTIPLE.
   - **Polling:** the master and client volumes are read with each of the server's polls, only while the group is on screen. They go in a GET_MULTIPLE of their own, to keep URLs short (ADR 0007).
   - **Sources:** a source that can't be shared is marked, and choosing it asks first, because it ends the group.
   - **Through changes:** a rename gives the group a new id and the view follows it. After a hand-over, the view moves to the new server.
6. **A client's own page.** A notice says which group it plays with, with "Open group" and "Leave group". Transport and library are hidden there, because the group is controlled through its server and choosing a source on a client takes it out of the group.
7. **Left for later:**
   - stereo pairs (`multichannel.*`);
   - `multiroom.singlegroup.state`, whose meaning is unknown (doc 05 §10);
   - network optimisation (`device.transportOptimisation`), whose effect is unknown;
   - checking `X_audSyncProtocolID` in `dd.xml`, which UNDOK compares and a browser can't fetch without CORS.

## The simulator

`startSimulatedHome` (and `pnpm sim --speakers n`) starts several speakers on one multiroom network. A grouped client switches to a hidden "Audsync" source and mirrors what its server plays. Removing a client puts it back on its own source, stopped.

These parts are approximations:

- The master volume reads as the loudest member, and setting it scales every member in proportion.
- `listAll` reports simulated speakers as `127.0.0.1:<port>`, since they share one address.
- A network can leave each speaker out of its own list (`listsItself: false`), to test the fallback in decision 1.

## To check on real radios

Nothing here has run against the user's radios yet. Start with the read-only `pnpm muga groups <ip>`. Then, with permission and a record of the current groups, try each change and put it back:

- what `listAll` contains, and whether it includes the radio itself;
- whether the UDN's last part matches `sys.info.radioId` or `dmruuid`;
- what `AudioSyncVersion` and `ClientNumber` look like;
- how long the list takes to update after a change;
- how the master volume behaves;
- what a client's `sys.mode` and `play.*` show while it's grouped.
