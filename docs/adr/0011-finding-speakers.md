# 0011: Finding speakers on the network

Date: 2026-10-16. Status: accepted.

## Context

Radios usually get their address from the router (DHCP), and it can change. Connecting by IP address, and keeping a saved address, only suits radios with static addresses.

UNDOK finds radios with SSDP and mDNS. Both run over UDP, which web pages can't use, and a page can't learn the computer's own address either. All Muga can do is make HTTP requests. The multiroom lists already name other speakers, once one is connected (ADR 0008).

## Checked

On 2026-10-16, with the user's permission, on an ICD2018, an SMRS35A1 and an SMRS30A1. Requests were sent with `Origin: https://muga.calvellido.es`, and the Ruark was off the network.

| Request | Answer | Readable by the page |
| --- | --- | --- |
| `GET /device` (no PIN) | `200`: name, firmware, FSAPI address | Yes (`Access-Control-Allow-Origin: *`) |
| FSAPI with PIN `1234` | `200` | Yes |
| FSAPI with a wrong PIN | `403` | Yes |
| FSAPI without a PIN, `/fsapi`, `/` | `500` / `301` | No |
| `GET :8080/dd.xml` | `200` | No |

- **mDNS:** the radios advertise only `_spotify-connect._tcp`, not a service of UNDOK's own. Their mDNS host names are their names with spaces as hyphens (a radio named "Kitchen radio" answers at `Kitchen-radio.local`), and they resolved on a Linux desktop. FSAPI by that name answered as by address.
- **Empty addresses:** an address with nothing behind it failed after about 3 s.
- **SSDP:** the desktop received no replies from any device, which looks like its firewall; it doesn't matter for a web page.

## Decisions

1. **"Find speakers" scans the network, only when pressed.** It sends `GET /device` to every address of a range, 24 at a time, with a 1.5 s timeout. A radio's id then comes from FSAPI with PIN `1234`; a `403` means another PIN.
   - **Ranges:** those of the saved speakers. With none saved, the usual home ranges (`192.168.1`, `192.168.0`, `192.168.178`, and so on) in which a router answers at `.1` or `.254`, checked with `no-cors` requests, which resolve for any reply, readable or not.
   - **Results:** found speakers join "On your network", next to those the multiroom lists name, ready to connect.
2. **A saved speaker that stops answering is looked for by its radio id**, its MAC address, and its saved address is updated when found.
   - **Automatically:** at its address in the other speakers' multiroom lists, and at its `.local` name, all at once, the first match winning. This happens when it goes offline, and again whenever the lists show it at another address.
   - **On request:** "Look for it" in its "not reachable" notice also scans the network.
3. **Identity is checked.** If a different radio answers at a saved address (the router gave the address to another radio), the speaker counts as unreachable instead of showing the other radio. Identity is checked again whenever a speaker comes back after being offline.
4. **The saved address stays an IP address.** A `.local` name is only a way to find the radio again: names change when a radio is renamed, and not every platform resolves them. A speaker found only by its `.local` name is saved under that name.

## Consequences

- **What a scan costs:** a scan sends one request to every address of a range, and takes 10–30 s on a /24 when most addresses are empty. That's why it only runs when asked.
- **Unusual ranges:** speakers on a range Muga doesn't guess, with none saved yet, still need their address typed once. After that, their range is scanned.
- **iPhone:** gains nothing until it can reach the radios at all (ADR 0010).
- **The hub (later):** it could listen for SSDP and mDNS and replace the scan.
