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

const title = (play: Partial<PlayState>, patch: Partial<RadioSnapshot> = {}, muted = false) =>
  pageTitle(speaker(play, patch), "Kitchen", t, muted);

describe("pageTitle", () => {
  it("puts what's playing first, with the artist when there is one", () => {
    expect(title({ name: "Jazz Lounge 7" })).toBe("▶ Jazz Lounge 7 | Kitchen | Muga");
    expect(title({ name: "So What", artist: "Miles Davis" })).toBe(
      "▶ So What - Miles Davis | Kitchen | Muga",
    );
  });

  it("names the source when it reports nothing", () => {
    expect(title({})).toBe("▶ CD | Kitchen | Muga");
  });

  it("marks a pause, buffering and a muted speaker", () => {
    expect(title({ status: "PAUSED" })).toBe("⏸ CD | Kitchen | Muga");
    expect(title({ status: "BUFFERING" })).toBe("⏳ CD | Kitchen | Muga");
    expect(title({}, {}, true)).toBe("🔇 CD | Kitchen | Muga");
  });

  it("is just the app's name when nothing plays", () => {
    expect(title({ status: "STOPPED" })).toBe("Muga");
    expect(title({}, { power: false })).toBe("Muga");
    expect(title({}, { connection: "offline" })).toBe("Muga");
    expect(title({}, { modeKey: undefined })).toBe("Muga");
    expect(pageTitle(undefined, "", t)).toBe("Muga");
  });
});
