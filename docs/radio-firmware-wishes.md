# Radio firmware wishes

Muga works within what the radios' firmware offers. These changes to that firmware would remove its biggest limits. They're ideas for Frontier Smart, for radio makers, or for anyone able to change the firmware by other means. Each says what's missing, what was observed, and what would be enough.

## FSAPI over HTTPS

**What's missing.** The radios answer FSAPI (port 80) and their media renderer (port 8080) over plain HTTP only. Browsers block plain-HTTP requests from secure (https) pages as mixed content. So Muga, published at `https://muga.calvellido.es/`:

- works in Chrome and Edge only, after the user allows local network access ([ADR 0010](adr/0010-hosting-with-local-network-access.md));
- doesn't work at all in Safari (every browser on iPhone and iPad) or in Firefox, unless it's served at home over plain HTTP or a security setting is lowered ([ADR 0012](adr/0012-browsers-without-local-network-access.md)).

**What would be enough.** FSAPI over HTTPS, with a certificate that browsers trust.

- **The certificate:** a self-signed one doesn't help, since browsers refuse it for requests from a page, and phones give no way to accept it. One way is a per-radio name under a domain the vendor controls (for example `<radio id>.radios.example`) that resolves to the radio's local address. It needs a publicly trusted certificate for that name, renewed by the radio. Media servers such as Plex do this for their local connections.
- **Keep the CORS header:** FSAPI already answers `Access-Control-Allow-Origin: *`. That's what makes a web app without a server possible, and it should stay.
- **Trade-offs:**
  - some routers block public names that resolve to local addresses (DNS rebinding protection), so the plain-HTTP address should keep working too;
  - the radio needs the internet to renew its certificate;
  - the PIN keeps travelling in the URL, so it's encrypted, but still a weak secret.

## CD details

**What's missing.** Playing a CD, the ICD2018 reports no track, time, artist or menu through FSAPI, and its media renderer reports no media at all ([ADR 0016](adr/0016-cd-playback.md)). Muga can control the CD, but can only say "CD".

**What would be enough**, through either interface:

- **FSAPI:**
  - CD-Text, when the disc has it, in `play.info.name` (track title), `artist` and `album`;
  - the current track and the number of tracks, for example in `play.info.text` ("Track 3 of 12");
  - `play.position` and `play.info.duration` for the current track, as for other sources;
  - the disc's table of contents (each track's start and the lead-out, in frames), so an app can compute the MusicBrainz disc ID and look up the release, its tracks and its cover;
  - a list of the disc's tracks in the CD source's menu (`nav.list`), to play one directly.
- **The media renderer (UPnP AVTransport), while the CD plays:**
  - `GetMediaInfo` with the number of tracks;
  - `GetPositionInfo` with the current track, its duration and the elapsed time;
  - CD-Text as DIDL-Lite metadata in `TrackMetaData`.
