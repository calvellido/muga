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
 * Simulated speakers that can group with each other: each lists the others in
 * `multiroom.device.listAll`, and group changes on a server reach its clients. Pass the same
 * network to several `startSimulator` calls, or use `startSimulatedHome`.
 */
export interface MultiroomNetwork {
  /** Multiroom UDNs of the speakers on the network, in the order they joined. */
  readonly speakers: readonly string[];
  join(speaker: MultiroomSpeakerInfo): MultiroomLink;
}

export interface MultiroomNetworkOptions {
  /** Whether a speaker lists itself in `listAll`. Default false, as real radios do. */
  listsItself?: boolean;
  /**
   * How long `listAll` takes to show a change. Default 0. Real radios took from a few seconds
   * to a minute; their own `group.*` nodes change at once.
   */
  listDelayMs?: number;
  /**
   * Whether `viewer` lists `speaker` (multiroom UDNs). Default: every speaker lists every other.
   * Real radios each knew only some of the others.
   */
  sees?: (viewer: string, speaker: string) => boolean;
}

interface Member extends MultiroomSpeakerInfo {
  group: Group | undefined;
  clientNumber: number | undefined;
  /** `listAll` as this speaker last published it, and its version. */
  listing: string;
  version: number;
}

interface Group {
  id: string;
  name: string;
  server: Member;
  clients: Member[];
}

/** Values that show in the speaker list or a server's client volumes. */
const LISTED = new Set([
  "netRemote.sys.audio.volume",
  "netRemote.sys.audio.mute",
  "netRemote.sys.info.friendlyName",
]);

const GROUP_ROLE = { NO_GROUP: 0, CLIENT: 1, SERVER: 2 } as const;
const NO_CLIENT = 255;
/** `sys.mode` of a client, and of a speaker that left a group: no source. */
const NO_MODE = 0xffff_ffff;
const PLAY_IDLE = 0;

/**
 * Frontier multiroom as an ICD2018 (V2.13), an SMRS30A1 (V2.11) and a Ruark MRx (V2.14) showed
 * it (ADR 0008):
 * - a client reports no source (`sys.mode` 0xFFFFFFFF) and no station name, and plays what its
 *   server plays (its `play.status` follows the server's);
 * - a speaker that leaves a group, or whose group ends, is idle with no source;
 * - `group.state` SERVER (or `becomeServer`) on a client is accepted but changes nothing;
 * - a speaker with no source (one that was a client) can create a group, but not add clients;
 * - the master volume reads as the members' average; setting it scales every member's volume to
 *   reach that average.
 *
 * Not seen on real radios: choosing a source on a client takes it out of its group, and a server
 * choosing a source that can't be shared (`streamable` 0) ends the group, as UNDOK's warnings say.
 */
