# 0007: Speaker settings and device info

Date: 2026-10-15. Status: accepted.

## Decisions

1. **One settings view per speaker.** A button in the speaker header swaps the player for a settings view, with "Back to the player". Focus moves to the view's title, and back to the button when it closes. Each setting is a card that appears only when the radio supports it.
2. **Capabilities from reads only.** UNDOK probes some settings by writing:
   - `sys.factoryReset = NONE` for factory reset;
   - `sys.audio.quality = 100`, an invalid value, to pick the quality node (doc 06 §3.1, §3.3).

   Muga only reads. A setting is shown when its node or caps list answers:

   | Card | Shown when |
   | --- | --- |
   | Sleep timer | `sys.sleep` |
   | Equalizer | a non-empty `sys.caps.eqPresets` |
   | Loudness | `sys.audio.eqLoudness` |
   | Clock | `sys.caps.clockSourceList` |
   | Radio language | `sys.caps.validLang`, unless it only offers "Testlang" |
   | Streaming quality | `sys.audio.airableQuality`, else `sys.audio.quality`, and only on radios with streaming sources |

   Settings are read in three small GET_MULTIPLE groups, because embedded web servers may limit the URL length.
3. **What each setting writes, following UNDOK (doc 06 §3).**
   - **Name:** `sys.info.friendlyName`, at most 32 bytes.
   - **Sleep timer:** `sys.sleep` in seconds, with UNDOK's choices of 15–120 minutes; 0 cancels. The radio counts down; Muga re-reads it every 30 s and counts locally in between.
   - **Equalizer:** `sys.audio.eqPreset`; preset key 0 is the custom one. Its bands come from `sys.caps.eqBands` and are written to `sys.audio.eqCustom.param0..4`, latest value wins.
   - **Radio language:** `sys.lang`. Source names are localised, so identity and sources are read again afterwards.
   - **Clock:** format, source and DST are each one SET. A network time zone writes `utcOffset`, then the region label, but only where `sys.clock.timeZone` exists. Manual time writes `localDate`/`localTime` from this device's clock, to the minute. After each change Muga waits briefly, then re-reads the radio's time.
4. **Device info shows the network name properly.** UNDOK shows "ERROR (Wi-Fi)". Muga decodes `sys.net.wlan.connectedSSID` as the byte array it is. The MAC address shown is the wired one when Ethernet is enabled. The address shown is the one Muga uses to reach the radio.
5. **Time zones as the radio lists them.** Zones without a label show their offset ("UTC−11:30"). Labelled ones get the offset in front ("UTC+02:00 · Atenas, Cairo"). The current zone is found by label when the radio stores one, else by offset.
6. **Left for later:** factory reset (Phase 5, behind strong confirmation), external audio delay (its units are unknown), and "keep network connected" (a hidden dialog in UNDOK).

## Checked on real radios

On 2026-10-15, with Muga's own settings code:

- **ICD2018 (FS2026, V2.13.21c).** Every change below was made and then put back:
  - **Settings it reports:** sleep timer, 9 EQ presets with custom Bass/Treble (−7…+7), no loudness, 13 menu languages, clock (24 h, network time, DST) with 54 time zones (half-hour steps, many unlabelled). It has no streaming quality.
  - **Missing nodes:** `sys.info.modelName`, `sys.info.serialNumber`, `sys.audio.eqLoudness`, `sys.audio.airableQuality`, `sys.audio.quality` and `sys.clock.timeZone` don't exist.
  - **What worked:** rename; sleep timer (900 s counting down); EQ preset and custom band; language, where source names changed with it; clock format; DST, which moves the clock at once; time zone by offset.
  - **Delay:** `utcOffset` takes effect shortly after FS_OK, so a GET straight after can still return the old value.
- **Ruark MRx (FS2026, V2.14.35), read only.** One EQ preset ("My EQ") with Bass, Treble and "AUX in" (−4…+4), loudness, and streaming quality on `sys.audio.airableQuality`. It has no clock or language settings.
- **Both:** the Wi-Fi name decodes correctly. Signal reads 24 and 92 (`sys.net.wlan.rssi`; its scale isn't documented, and Muga shows it against 100).

## Consequences

- A radio missing a node simply doesn't show that card; nothing is written to find out.
- Settings changed elsewhere (on the radio or in UNDOK) show up the next time the view opens.
- The simulator now has EQ presets and bands, languages, clock sources and zones, and network details. Its sleep timer counts down to standby.
