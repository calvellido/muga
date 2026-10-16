import { createIntl } from "react-intl";
import { describe, expect, it } from "vitest";
import { pageTitle } from "../src/components/status.ts";
import type { MessageId, MessageValues } from "../src/i18n/index.tsx";
import en from "../src/i18n/messages/en.json";
import { initialSnapshot } from "../src/radio/controller.ts";
import type { PlayState, RadioSnapshot } from "../src/radio/types.ts";

const intl = createIntl({ locale: "en", messages: en });
const t = (id: MessageId, values?: MessageValues) => intl.formatMessage({ id }, values);

function speaker(play: Partial<PlayState>, patch: Partial<RadioSnapshot> = {}): RadioSnapshot {
  const snapshot = initialSnapshot({
    id: "002261000001",
    host: "192.0.2.10",
    pin: "1234",
    name: "Kitchen",
  });
  return {
    ...snapshot,
    connection: "online",
    power: true,
    modeKey: 7,
    modes: [{ key: 7, id: "CD", label: "CD", selectable: 1, streamable: 1, modeType: 1 }],
    play: { ...snapshot.play, status: "PLAYING", ...play },
    ...patch,
  };
}

describe("pageTitle", () => {
  it("puts what's playing first, with the artist when there is one", () => {
    expect(pageTitle(speaker({ name: "Jazz Lounge 7" }), "Kitchen", t)).toBe(
      "▶ Jazz Lounge 7 — Kitchen",
    );
    expect(pageTitle(speaker({ name: "So What", artist: "Miles Davis" }), "Kitchen", t)).toBe(
      "▶ So What · Miles Davis — Kitchen",
    );
  });

  it("names the source when it reports nothing, and marks a pause", () => {
    expect(pageTitle(speaker({}), "Kitchen", t)).toBe("▶ CD — Kitchen");
    expect(pageTitle(speaker({ status: "PAUSED" }), "Kitchen", t)).toBe("⏸ CD — Kitchen");
  });

  it("names only the speaker when nothing plays, and the app without one", () => {
    expect(pageTitle(speaker({ status: "STOPPED" }), "Kitchen", t)).toBe("Kitchen — Muga");
    expect(pageTitle(speaker({}, { power: false }), "Kitchen", t)).toBe("Kitchen — Muga");
    expect(pageTitle(speaker({}, { connection: "offline" }), "Kitchen", t)).toBe("Kitchen — Muga");
    expect(pageTitle(undefined, "", t)).toBe("Muga");
  });
});
