import { describe, expect, it } from "vitest";
import { requireNode } from "../src/catalog.ts";
import {
  decodeByteArray,
  decodeListItem,
  decodeScalar,
  encodeByteArray,
  encodeScalar,
} from "../src/codec.ts";

const def = (path: string) => requireNode(path).def;

describe("decodeScalar", () => {
  it("decodes integers, enums by name, and unknown enum values as numbers", () => {
    expect(decodeScalar(def("netRemote.sys.audio.volume"), { tag: "u8", text: "12" })).toBe(12);
    expect(decodeScalar(def("netRemote.play.status"), { tag: "u8", text: "2" })).toBe("PLAYING");
    expect(decodeScalar(def("netRemote.play.status"), { tag: "u8", text: "42" })).toBe(42);
  });

  it("decodes strings and hex byte arrays (SSID)", () => {
    expect(
      decodeScalar(def("netRemote.sys.info.friendlyName"), {
        tag: "c8_array",
        text: "Kitchen",
      }),
    ).toBe("Kitchen");
    expect(
      decodeScalar(def("netRemote.sys.net.wlan.connectedSSID"), {
        tag: "array",
        text: "4D7567614E6574000000",
      }),
    ).toBe("MugaNet");
  });

  it("rejects non-integer text for integer nodes", () => {
    expect(() =>
      decodeScalar(def("netRemote.sys.audio.volume"), { tag: "u8", text: "loud" }),
    ).toThrowError(expect.objectContaining({ kind: "parse" }));
  });
});

describe("encodeScalar", () => {
  it("encodes enum names (case-insensitive) and numbers", () => {
    expect(encodeScalar(def("netRemote.play.control"), "PAUSE")).toBe("2");
    expect(encodeScalar(def("netRemote.play.control"), "next")).toBe("3");
    expect(encodeScalar(def("netRemote.sys.power"), 1)).toBe("1");
  });

  it("refuses read-only nodes, unknown enum names and out-of-range values", () => {
    const validation = expect.objectContaining({ kind: "validation" });
    expect(() => encodeScalar(def("netRemote.play.status"), "PLAYING")).toThrowError(validation);
    expect(() => encodeScalar(def("netRemote.play.control"), "REWIND")).toThrowError(validation);
    expect(() => encodeScalar(def("netRemote.sys.audio.volume"), 256)).toThrowError(validation);
    expect(() => encodeScalar(def("netRemote.sys.audio.volume"), 1.5)).toThrowError(validation);
    expect(() => encodeScalar(def("netRemote.sys.audio.volume"), "10")).toThrowError(validation);
  });

  it("enforces string byte limits (one byte reserved for the terminator)", () => {
    const friendlyName = def("netRemote.sys.info.friendlyName"); // buffer of 33
    expect(encodeScalar(friendlyName, "x".repeat(32))).toBe("x".repeat(32));
    expect(() => encodeScalar(friendlyName, "x".repeat(33))).toThrowError(
      expect.objectContaining({ kind: "validation" }),
    );
    expect(() => encodeScalar(friendlyName, "ñ".repeat(17))).toThrowError(); // 34 bytes
  });
});

describe("byte arrays", () => {
  it("round-trips UTF-8 text", () => {
    expect(encodeByteArray("Café")).toBe("436166C3A9");
    expect(decodeByteArray("436166C3A9")).toBe("Café");
  });

  it("returns non-hex text unchanged", () => {
    expect(decodeByteArray("not hex")).toBe("not hex");
  });
});

describe("decodeListItem", () => {
  it("maps lower-case wire names to catalog names and keeps unknown fields", () => {
    const item = decodeListItem(def("netRemote.sys.caps.validModes"), {
      key: 3,
      fields: {
        id: { tag: "c8_array", text: "DAB" },
        selectable: { tag: "u8", text: "1" },
        label: { tag: "c8_array", text: "DAB" },
        streamable: { tag: "u8", text: "0" },
        modetype: { tag: "u8", text: "0" },
        newfield: { tag: "c8_array", text: "future" },
      },
    });
    expect(item).toEqual({
      key: 3,
      id: "DAB",
      selectable: 1,
      label: "DAB",
      streamable: 0,
      modeType: 0,
      newfield: "future",
    });
  });

  it("decodes byte-array fields (a scanned SSID) from hex, or as text when sent as text", () => {
    const scanned = (ssid: { tag: string; text: string }) =>
      decodeListItem(def("netRemote.sys.net.wlan.scanList"), {
        key: 2,
        fields: {
          ssid,
          privacy: { tag: "u8", text: "1" },
          wpscapability: { tag: "u8", text: "0" },
          rssi: { tag: "u8", text: "54" },
        },
      });
    expect(scanned({ tag: "array", text: "4D7567614E6574000000" })).toMatchObject({
      ssid: "MugaNet",
      privacy: 1,
      rssi: 54,
    });
    expect(scanned({ tag: "c8_array", text: "CAFE" }).ssid).toBe("CAFE");
  });
});
