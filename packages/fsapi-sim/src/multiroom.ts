import { MAX_GROUP_CLIENTS } from "@muga/fsapi-core";
import type { SimState } from "./behaviors.ts";

/** A speaker joining a network. */
export interface MultiroomSpeakerInfo {
  /** Multiroom UDN, as `listAll` reports it and `addClient` takes it. */
  udn: string;
  /** What `listAll` reports as the speaker's address. */
  ip: string;
  state: SimState;
}

/** A speaker's link to its network. */
export interface MultiroomLink {
  /** Side effects of an accepted SET. Returns a status to answer instead of FS_OK. */
  apply(path: string, value: number | string): string | undefined;
  /** Something set a value (a behavior, or the test): keep the group in step. */
  changed(path: string): void;
  leave(): void;
}

/**
 * Simulated speakers that can group with each other: every one of them lists all of them in
 * `multiroom.device.listAll`, and group changes on a server reach its clients. Pass the same
 * network to several `startSimulator` calls, or use `startSimulatedHome`.
 */
export interface MultiroomNetwork {
  /** Multiroom UDNs of the speakers on the network, in the order they joined. */
  readonly speakers: readonly string[];
  join(speaker: MultiroomSpeakerInfo): MultiroomLink;
}

interface Member extends MultiroomSpeakerInfo {
  group: Group | undefined;
  clientNumber: number | undefined;
  /** The source a client played before it joined, to go back to when it leaves. */
  ownMode: number | undefined;
}

interface Group {
  id: string;
  name: string;
  server: Member;
  clients: Member[];
}

/** What a client mirrors from its server. */
const MIRRORED = new Set([
  "netRemote.play.status",
  "netRemote.play.info.name",
  "netRemote.play.info.text",
  "netRemote.play.info.artist",
  "netRemote.play.info.album",
  "netRemote.play.info.graphicUri",
]);

/** Values that show in the speaker list or a server's client volumes. */
const LISTED = new Set([
  "netRemote.sys.audio.volume",
  "netRemote.sys.audio.mute",
  "netRemote.sys.info.friendlyName",
]);

const GROUP_ROLE = { NO_GROUP: 0, CLIENT: 1, SERVER: 2 } as const;
const NO_CLIENT = 255;
const PLAY_STOPPED = 6;

/**
 * An approximation of Frontier multiroom, after UNDOK's use of it (Analysis doc 05 §6):
 * - a client switches to the hidden "Audsync" source and mirrors what its server plays;
 * - choosing a source on a client takes it out of its group; a server choosing a source that
 *   can't be shared (`streamable` 0 in `validModes`) ends the group;
 * - the master volume is the loudest member's volume, and setting it scales every member's
 *   volume in proportion. How real radios compute it is unknown.
 */
export interface MultiroomNetworkOptions {
  /**
   * Whether a speaker lists itself in `listAll`. Default true; whether real radios do is
   * unverified, so clients are tested both ways.
   */
  listsItself?: boolean;
}

