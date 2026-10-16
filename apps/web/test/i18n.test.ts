import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createIntl } from "react-intl";
import { describe, expect, it } from "vitest";
import { detectLocale, loadMessages, SUPPORTED_LOCALES } from "../src/i18n/index.tsx";
import en from "../src/i18n/messages/en.json";

const MESSAGES_DIR = join(import.meta.dirname, "../src/i18n/messages");
const SAMPLE_VALUES = {
  host: "192.0.2.10",
  message: "boom",
  name: "Kitchen",
  position: "1:02",
  duration: "3:45",
  value: 12,
  max: 31,
  count: 3,
  term: "jazz",
  shown: 14,
  total: 30,
  station: "Radio Muga",
  slot: 2,
  mhz: "93.20",
  minutes: 30,
  key: 4,
  ssid: "MugaNet",
  group: "Downstairs",
  source: "DAB",
  next: "Kitchen",
  number: 2,
  done: 120,
  what: "Jazz Lounge 7",
  mark: "▶",
};

describe("messages", () => {
  it("every message, in every language, is valid ICU and renders", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const errors: unknown[] = [];
      const messages = await loadMessages(locale);
      const intl = createIntl({ locale, messages, onError: (e) => errors.push(e) });
      for (const id of Object.keys(en)) {
        expect(intl.formatMessage({ id }, SAMPLE_VALUES), `${locale} ${id}`).not.toBe(id);
      }
      expect(errors, locale).toEqual([]);
    }
  });

  it("formats plurals", async () => {
    const intl = createIntl({ locale: "en", messages: en });
    expect(intl.formatMessage({ id: "presets.count" }, { count: 0 })).toBe("No presets");
    expect(intl.formatMessage({ id: "presets.count" }, { count: 1 })).toBe("1 preset");
    expect(intl.formatMessage({ id: "presets.count" }, { count: 5 })).toBe("5 presets");
    const es = createIntl({ locale: "es", messages: await loadMessages("es") });
    expect(es.formatMessage({ id: "presets.count" }, { count: 1 })).toBe("1 presintonía");
    expect(es.formatMessage({ id: "groups.count" }, { count: 3 })).toBe("3 altavoces");
  });

  it("every locale file has exactly the English keys", () => {
    const keys = Object.keys(en).sort();
    for (const file of readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"))) {
      const messages = JSON.parse(readFileSync(join(MESSAGES_DIR, file), "utf8"));
      expect(Object.keys(messages).sort(), file).toEqual(keys);
    }
  });
});

describe("detectLocale", () => {
  it("picks the first supported locale and falls back to English", () => {
    expect(detectLocale(["en-GB", "es-ES"])).toBe("en");
    expect(detectLocale(["es-ES", "en"])).toBe("es");
    expect(detectLocale(["fr-FR", "es-MX"])).toBe("es");
    expect(detectLocale(["fr-FR"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});
