# 0008: Multiroom groups

Date: 2026-10-15, revised 2026-10-16 after two passes on real radios. Status: accepted.

## Context

A multiroom group is one speaker, the **server**, streaming to up to four **clients**. UNDOK runs every change as a SET on the server (doc 05 §6). Each speaker lists multiroom speakers it knows of in `multiroom.device.listAll`: name, address, multiroom UDN, group id and name, role, and client number. Each speaker also reports its own group in `multiroom.group.*`.

## Decisions

1. **Speakers are found in every saved speaker's list, and groups are taken from each speaker's own nodes.**
   - On real radios a list leaves out the radio itself and doesn't always name every other speaker. So Muga merges the lists of all saved speakers that are online.
   - Lists lag behind group changes by up to a minute, while a radio's own `group.state`, `group.id`, `group.name` and `device.clientIndex` are right at once. So a saved speaker's group comes from its own nodes, in one GET_MULTIPLE (with its `listAllVersion`) every 10 s, and its list is read again when that version changes, or after 60 s anyway.
   - Speakers that aren't saved only appear in the lists, so their group is only as fresh as the lists.
   - A radio answering FS_NODE_DOES_NOT_EXIST has no multiroom and isn't asked again.
   - A speaker changing source or power makes Muga read the group states again at once: either can move the whole group (decision 4).
2. **Saved speakers are matched to list entries by identity, then by address.** A multiroom UDN ends with the same part as the radio id and the UPnP UDN (`sys.info.dmruuid`): the MAC address. Muga compares those parts without case or separators, and falls back to the IP address. Speakers in the lists that aren't connected to Muga can be connected in one tap, with the default PIN: discovery without SSDP. They have a dashed outline, in a group or under "On your network" (ADR 0009).
3. **Group changes follow UNDOK, waits included.**

   | Change | Requests |
   | --- | --- |
   | Create | on the server: `GET group.streamable` until TRUE (up to 3 s, as a radio just switched on can report FALSE), `SET group.create=<name>`, wait 500 ms, `GET group.id` |
   | Add a speaker | on the server: `SET group.addClient=<UDN>`, wait 1 s. A speaker in standby switches on. A speaker in another group moves |
   | Remove a speaker | on the server: `SET group.removeClient=<UDN>` |
   | Ungroup | on the server: `SET group.destroy=DESTROY`, wait 500 ms |
   | Rename | `group.name` is read-only, so ungroup, create again on the same server under the new name, and add the clients back |

   Removing every client ungroups. After each change Muga waits 1.5 s, then reads the speakers again. UNDOK waits 3 s for its lists; Muga reads the speakers' own nodes, which change at once. During a change the periodic reads are skipped, so a half-done group never shows.
4. **The group follows its speakers: a client choosing a source leads the group, and standby is for everyone.**
   - **Changing the leader:** UNDOK hands the server role over with `group.state=SERVER` on a client, then removes the old server. On these radios that doesn't work, and neither does the unused `group.becomeServer`: the client is a server for about a second, then a client again. What does work: a client that chooses a source becomes the server of the same group, playing that source, and the old server becomes a client. So a client's page shows its sources ("Play something else"), and choosing one says that the speaker will lead the group.
   - **The leader leaving:** in the editor the server is fixed, as when creating a group. It says how to have another speaker lead: choose a source on that speaker's page. On the server's own page "Leave group" is "Ungroup".
   - **Standby:** standby on any speaker in a group, server or client, puts the whole group in standby, and switching any of them on wakes the whole group, still grouped. The group view has a Standby button, and a grouped speaker's Standby asks first.
5. **Checks before a change, from reads only.**
   - The server's source must be shareable: the `streamable` field of `sys.caps.validModes`. If it isn't, the editor offers the sources that are. All sources of the radios tested report 1, FM and DAB included.
   - The group can't grow past five speakers (`multiroom.client.*0..3`).
   - Speakers with a different multiroom version (`AudioSyncVersion`) can't join. Neither can a stereo secondary, or a speaker that leads another group.
   - A duplicate name gets a warning but is allowed, as UNDOK allows it.
6. **A group is shown through its server.** Selecting a group makes its server the selected radio, so the server is polled at the fast rate. The view shows what the server plays, its controls and its library.
   - **Volumes:** the main slider is the master volume (`group.masterVolume`). Each speaker gets its own row: the server's own volume, and `client.volumeN` / `muteN` for the clients. All are written on the server, in the server's volume steps, as UNDOK does; the radios convert to each client's steps. Mute mutes the server and every client in one SET_MULTIPLE.
   - **Polling:** the master and client volumes are read with each of the server's polls, only while the group is on screen.
   - **Sources:** a source that can't be shared is marked, and choosing it asks first, because it ends the group.
   - **Through changes:** a rename gives the group a new id, and the view follows the group that has most of the same speakers.
