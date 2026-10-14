import { describe, expect, it } from "vitest";
import { isFsapiError } from "../src/errors.ts";
import { parseDeviceDocument, parseMultipleResponse, parseResponse } from "../src/xml.ts";

describe("parseResponse", () => {
  it("parses a real GET reply (structure captured from a Ruark MRx; name changed)", () => {
    const xml =
      "<fsapiResponse>\n<status>FS_OK</status>\n<value><c8_array>Living Room</c8_array></value>\n</fsapiResponse>\n";
    const response = parseResponse(xml);
    expect(response.status).toBe("FS_OK");
    expect(response.value).toEqual({ tag: "c8_array", text: "Living Room" });
  });

  it("keeps numeric values as text and accepts empty strings and arrays", () => {
    expect(
      parseResponse(
        "<fsapiResponse><status>FS_OK</status><value><u8>0</u8></value></fsapiResponse>",
      ).value,
    ).toEqual({
      tag: "u8",
      text: "0",
    });
    expect(
      parseResponse(
        "<fsapiResponse><status>FS_OK</status><value><c8_array></c8_array></value></fsapiResponse>",
      ).value,
    ).toEqual({
      tag: "c8_array",
      text: "",
    });
    expect(
      parseResponse("<fsapiResponse><status>FS_OK</status><value><array/></value></fsapiResponse>")
        .value,
    ).toEqual({
      tag: "array",
      text: "",
    });
  });

  it("decodes XML entities in text", () => {
    const xml =
      "<fsapiResponse><status>FS_OK</status><value><c8_array>Rock &amp; Roll &lt;3</c8_array></value></fsapiResponse>";
    expect(parseResponse(xml).value?.text).toBe("Rock & Roll <3");
  });

  it("parses list items with lower-cased field names and listend", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fsapiResponse>
  <status>FS_OK</status>
  <item key="0">
    <field name="id"><c8_array>IR</c8_array></field>
    <field name="selectable"><u8>1</u8></field>
    <field name="modetype"><u8>0</u8></field>
  </item>
  <item key="1">
    <field name="id"><c8_array>Spotify</c8_array></field>
  </item>
  <listend/>
</fsapiResponse>`;
    const response = parseResponse(xml);
    expect(response.listEnd).toBe(true);
    expect(response.items).toHaveLength(2);
    expect(response.items[0]).toEqual({
      key: 0,
      fields: {
        id: { tag: "c8_array", text: "IR" },
        selectable: { tag: "u8", text: "1" },
        modetype: { tag: "u8", text: "0" },
      },
    });
    expect(response.items[1]?.key).toBe(1);
  });

  it("parses a single list item without listend", () => {
    const xml =
      '<fsapiResponse><status>FS_OK</status><item key="7"><field name="Name"><c8_array>X</c8_array></field></item></fsapiResponse>';
    const response = parseResponse(xml);
    expect(response.listEnd).toBe(false);
    expect(response.items).toEqual([{ key: 7, fields: { name: { tag: "c8_array", text: "X" } } }]);
  });

  it("parses notifications and session ids", () => {
    const notify = parseResponse(
      '<fsapiResponse><status>FS_OK</status><notify node="netRemote.sys.audio.volume"><value><u8>12</u8></value></notify><notify node="netRemote.play.status"><value><u8>2</u8></value></notify></fsapiResponse>',
    );
    expect(notify.notifications).toEqual([
      { node: "netRemote.sys.audio.volume", value: { tag: "u8", text: "12" } },
      { node: "netRemote.play.status", value: { tag: "u8", text: "2" } },
    ]);
    const session = parseResponse(
      "<fsapiResponse><status>FS_OK</status><sessionId>1958718413</sessionId></fsapiResponse>",
    );
    expect(session.sessionId).toBe("1958718413");
  });

  it("returns non-OK statuses without throwing", () => {
    expect(
      parseResponse("<fsapiResponse><status>FS_NODE_BLOCKED</status></fsapiResponse>").status,
    ).toBe("FS_NODE_BLOCKED");
  });

  it("throws a parse error for documents that aren't FSAPI replies", () => {
    expect(() => parseResponse("<html><body>nope</body></html>")).toThrowError(
      expect.objectContaining({ kind: "parse" }),
    );
    try {
      parseResponse("<fsapiResponse>");
    } catch (error) {
      expect(isFsapiError(error, "parse")).toBe(true);
    }
  });
});

describe("parseMultipleResponse", () => {
  it("reads one entry per node with its own status", () => {
    const xml = `<fsapiGetMultipleResponse>
<fsapiResponse><node>netRemote.sys.net.wlan.rssi</node><status>FS_OK</status><value><u8>0</u8></value></fsapiResponse>
<fsapiResponse><node>netRemote.sys.net.wlan.macAddress</node><status>FS_OK</status><value><c8_array>30:58:90:a4:12:34</c8_array></value></fsapiResponse>
<fsapiResponse><node>netRemote.sys.caps.fsdca</node><status>FS_NODE_DOES_NOT_EXIST</status></fsapiResponse>
</fsapiGetMultipleResponse>`;
    expect(parseMultipleResponse(xml)).toEqual([
      { node: "netRemote.sys.net.wlan.rssi", status: "FS_OK", value: { tag: "u8", text: "0" } },
      {
        node: "netRemote.sys.net.wlan.macAddress",
        status: "FS_OK",
        value: { tag: "c8_array", text: "30:58:90:a4:12:34" },
      },
      { node: "netRemote.sys.caps.fsdca", status: "FS_NODE_DOES_NOT_EXIST" },
    ]);
  });

  it("works with a single entry", () => {
    const xml =
      "<fsapiGetMultipleResponse><fsapiResponse><node>netRemote.sys.power</node><status>FS_OK</status><value><u8>1</u8></value></fsapiResponse></fsapiGetMultipleResponse>";
    expect(parseMultipleResponse(xml)).toHaveLength(1);
  });
});

describe("parseDeviceDocument", () => {
  it("reads the advertised FSAPI base URL", () => {
    const xml =
      "<netRemote><friendlyName>Living Room</friendlyName><version>V2.14.35</version><webfsapi>http://192.0.2.10:80/fsapi</webfsapi></netRemote>";
    expect(parseDeviceDocument(xml)).toEqual({
      friendlyName: "Living Room",
      version: "V2.14.35",
      webfsapi: "http://192.0.2.10:80/fsapi",
    });
  });
});
