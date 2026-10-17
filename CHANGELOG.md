# Changelog

## 1.1.1 (2026-10-17)

- **Docs:** why a CD shows no track details, and changes to the radios' firmware that would help Muga (HTTPS for every browser, and CD details).

## 1.1.0 (2026-10-17)

- **Check for updates**, in each speaker's settings ("About this speaker"): shows what the radio found the last time it checked for software updates by itself, such as no update, an update available or a failed check. Muga doesn't ask the radio to check or to update.

## 1.0.2 (2026-10-17)

- **Settings:** the clock card's time source and time zone lists no longer stick out of the card on wide screens. Some radios, such as the ICD2018, have long time zone names.

## 1.0.1 (2026-10-17)

- Every change to Muga now comes with its own version and release, so the version shown in Muga settings tells exactly what you have.

## 1.0.0 (2026-10-16)

The first release. Muga controls the Frontier Silicon internet radios that the UNDOK app controls (Roberts, Ruark, Silvercrest, Eliteline, Hama, Medion and many more) from a browser, with no account, no cloud and no server of its own.

### Listening

- **Now playing**, with artwork. Play, pause, stop, next, previous, shuffle and repeat, as each radio supports them.
- **Volume, mute and standby.**
- **Sources:** internet radio, Spotify, DAB, FM, Bluetooth, AUX and whatever else your radio has. When a source sends no track details, such as a CD, its name is shown instead.
- **Menus:** browse each source's menu, search it, and play from it.
- **Presets:** recall them, save what's playing, delete and reorder.
- **FM tuner** with a dial, one-step buttons and seek. **DAB scan**, with progress.

### Speakers and groups

- **Find speakers** on your network, without typing an address. When the router gives a speaker a new address, Muga finds it again.
- **Multiroom groups:**
  - group speakers so they play the same thing in sync;
  - adjust a group volume, and each speaker's volume;
  - add and remove speakers, rename, put the whole group in standby, or ungroup.

### Settings

- **Each speaker's settings:**
  - name and sleep timer;
  - equalizer and loudness;
  - the radio's own menu language, its clock and time zone;
  - streaming quality;
  - device information.
- **Muga settings:** Muga's language (English or Spanish) and theme (light or dark), or both following your browser and device. The settings show Muga's version.

### The app

- **Install it** from [muga.calvellido.es](https://muga.calvellido.es/) in Chrome or Edge, on a computer or an Android phone. After that it works without the website, which it only checks for updates.
- **The window title shows what's playing**, such as "▶ So What - Miles Davis | Muga".
- **Phone and desktop**, light and dark, in English and Spanish.

### Known limits

- **Safari, every browser on iPhone and iPad, and Firefox** can't reach the radios from the website yet. In those, serve Muga at home over plain HTTP. Firefox can also be made to work by changing a setting; the README explains how, and the trade-off.
- **Not supported yet:** stereo pairs and Bluetooth settings (none of the tested radios has them), firmware updates and factory reset.
- **Tested on** an Eliteline ICD2018, a Ruark MRx and two Silvercrest radios (README, "Tested radios").
