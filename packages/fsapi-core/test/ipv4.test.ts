import { describe, expect, it } from "vitest";
import { ipv4FromU32, ipv4ToU32 } from "../src/ipv4.ts";

describe("IPv4 as the radio's u32", () => {
  it("puts the first octet in the high byte", () => {
    expect(ipv4ToU32("192.0.2.10")).toBe(3_221_225_994);
    expect(ipv4FromU32(3_221_225_994)).toBe("192.0.2.10");
    expect(ipv4FromU32(0)).toBe("0.0.0.0");
    expect(ipv4FromU32(4_294_967_295)).toBe("255.255.255.255");
  });

  it("rejects anything that isn't a dotted IPv4 address", () => {
    for (const text of ["", "192.0.2", "192.0.2.256", "192.0.2.1.5", "a.b.c.d", "192.0.2.-1"]) {
      expect(ipv4ToU32(text)).toBeUndefined();
    }
  });
});
