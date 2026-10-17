# 0016: CD playback

Date: 2026-10-17. Status: accepted.

## Context

The Eliteline ICD2018 has a CD player. Playing a CD, Muga showed "Playing" over "Nothing playing", and nothing about the disc. The question was whether Muga could identify the disc with MusicBrainz and show its artist, album, tracks and cover.

MusicBrainz identifies a CD by its table of contents: the number of tracks and where each one starts on the disc. Its web service and the Cover Art Archive both allow requests from a web page, so the lookup itself would work from Muga. A rougher search needs at least the track count and lengths, and following along needs the current track.

## Checked

On 2026-10-17, with a CD playing on an ICD2018 (firmware V2.13.21c), with the user's permission. The radio was put back on the source it was on afterwards.

- **FSAPI:**
  - `play.status` is PLAYING, and `play.caps` allows pause, next, previous, shuffle and repeat. Next is accepted.
  - `play.info.name`, `text`, `artist`, `album` and `graphicUri` are empty, before and after a Next. Either the disc has no CD-Text, or the radio doesn't pass it on.
  - `play.position` and `play.info.duration` stay at 0 throughout.
  - `nav.caps` is 0. With `nav.state` on, `nav.status` is FATAL_ERR and `nav.list` answers FS_NODE_BLOCKED, so there's no track list.
- **UNDOK:** its node catalog has nothing for a disc, a table of contents or a track number. It uses the CD mode only to choose an icon.
- **UPnP:** the radio is a MediaRenderer on port 8080 (AVTransport, ConnectionManager, RenderingControl). While the CD plays, AVTransport reports:
  - `GetTransportInfo`: NO_MEDIA_PRESENT;
  - `GetPositionInfo`: track 0, duration and time 00:00:00;
  - `GetMediaInfo`: 0 tracks, play medium NETWORK.

  It describes only music pushed to the radio over the network. A web page couldn't use it anyway: the radio answers the CORS preflight with HTTP 400, and its replies carry no CORS headers.

## Decisions

1. **A source that reports no track details shows its name**, so a CD reads "Playing / CD", and the page title "▶ CD | Muga".
2. **No disc identification.** The radio exposes nothing to identify the disc with, or to tell which track is playing.
   - **Tagging the disc by hand** (searching MusicBrainz by artist or album) was considered and not done. It could show the album, but not the track, and Muga couldn't notice a disc change.
   - **Recognition through the microphone** was rejected. The services that recognise music from a microphone are paid, need an API key that a public web app can't keep secret, and receive audio from the user's home. AcoustID, the free one, needs clean audio, not a microphone recording.
3. **Revisit if a radio exposes CD details**, through FSAPI or its MediaRenderer. [Radio firmware wishes](../radio-firmware-wishes.md) lists what would be needed.

## Consequences

- **On a CD**, Muga controls playback (play, pause, next, previous, shuffle, repeat) but shows no track, time or artwork.
- **The hub (later)** wouldn't change this: the details aren't exposed anywhere it could read them either.
