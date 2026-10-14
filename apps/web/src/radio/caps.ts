/** `play.caps` bits (Analysis doc 05 §2.1; bit = enum ordinal). */
export const PlayCap = {
  Pause: 1 << 0,
  Stop: 1 << 1,
  SkipNext: 1 << 2,
  SkipPrevious: 1 << 3,
  FastForward: 1 << 4,
  Rewind: 1 << 5,
  Shuffle: 1 << 6,
  Repeat: 1 << 7,
  Seek: 1 << 8,
  AddPreset: 1 << 11,
  RepeatOne: 1 << 16,
} as const;

/** `nav.caps` bits (doc 05 §1.2). */
export const NavCap = {
  Navigation: 1 << 0,
  Presets: 1 << 1,
  PresetsEdition: 1 << 2,
} as const;

/** `nav.preset.currentPreset` value meaning "no preset playing". */
export const NO_PRESET = 0xffff_ffff;

export function hasCap(caps: number | undefined, cap: number): boolean {
  return caps !== undefined && (caps & cap) !== 0;
}
