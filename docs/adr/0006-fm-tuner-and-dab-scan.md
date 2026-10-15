# 0006: FM tuner and DAB scan

Date: 2026-10-15. Status: accepted.

## Decisions

1. **FM tuning follows UNDOK (Analysis doc 05 §2.2).**
   - The band comes from `sys.caps.fmFreqRange.lower`, `upper` and `stepSize`. It's read once, the first time the radio is on FM; it doesn't change.
   - The frequency is `play.frequency` in kHz, shown as MHz with two decimals. The dial and the ± buttons clamp to the band and snap to the step grid before sending.
   - While the radio is on FM, every active poll also reads `play.frequency`, so seeks and changes made on the radio show up.
2. **The dial uses "latest value wins", like volume.** A shared `LatestWins` helper writes only the most recent value, with one SET in flight. Polls are ignored for a moment after tuning so the dial doesn't jump back. Volume now uses the same helper.
3. **Seek is next/previous.** On FM, `play.caps` SkipNext/SkipPrevious mean seek. The buttons are labelled "Seek up" and "Seek down", and send `play.control` NEXT / PREVIOUS.
4. **DAB scan follows UNDOK (doc 05 §3.11), with one difference.**
   1. Turn the menu off and on, wait while WAITING, then `SET nav.action.dabScan=SCAN`.
   2. Read `nav.action.dabScan` and `nav.dabScanUpdate` (stations found) every second until the scan is no longer SCAN. Muga waits up to 5 minutes, where UNDOK stops at 60 s.
   3. Then `SET nav.action.dabPrune=PRUNE`, as UNDOK does after every scan, and open the station list again from the top.

   The difference: **a scan that was cancelled, or interrupted by a source change or standby, isn't pruned.** Pruning then could drop stations the scan never reached.
5. **Scanning asks first and lives in the Browse tab on DAB.** The scan replaces the station list and the prune removes stations, so the app asks for confirmation. A scan already running when the tab opens, for example started from the radio's own menu, is followed and shown.

## Checked on a real radio

On 2026-10-15, on an ICD2018 (FS2026, V2.13.21c), with Muga's own tuner and scanner code:

- **FM band:** 87,500–108,000 kHz in 50 kHz steps. The band, `play.frequency` and the DAB scan nodes are readable in standby too.
- **Steps:** one step up and back worked (90.85 → 90.90 → 90.85 MHz). RDS names replace the "90.85MHz" name within a second or so ("SER").
- **`play.caps` on FM:** 0x80C (next, previous, add preset).
- **Seek up:** sweeps up the band (`play.frequency` changes visibly) and stopped on the next station about 7 s later (94.50 MHz, "RNE-CLAS").
- **DAB scan, at a location without DAB coverage:** ran about 11 s and found 0 stations. The prune finished within a second, and the station list stayed empty, so the menu reports FATAL_ERR.

## Consequences

- The tuner shows only on FM, and only once the band has been read.
- DAB scan progress depends on `nav.dabScanUpdate`. A scan that finds stations hasn't been tried on a real radio yet; the simulator models one.
- The simulator now:
  - tunes and seeks between FM stations from its profile;
  - runs a timed DAB scan (`dabScanStepMs`) that adds the stations it "finds";
  - prunes the rest.
