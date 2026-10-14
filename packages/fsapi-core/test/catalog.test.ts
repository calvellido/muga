import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ListItem,
  lookupNode,
  NODE_PATHS,
  type NodeValue,
  type ScalarPath,
  type WritablePath,
} from "../src/catalog.ts";
import { NODE_DEFS } from "../src/generated/nodes.ts";

describe("generated catalog", () => {
  it("contains the 279 registered nodes plus 5 unregistered ones", () => {
    const defs = Object.values(NODE_DEFS);
    expect(defs).toHaveLength(284);
    expect(defs.filter((d) => d.registered)).toHaveLength(279);
  });

  it("matches facts verified with REA during the analysis", () => {
    expect(NODE_DEFS["netRemote.play.control"]).toMatchObject({
      type: "e8",
      readOnly: false,
      address: 0x10305000,
      enum: { STOP: 0, PLAY: 1, PAUSE: 2, NEXT: 3, PREVIOUS: 4 },
    });
    expect(NODE_DEFS["netRemote.sys.isu.state"]).toMatchObject({ readOnly: true, notifying: true });
    expect(NODE_DEFS["netRemote.nav.list"].fields.map((f) => f.name)).toEqual([
      "key",
      "name",
      "type",
      "subType",
      "graphicUri",
      "artist",
      "contextMenu",
    ]);
  });

  it("looks nodes up case-insensitively with an optional netRemote prefix", () => {
    expect(lookupNode("sys.audio.volume")?.path).toBe("netRemote.sys.audio.volume");
    expect(lookupNode("NETREMOTE.SYS.AUDIO.VOLUME")?.path).toBe("netRemote.sys.audio.volume");
    expect(lookupNode("netRemote.does.not.exist")).toBeUndefined();
    expect(NODE_PATHS).toContain("netRemote.multiroom.group.create");
  });
});

describe("catalog types", () => {
  it("derives value types from node definitions", () => {
    expectTypeOf<NodeValue<"netRemote.sys.audio.volume">>().toEqualTypeOf<number>();
    expectTypeOf<NodeValue<"netRemote.sys.info.friendlyName">>().toEqualTypeOf<string>();
    expectTypeOf<NodeValue<"netRemote.play.control">>().toEqualTypeOf<
      "STOP" | "PLAY" | "PAUSE" | "NEXT" | "PREVIOUS" | number
    >();
    expectTypeOf<ListItem<"netRemote.sys.caps.validModes">["label"]>().toEqualTypeOf<string>();
    expectTypeOf<ListItem<"netRemote.sys.caps.validModes">["key"]>().toEqualTypeOf<number>();
  });

  it("separates writable, read-only and list paths", () => {
    expectTypeOf<"netRemote.sys.audio.volume">().toExtend<WritablePath>();
    expectTypeOf<"netRemote.play.status">().not.toExtend<WritablePath>();
    expectTypeOf<"netRemote.nav.list">().not.toExtend<ScalarPath>();
  });
});
