/**
 * The radio's `sys.net.ipConfig.*` nodes hold IPv4 addresses as one u32, first octet in the
 * high byte (`a<<24 | b<<16 | c<<8 | d`, doc 04 §3.5).
 */
export function ipv4FromU32(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");
}

/** A dotted IPv4 address as the radio's u32; undefined when it isn't one. */
export function ipv4ToU32(text: string): number | undefined {
  const parts = text.trim().split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    return undefined;
  }
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}