export function createMultiroomNetwork(options: MultiroomNetworkOptions = {}): MultiroomNetwork {
  const listsItself = options.listsItself ?? false;
  const listDelayMs = options.listDelayMs ?? 0;
  const sees = options.sees ?? (() => true);
  const members: Member[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let groupCount = 0;
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
  /** With no source, a speaker that's on can lead (an SMRS30A1 just out of a group), one in standby can't (a Ruark). */
  const streamable = (member: Member) => {
    const mode = currentMode(member);
    if (mode === NO_MODE) return Number(member.state.get("netRemote.sys.power")) === 1;
    return modes(member).find((m) => m.key === mode)?.streamable === 1;
  };
  const volume = (member: Member) => Number(member.state.get("netRemote.sys.audio.volume") ?? 0);
  const maxVolume = (member: Member) =>
    Math.max(0, Number(member.state.get("netRemote.sys.caps.volumeSteps") ?? 32) - 1);
  const find = (udn: string) =>
    members.find((m) => m.udn.toUpperCase() === String(udn).trim().toUpperCase());
  const role = (member: Member) =>
    !member.group ? "NO_GROUP" : member.group.server === member ? "SERVER" : "CLIENT";

  /** Clients play what the server plays, without its name or artwork. */
  const follow = (group: Group) => {
    for (const client of group.clients) {
      write(client, "netRemote.play.status", group.server.state.get("netRemote.play.status") ?? 0);
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
    const average = all.reduce((sum, m) => sum + volume(m), 0) / all.length;
    write(server, "netRemote.multiroom.group.masterVolume", Math.round(average));
  };

  const listItem = (member: Member, key: number) => ({
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
  });

  const setListing = (member: Member, listing: ReturnType<typeof listItem>[]) => {
    const text = JSON.stringify(listing);
    if (text === member.listing) return;
    member.listing = text;
    member.version++;
    syncing++;
    try {
      member.state.setList("netRemote.multiroom.device.listAll", listing);
    } finally {
      syncing--;
    }
    write(member, "netRemote.multiroom.device.listAllVersion", member.version);
  };

  /** Writes every member's own group nodes now, and its `listAll` now or after the delay. */
  const publish = () => {
    for (const member of members) {
      const group = member.group;
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

      const listing = members
        .map(listItem)
        .filter((item) => (item.UDN === member.udn ? listsItself : sees(member.udn, item.UDN)));
      if (listDelayMs <= 0) {
        setListing(member, listing);
      } else {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (members.includes(member)) setListing(member, listing);
        }, listDelayMs);
        timers.add(timer);
      }
    }
  };

  /** Takes a client out of its group: it's left idle, with no source. */
  const detach = (client: Member) => {
    const group = client.group;
    if (group) group.clients = group.clients.filter((c) => c !== client);
    client.group = undefined;
    client.clientNumber = undefined;
    write(client, "netRemote.sys.mode", NO_MODE);
    write(client, "netRemote.play.status", PLAY_IDLE);
  };

  const dissolve = (group: Group) => {
    for (const client of [...group.clients]) detach(client);
    group.server.group = undefined;
  };

  const join = (group: Group, client: Member) => {
    const previous = client.group;
    if (previous?.server === client) dissolve(previous);
    else if (previous) detach(client);
    const used = new Set(group.clients.map((c) => c.clientNumber));
    client.clientNumber = [0, 1, 2, 3].find((n) => !used.has(n));
    client.group = group;
    group.clients.push(client);
    write(client, "netRemote.sys.power", 1);
    write(client, "netRemote.sys.mode", NO_MODE);
    for (const path of ["name", "text", "artist", "album", "graphicUri"]) {
      write(client, `netRemote.play.info.${path}`, "");
    }
    follow(group);
  };

  /** Scales every member's volume so that their average becomes `target`. */
  const scaleVolumes = (group: Group, target: number) => {
    const all = [group.server, ...group.clients];
    const average = all.reduce((sum, m) => sum + volume(m), 0) / all.length;
    for (const member of all) {
      const scaled = average === 0 ? target : Math.round((volume(member) * target) / average);
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
        else if (group) detach(member);
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
        // An SMRS30A1 leading a group with nothing to play refused a client.
        if (currentMode(member) === NO_MODE) return "FS_FAIL";
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
        detach(client);
        return undefined;
      }
      case "netRemote.multiroom.group.destroy":
        write(member, path, 0);
        if (value !== 1) return undefined;
        if (!serving) return "FS_FAIL";
        dissolve(serving);
        return undefined;
      case "netRemote.multiroom.group.state":
      case "netRemote.multiroom.group.becomeServer":
        // Real radios take SERVER on a client for a second, then go back to being a client.
        if (value === GROUP_ROLE.NO_GROUP) {
          if (serving) dissolve(serving);
          else if (group) detach(member);
        }
        return undefined;
      case "netRemote.multiroom.group.masterVolume":
        if (!serving) return "FS_FAIL";
        scaleVolumes(serving, Number(value));
        return undefined;
      case "netRemote.sys.mode":
        if (group && !serving) {
          // Back from NO_MODE to the source just chosen, outside the group.
          group.clients = group.clients.filter((c) => c !== member);
          member.group = undefined;
          member.clientNumber = undefined;
        } else if (serving && !streamable(member)) {
          dissolve(serving);
        } else if (serving) {
          follow(serving);
        }
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
        listing: "",
        version: 0,
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
          if (group?.server === member && path === "netRemote.play.status") follow(group);
          if (LISTED.has(path) || path === "netRemote.sys.mode") publish();
        },
        leave() {
          const group = member.group;
          if (group?.server === member) dissolve(group);
          else if (group) detach(member);
          members.splice(members.indexOf(member), 1);
          if (members.length === 0) {
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
          }
          publish();
        },
      };
    },
  };
}