7. **A client's own page.**
   - **Playback:** a client reports no source (`sys.mode` 0xFFFFFFFF) and no station name, so its page shows the server's playback; the server is polled at the fast rate while the page is open (`RadioController.watch`).
   - **Group notice:** a notice says which group it plays with, with "Open group" and "Leave group".
   - **Controls:** transport, menu and presets are hidden there, because the group is controlled through its server. Its sources are shown, to take the group over (decision 4).
8. **Left for later:**
   - stereo pairs (`multichannel.*`), which none of the four radios tested supports: every `multichannel.*` node answers FS_NODE_DOES_NOT_EXIST, and no `dd.xml` lists the "wsa" feature UNDOK requires;
   - `multiroom.singlegroup.state`, whose meaning is unknown (doc 05 §10);
   - network optimisation (`device.transportOptimisation`), whose effect is unknown;
   - checking `X_audSyncProtocolID` in `dd.xml`, which UNDOK compares and a browser can't fetch without CORS.

## Checked on real radios

On 2026-10-16, with the user's permission, in two passes:
- **Radios:** an ICD2018 (V2.13.21c), an SMRS30A1 (V2.11.11) and a Ruark MRx (V2.14.35), joined in the second pass by an SMRS35A1 (V2.11.11).
- **How:** the second pass ended with the web app itself, in headless Chrome, against all four, and every step worked: connecting the other three from "On your network", grouping all four, the mixer, a client's page, removing a client, renaming, a take-over, group standby and ungrouping.
- **Afterwards:** all were left as found (ungrouped, standby, same source and volume), except that the Ruark now starts on AUX in, the source it chose itself when a group ended.

- **Lists:** no radio lists itself.
  - The ICD2018 named the other three speakers; the SMRS30A1 named two, not the Ruark; the Ruark named only the ICD2018.
  - List entries for a group change appeared after 0.1 s on the server for one client, and after more than 20 s for another. Stale entries lasted about a minute after ungrouping.
  - The ICD2018's list has no `SystemId` / `SystemRole` / `SystemName`. `AudioSyncVersion` is "4", like `caps.protocolVersion`, on all three. `ClientNumber` is 255 for speakers that aren't clients.
- **Identity:** the end of every multiroom UDN equals the radio id and the end of the UPnP UDN.
- **What worked:**
  - creating a group led by the ICD2018 on FM (FM can be shared);
  - adding the SMRS30A1 and the Ruark from standby (both switched on);
  - removing a client, renaming, client volume, group mute, and ungrouping.
- **Clients:** a client reports `sys.mode` 0xFFFFFFFF and an empty `play.info.name`, and its `play.status` follows the server's. A removed client is idle with no source. On ungrouping, the Ruark went to AUX in instead.
- **Volumes:** the master volume reads as the average of the members. Setting it moves every member by the same number of steps (+3 and back again left all four exactly as they were). Client volumes are in the server's scale both ways: the SMRS30A1's 3 of 19 reads as 5 of 31 on the ICD2018, and writing 10 there set it to 6 within a second.
- **Hand-over:** `group.state` / `becomeServer` didn't work (decision 4). One attempt left the Ruark unreachable for about 40 s, and leftover one-speaker groups had to be ungrouped.
- **Take-over:** the SMRS35A1 choosing AUX in, then internet radio, made it the server of the same group. The old server, the ICD2018, became the last client, and the client numbers closed up.
- **Source and power:**
  - the server changing source (FM to internet radio and back) kept the group together;
  - standby on a client (the Ruark) or on the server took all four with it, and switching either back on woke all four, still grouped.
- **Moving between groups:** adding a client of one group to another group moved it, and the first group's server was left with no clients.
- **A server with no source:** the ICD2018, with no source after being a client, accepted a client. Once, an SMRS30A1 in that state refused the Ruark, right after the Ruark's group had ended and while it was still switching to AUX in. That was probably timing, not a rule.
- **Request length:** GET_MULTIPLE URLs past about 405 characters get HTTP 400 on all three. `FsapiClient` now splits long GET_/SET_MULTIPLE requests (ADR 0003).
- **Standby:** the Ruark reports `group.streamable` FALSE in standby, with no source.

## The simulator

`startSimulatedHome` (and `pnpm sim --speakers n`) starts several speakers on one multiroom network. It follows the behaviour above: lists without the speaker itself, clients with no source or name, hand-over accepted but ignored, take-over by choosing a source, group-wide standby, and the master volume as the average that moves every member alike.

These parts are approximations or options:

- Volumes aren't converted between scales: every simulated speaker has the same steps.
- `listAll` reports simulated speakers as `127.0.0.1:<port>`, since they share one address.
- `listDelayMs` delays list updates, and `sees` hides speakers from each other's lists, as the real radios did.
