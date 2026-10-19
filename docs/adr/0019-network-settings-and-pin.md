# 0019: Network settings and the speaker PIN

Date: 2026-10-19. Status: accepted.

## Context

- **The radios have a small web page of their own,** at `http://<radio>/web/index.html`, built into their firmware by Frontier.
  - Its Status and Network tabs show and change how the radio is connected, and on some models a System tab changes its PIN.
  - It drives the same FSAPI that Muga uses, from the browser, so it shows which nodes the radio expects, and in which order.
- **UNDOK touches these settings only during setup,** and keeps "Keep network connected" in a hidden dialog. Muga 1 showed the network name, the Wi-Fi signal and the MAC address.
- **The firmware of all four tested radios** has every node used here.

## Decisions

1. **A Network card in speaker settings** shows the connection, the Wi-Fi signal, the address and whether it's automatic (DHCP), the subnet mask, the gateway, the DNS servers and the MAC address. These were in "About this speaker" before. The `sys.net.ipConfig.*` nodes hold each address as a u32, first octet in the high byte.
2. **Stay connected in standby:** `sys.net.keepConnected`, applied at once. Turning it off asks first, because in standby the speaker then leaves the network, and only its own buttons or remote can wake it.
3. **Changing the network follows the radio's own page:**
   - **Look for networks:**
     - `sys.net.wlan.scan` is set to SCAN, and read until IDLE (up to 30 s), then `scanList` is read.
     - The list keeps the strongest access point of each name and leaves out hidden networks.
     - Wi-Fi is switched on for the scan if it's off, and off again after.
     - A radio with no Wi-Fi region gets one first, as in UNDOK's setup: USA if `regionFcc` is active, else Europe.
   - **Joining a network:**
     - The password is encrypted with the radio's own RSA key. Muga waits for `sys.rsa.status`, reads `sys.rsa.publicKey` (`<exponent>:<modulus>` in hex), applies PKCS#1 v1.5 and sends the result in hex to `setPassphrase`.
     - Then comes `selectAP` for a network from the list. A network typed by hand gets `setEncType`, `setAuthType` and `setSSID` instead: None is open with no encryption, WEP is open with WEP, and WPA and WPA2 use AES.
   - **Addressing:** `ipConfig.dhcp`, and for a fixed address, the address, mask, gateway and two DNS servers.
   - **Then `sys.net.commitChanges`.** No reply to it counts as done, as in UNDOK: the radio may already be reconnecting.
   - **A confirmation names the risk:** the speaker reconnects, may come back at another address, and with a wrong setting drops off the network until it's fixed from its own menu.
   - **Finding it again:** after a fixed address, Muga waits up to two minutes for the speaker there and moves it (`RadioRegistry.expectAt`). Otherwise the usual search finds it (ADR 0011).
4. **Ethernet only one way:** a speaker on Ethernet can move to Wi-Fi, but a speaker on Wi-Fi isn't offered Ethernet.
   - Radios don't say whether they have a port; their own page has that built in for each model.
   - Choosing Ethernet on a radio without a port would switch its Wi-Fi off.
5. **The Wi-Fi region isn't offered:** the radio keeps its own.
6. **Speaker PIN:**
   - **The PIN:** `sys.info.radioPin`, four digits, as the radio's own page requires.
   - **After the change:** Muga's client uses the new PIN at once, including for requests already waiting to go out, and Muga saves it for that speaker.
   - **A warning** says that UNDOK, and Muga in other browsers, will ask for the new PIN.
7. **A link to the speaker's own page** in "About this speaker". It's plain HTTP on the radio, so it opens in a new tab, as visiting the radio's address does. Requests through the proxy (ADR 0017) don't include it.
8. **Byte-array list fields:** a list field of type `u8` longer than one byte, such as the SSID in `scanList`, is decoded as bytes: from hex when it arrives as `<array>`, as text when it arrives as `<c8_array>`.

## Consequences

- **The simulator models all of it:**
  - it scans;
  - it makes an RSA key and decrypts the password with it;
  - it records each commit;
  - it changes its PIN;
  - it serves a placeholder for the speaker's own page.
- **Changes tested against the simulator only.** On real radios, none of the changes has been tried yet, on purpose: a wrong network setting strands the radio. The first real change should be made with the speaker within reach.
- **Checked on an ICD2018 (V2.13.21c), reads only (2026-10-19):** nothing was written, and the radio was left as found.
  - **Network card:** right in every row. The u32 addresses decode first octet first, and the radio's fixed address shows as Manual. "Stay connected in standby" is on.
  - **The editor:** opens with the radio's own values, offers no Ethernet switch on Wi-Fi, and keeps Apply disabled until something changes.
  - **No PIN card:** `sys.info.radioPin` answers FS_NODE_DOES_NOT_EXIST, although the node is in the firmware, and its own web page has no PIN option either. The card stays hidden there.
  - **The RSA key:** `sys.rsa.status` is ready, and `sys.rsa.publicKey` reads `010001:` and a 1024-bit modulus, which Muga parses.
  - **No scan results yet:** `sys.net.wlan.scanList` answers FS_FAIL before a scan, and Muga then lists no networks. So how a real radio sends the SSID field (`<array>` or `<c8_array>`) is still unseen. Muga handles both.
- **Still to try on a real radio:** a scan, and one change, such as a fixed address, with the speaker at hand.
