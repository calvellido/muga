// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NowPlaying } from "../src/components/NowPlaying.tsx";
import { I18nProvider } from "../src/i18n/index.tsx";
import en from "../src/i18n/messages/en.json";
import { initialSnapshot } from "../src/radio/controller.ts";
import type { RadioSnapshot } from "../src/radio/types.ts";

afterEach(cleanup);

/** A speaker on its CD, which reports no track details. */
function onCd(patch: Partial<RadioSnapshot> = {}): RadioSnapshot {
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
    modes: [
      { key: 0, id: "IR", label: "Internet radio", selectable: 1, streamable: 1, modeType: 0 },
      { key: 7, id: "CD", label: "CD", selectable: 1, streamable: 1, modeType: 1 },
    ],
    play: { ...snapshot.play, status: "PLAYING" },
    ...patch,
  };
}

function show(snapshot: RadioSnapshot) {
  render(
    <I18nProvider locale="en" messages={en}>
      <NowPlaying snapshot={snapshot} />
    </I18nProvider>,
  );
  return screen.getByRole("heading").textContent;
}

describe("NowPlaying", () => {
  it("names the source when it reports no track details", () => {
    expect(show(onCd())).toBe("CD");
  });

  it("prefers what the radio says is playing", () => {
    const snapshot = onCd();
    expect(show({ ...snapshot, play: { ...snapshot.play, name: "Track 3" } })).toBe("Track 3");
  });

  it("says nothing is playing in standby, or without a source", () => {
    expect(show(onCd({ power: false }))).toBe("Nothing playing");
    cleanup();
    expect(show(onCd({ modeKey: undefined }))).toBe("Nothing playing");
  });
});
