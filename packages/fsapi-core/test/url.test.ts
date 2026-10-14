import { describe, expect, it } from "vitest";
import { redactPin } from "../src/errors.ts";
import { buildUrl, toBaseUrl } from "../src/url.ts";

describe("toBaseUrl", () => {
  it.each([
    ["192.0.2.10", "http://192.0.2.10/fsapi"],
    ["192.0.2.10:2244", "http://192.0.2.10:2244/fsapi"],
    ["http://192.0.2.10:80/fsapi", "http://192.0.2.10/fsapi"],
    ["http://radio.local/fsapi/", "http://radio.local/fsapi"],
    ["http://127.0.0.1:8099", "http://127.0.0.1:8099/fsapi"],
  ])("%s → %s", (input, expected) => {
    expect(toBaseUrl(input)).toBe(expected);
  });
});

describe("buildUrl", () => {
  const base = "http://192.0.2.10/fsapi";

  it("builds GET with the PIN first", () => {
    expect(buildUrl(base, "GET", { node: "netRemote.sys.audio.volume", pin: "1234" })).toBe(
      "http://192.0.2.10/fsapi/GET/netRemote.sys.audio.volume?pin=1234",
    );
  });

  it("form-encodes SET values (space as +), like UNDOK", () => {
    const url = buildUrl(base, "SET", {
      node: "netRemote.sys.info.friendlyName",
      pin: "1234",
      params: [["value", "Kitchen radio & co"]],
    });
    expect(url).toBe(
      "http://192.0.2.10/fsapi/SET/netRemote.sys.info.friendlyName?pin=1234&value=Kitchen+radio+%26+co",
    );
  });

  it("puts the LIST_GET_NEXT start key in the path", () => {
    const url = buildUrl(base, "LIST_GET_NEXT", {
      node: "netRemote.nav.list",
      startKey: -1,
      pin: "1234",
      params: [["maxItems", "14"]],
    });
    expect(url).toBe(
      "http://192.0.2.10/fsapi/LIST_GET_NEXT/netRemote.nav.list/-1?pin=1234&maxItems=14",
    );
  });

  it("repeats node parameters for GET_MULTIPLE and adds sid when given", () => {
    const url = buildUrl(base, "GET_MULTIPLE", {
      pin: "1234",
      sid: "42",
      params: [
        ["node", "netRemote.sys.power"],
        ["node", "netRemote.sys.mode"],
      ],
    });
    expect(url).toBe(
      "http://192.0.2.10/fsapi/GET_MULTIPLE?pin=1234&sid=42&node=netRemote.sys.power&node=netRemote.sys.mode",
    );
  });
});

describe("redactPin", () => {
  it("hides the PIN wherever it appears", () => {
    expect(redactPin("http://r/fsapi/GET/x?pin=9876&sid=1")).toBe(
      "http://r/fsapi/GET/x?pin=***&sid=1",
    );
    expect(redactPin("http://r/fsapi/GET/x?sid=1&pin=9876")).toBe(
      "http://r/fsapi/GET/x?sid=1&pin=***",
    );
  });
});
