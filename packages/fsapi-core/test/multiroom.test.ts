import { describe, expect, it } from "vitest";
import { FsapiClient } from "../src/client.ts";
import {
  addToGroup,
  createGroup,
  destroyGroup,
  handOverGroup,
  isMultiroomFailure,
  multiroomUdn,
  readMultiroomDevices,
  removeFromGroup,
  udnSuffix,
} from "../src/multiroom.ts";
import type { FetchLike } from "../src/types.ts";

const reply = (status: string, inner = "") =>
  `<fsapiResponse><status>${status}</status>${inner}</fsapiResponse>`;
const value = (inner: string) => reply("FS_OK", `<value>${inner}</value>`);

/** Records requests; GETs answer from `values` (raw `<value>` contents), everything else FS_OK. */
function radio(values: Record<string, string> = {}, lists: Record<string, string> = {}) {
  const calls: string[] = [];
  const fetch: FetchLike = async (raw) => {
    const url = new URL(raw);
    const [, , verb, node = ""] = url.pathname.split("/");
    const name = node.replace("netRemote.", "");
    calls.push(`${verb} ${name}${verb === "SET" ? `=${url.searchParams.get("value")}` : ""}`);
    const body =
      verb === "GET"
        ? values[name] !== undefined
          ? value(values[name])
          : reply("FS_NODE_DOES_NOT_EXIST")
        : verb === "LIST_GET_NEXT"
          ? reply("FS_OK", `${lists[name] ?? ""}<listend/>`)
          : reply("FS_OK");
    return { status: 200, text: async () => body };
  };
  return { client: new FsapiClient({ host: "192.0.2.10", fetch }), calls };
}

const NO_WAITS = { waits: { create: 0, add: 0, handOver: 0, destroy: 0 } };

const field = (name: string, inner: string) => `<field name="${name}">${inner}</field>`;
const device = (key: number, fields: Record<string, string>) =>
  `<item key="${key}">${Object.entries(fields)
    .map(([name, inner]) => field(name, inner))
    .join("")}</item>`;

describe("multiroom", () => {
  it("derives multiroom UDNs as UNDOK does", () => {
    expect(udnSuffix("uuid:3dcc7100-f76c-11dd-87af-002261aabbcc")).toBe("002261AABBCC");
    expect(multiroomUdn("uuid:3dcc7100-f76c-11dd-87af-002261aabbcc")).toBe(
      "46C19E4A-472B-11E1-9F67-002261AABBCC",
    );
    expect(multiroomUdn("")).toBe("");
  });

  it("reads the speakers a radio knows of", async () => {
    const common = {
      ipaddress: "<c8_array>192.0.2.11</c8_array>",
      audiosyncversion: "<c8_array>3</c8_array>",
      systemid: "<c8_array></c8_array>",
      systemrole: "<u8>0</u8>",
      systemname: "<c8_array></c8_array>",
    };
    const { client, calls } = radio(
      {},
      {
        "multiroom.device.listAll": [
          device(0, {
            ...common,
            udn: "<c8_array>46C19E4A-472B-11E1-9F67-002261000001</c8_array>",
            friendlyname: "<c8_array>Living room </c8_array>",
            groupid: "<c8_array>g-1</c8_array>",
            groupname: "<c8_array>Downstairs</c8_array>",
            grouprole: "<u8>2</u8>",
            clientnumber: "<u8>255</u8>",
          }),
          device(1, {
            ...common,
            udn: "<c8_array>46C19E4A-472B-11E1-9F67-002261000002</c8_array>",
            friendlyname: "<c8_array>Kitchen</c8_array>",
            groupid: "<c8_array>g-1</c8_array>",
            groupname: "<c8_array>Downstairs</c8_array>",
            grouprole: "<u8>1</u8>",
            clientnumber: "<u8>0</u8>",
          }),
        ].join(""),
      },
    );
    const devices = await readMultiroomDevices(client);
    expect(calls).toEqual(["LIST_GET_NEXT multiroom.device.listAll"]);
    expect(devices).toEqual([
      expect.objectContaining({
        name: "Living room",
        role: "SERVER",
        clientNumber: undefined,
        groupName: "Downstairs",
      }),
      expect.objectContaining({
        name: "Kitchen",
        ip: "192.0.2.11",
        syncVersion: "3",
        role: "CLIENT",
        clientNumber: 0,
        stereo: { id: "", role: "INDEPENDENT", name: "" },
      }),
    ]);
  });

  it("copes with speakers listed without some fields", async () => {
    const { client } = radio(
      {},
      {
        "multiroom.device.listAll": device(0, {
          udn: "<c8_array>46C19E4A-472B-11E1-9F67-002261000003</c8_array>",
          friendlyname: "<c8_array>Study</c8_array>",
          grouprole: "<u8>1</u8>",
        }),
      },
    );
    expect(await readMultiroomDevices(client)).toEqual([
      {
        udn: "46C19E4A-472B-11E1-9F67-002261000003",
        name: "Study",
        ip: "",
        syncVersion: "",
        groupId: "",
        groupName: "",
        role: "CLIENT",
        clientNumber: undefined,
        stereo: { id: "", role: "INDEPENDENT", name: "" },
      },
    ]);
  });

  it("creates a group once the source can be shared", async () => {
    const { client, calls } = radio({
      "multiroom.group.streamable": "<u8>1</u8>",
      "multiroom.group.id": "<c8_array>g-1</c8_array>",
    });
    await expect(createGroup(client, "Group 1", NO_WAITS)).resolves.toBe("g-1");
    expect(calls).toEqual([
      "GET multiroom.group.streamable",
      "SET multiroom.group.create=Group 1",
      "GET multiroom.group.id",
    ]);
  });

  it("refuses to create a group from a source that can't be shared", async () => {
    const { client, calls } = radio({ "multiroom.group.streamable": "<u8>0</u8>" });
    const error = await createGroup(client, "Group 1", NO_WAITS).catch((e: unknown) => e);
    expect(isMultiroomFailure(error) && error.reason).toBe("not-streamable");
    expect(calls).toEqual(["GET multiroom.group.streamable"]);
  });

  it("adds, removes and ungroups on the server, and hands the server role over", async () => {
    const { client, calls } = radio();
    await addToGroup(client, "UDN-2", NO_WAITS);
    await removeFromGroup(client, "UDN-2", NO_WAITS);
    await destroyGroup(client, NO_WAITS);
    await handOverGroup(client, "UDN-1", NO_WAITS);
    expect(calls).toEqual([
      "SET multiroom.group.addClient=UDN-2",
      "SET multiroom.group.removeClient=UDN-2",
      "SET multiroom.group.destroy=1",
      "SET multiroom.group.state=2",
      "SET multiroom.group.removeClient=UDN-1",
    ]);
  });
});