export function createMultiroomNetwork(options: MultiroomNetworkOptions = {}): MultiroomNetwork {
  const listsItself = options.listsItself ?? true;
  const members: Member[] = [];
  let groupCount = 0;
  let version = 0;
  let lastListing = "";
  /** Writes made by the network itself don't feed back into it. */
  let syncing = 0;

  const write = (member: Member, path: string, value: number | string) => {
    syncing++;
    try {
      if (member.state.get(path) !== value) member.state.set(path, value);
    } finally {
      syncing--;
    }
  };

  const modes = (member: Member) => member.state.list("netRemote.sys.caps.validModes");
  const currentMode = (member: Member) => Number(member.state.get("netRemote.sys.mode") ?? 0);
  const streamable = (member: Member) =>
    modes(member).find((m) => m.key === currentMode(member))?.streamable === 1;
  const audsyncKey = (member: Member) => modes(member).find((m) => m.id === "Audsync")?.key;
  const volume = (member: Member) => Number(member.state.get("netRemote.sys.audio.volume") ?? 0);
  const maxVolume = (member: Member) =>
    Math.max(0, Number(member.state.get("netRemote.sys.caps.volumeSteps") ?? 32) - 1);
  const find = (udn: string) =>
    members.find((m) => m.udn.toUpperCase() === String(udn).trim().toUpperCase());
  const role = (member: Member) =>
    !member.group ? "NO_GROUP" : member.group.server === member ? "SERVER" : "CLIENT";

  const mirror = (group: Group) => {
    for (const client of group.clients) {
      for (const path of MIRRORED) write(client, path, group.server.state.get(path) ?? "");
    }
  };

  const refreshVolumes = (group: Group) => {
    const server = group.server;
    for (let n = 0; n < MAX_GROUP_CLIENTS; n++) {
      const client = group.clients.find((c) => c.clientNumber === n);
      write(server, `netRemote.multiroom.client.volume${n}`, client ? volume(client) : 0);
      write(
        server,
        `netRemote.multiroom.client.mute${n}`,
        client?.state.get("netRemote.sys.audio.mute") ?? 0,
      );
      write(server, `netRemote.multiroom.client.status${n}`, client ? 2 : 0);
    }
    const all = [server, ...group.clients];
    write(server, "netRemote.multiroom.group.masterVolume", Math.max(...all.map(volume)));
  };

  /** Writes every member's group nodes and the shared speaker list. */
  const publish = () => {
    const listing = members.map((member, key) => ({
      key,
      UDN: member.udn,
      FriendlyName: String(member.state.get("netRemote.sys.info.friendlyName") ?? ""),
      IPAddress: member.ip,
      AudioSyncVersion: String(member.state.get("netRemote.multiroom.caps.protocolVersion") ?? ""),
      GroupId: member.group?.id ?? "",
      GroupName: member.group?.name ?? "",
      GroupRole: GROUP_ROLE[role(member)],
      ClientNumber: member.clientNumber ?? NO_CLIENT,
      SystemId: "",
      SystemRole: 0,
      SystemName: "",
    }));
    const text = JSON.stringify(listing);
    if (text !== lastListing) {
      lastListing = text;
      version++;
    }
    for (const member of members) {
      const group = member.group;
      syncing++;
      try {
        member.state.setList(
          "netRemote.multiroom.device.listAll",
          listsItself ? listing : listing.filter((item) => item.UDN !== member.udn),
        );
      } finally {
        syncing--;
      }
      write(member, "netRemote.multiroom.device.listAllVersion", version);
      write(member, "netRemote.multiroom.group.state", GROUP_ROLE[role(member)]);
      write(member, "netRemote.multiroom.group.id", group?.id ?? "");
      write(member, "netRemote.multiroom.group.name", group?.name ?? "");
      write(member, "netRemote.multiroom.group.streamable", streamable(member) ? 1 : 0);
      write(member, "netRemote.multiroom.device.clientIndex", member.clientNumber ?? NO_CLIENT);
      write(member, "netRemote.multiroom.device.clientStatus", member.clientNumber ?? 0);
      write(
        member,
        "netRemote.multiroom.group.attachedClients",
        group?.server === member ? group.clients.length : 0,
      );
      if (group?.server === member) refreshVolumes(group);
    }
  };

  /** Takes a client out of its group; `revert` puts it back on the source it played before. */
  const detach = (client: Member, revert: boolean) => {
    const group = client.group;
    if (group) group.clients = group.clients.filter((c) => c !== client);
    client.group = undefined;
    client.clientNumber = undefined;
    if (revert) {
      const mode = client.ownMode ?? 0;
      const label = modes(client).find((m) => m.key === mode)?.label ?? `Mode ${mode}`;
      write(client, "netRemote.sys.mode", mode);
      write(client, "netRemote.play.status", PLAY_STOPPED);
      write(client, "netRemote.play.info.name", String(label));
      write(client, "netRemote.play.info.text", "");
      write(client, "netRemote.play.info.graphicUri", "");
    }
    client.ownMode = undefined;
  };

  const dissolve = (group: Group) => {
    for (const client of [...group.clients]) detach(client, true);
    group.server.group = undefined;
  };

  const join = (group: Group, client: Member) => {
    const previous = client.group;
    if (previous?.server === client) dissolve(previous);
    else if (previous) detach(client, false);
    client.ownMode ??= currentMode(client);
    const used = new Set(group.clients.map((c) => c.clientNumber));
    client.clientNumber = [0, 1, 2, 3].find((n) => !used.has(n));
    client.group = group;
    group.clients.push(client);
    write(client, "netRemote.sys.power", 1);
    const audsync = audsyncKey(client);
    if (audsync !== undefined) write(client, "netRemote.sys.mode", audsync);
    mirror(group);
  };

  /** A client takes over as server; the old server becomes a client. */
  const handOver = (group: Group, next: Member) => {
    const old = group.server;
    const number = next.clientNumber;
    group.server = next;
    group.clients = [...group.clients.filter((c) => c !== next), old];
    next.clientNumber = undefined;
    next.ownMode = undefined;
    write(next, "netRemote.sys.mode", currentMode(old));
    old.clientNumber = number;
    old.ownMode = currentMode(old);
    const audsync = audsyncKey(old);
    if (audsync !== undefined) write(old, "netRemote.sys.mode", audsync);
    mirror(group);
  };

  const scaleVolumes = (group: Group, target: number) => {
    const all = [group.server, ...group.clients];
    const loudest = Math.max(...all.map(volume));
    for (const member of all) {
      const scaled = loudest === 0 ? target : Math.round((volume(member) * target) / loudest);
      write(member, "netRemote.sys.audio.volume", Math.min(maxVolume(member), Math.max(0, scaled)));
    }
  };

  /** A SET on `member`. Returns a status instead of FS_OK; undefined when nothing applies. */
  const handle = (member: Member, path: string, value: number | string): string | undefined => {
    const group = member.group;
    const serving = group?.server === member ? group : undefined;
    switch (path) {
      case "netRemote.multiroom.group.create": {
        if (!streamable(member)) return "FS_FAIL";
        if (serving) dissolve(serving);
        else if (group) detach(member, false);
        groupCount++;
        member.group = {
          id: `5a1d${String(groupCount).padStart(4, "0")}-0000-4000-8000-${String(groupCount).padStart(12, "0")}`,
          name: String(value),
          server: member,
          clients: [],
        };
        return undefined;
      }
      case "netRemote.multiroom.group.addClient": {
        const client = find(String(value));
        if (!serving || !client || client === member) return "FS_FAIL";
        const protocol = (m: Member) => m.state.get("netRemote.multiroom.caps.protocolVersion");
        if (protocol(client) !== protocol(member)) return "FS_FAIL";
        if (client.group === serving) return undefined;
        if (serving.clients.length >= MAX_GROUP_CLIENTS) return "FS_FAIL";
        join(serving, client);
        return undefined;
      }
      case "netRemote.multiroom.group.removeClient": {
        const client = find(String(value));
        if (!serving || !client || client.group !== serving || client === member) return "FS_FAIL";
        detach(client, true);
        return undefined;
      }
      case "netRemote.multiroom.group.destroy":
        write(member, path, 0);
        if (value !== 1) return undefined;
        if (!serving) return "FS_FAIL";
        dissolve(serving);
        return undefined;
      case "netRemote.multiroom.group.state":
        if (value === GROUP_ROLE.SERVER) {
          if (serving) return undefined;
          if (!group) return "FS_FAIL";
          handOver(group, member);
          return undefined;
        }
        if (value === GROUP_ROLE.NO_GROUP) {
          if (serving) dissolve(serving);
          else if (group) detach(member, true);
          return undefined;
        }
        return "FS_FAIL";
      case "netRemote.multiroom.group.masterVolume":
        if (!serving) return "FS_FAIL";
        scaleVolumes(serving, Number(value));
        return undefined;
      case "netRemote.sys.mode":
        if (group && !serving) detach(member, false);
        else if (serving && !streamable(member)) dissolve(serving);
        else if (serving) mirror(serving);
        return undefined;
      default: {
        const client = /^netRemote\.multiroom\.client\.(volume|mute)(\d)$/.exec(path);
        if (!client) return undefined;
        const target = serving?.clients.find((c) => c.clientNumber === Number(client[2]));
        if (!target) return "FS_FAIL";
        if (client[1] === "volume") {
          write(target, "netRemote.sys.audio.volume", Math.min(maxVolume(target), Number(value)));
        } else {
          write(target, "netRemote.sys.audio.mute", Number(value));
        }
        return undefined;
      }
    }
  };

  return {
    get speakers() {
      return members.map((m) => m.udn);
    },
    join(info) {
      const member: Member = {
        ...info,
        group: undefined,
        clientNumber: undefined,
        ownMode: undefined,
      };
      members.push(member);
      write(member, "netRemote.multiroom.caps.maxClients", MAX_GROUP_CLIENTS);
      write(member, "netRemote.multiroom.device.serverStatus", "STREAM_PRESENTABLE");
      publish();
      return {
        apply(path, value) {
          if (!path.startsWith("netRemote.multiroom.") && path !== "netRemote.sys.mode") {
            if (LISTED.has(path)) publish();
            return undefined;
          }
          const status = handle(member, path, value);
          publish();
          return status;
        },
        changed(path) {
          if (syncing > 0) return;
          const group = member.group;
          if (group?.server === member && MIRRORED.has(path)) mirror(group);
          if (LISTED.has(path) || path === "netRemote.sys.mode") publish();
        },
        leave() {
          const group = member.group;
          if (group?.server === member) dissolve(group);
          else if (group) detach(member, false);
          members.splice(members.indexOf(member), 1);
          publish();
        },
      };
    },
  };
}
