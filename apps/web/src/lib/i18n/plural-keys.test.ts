import i18next from "i18next";
import { describe, expect, it } from "vitest";
import enUS from "../../../../../i18n/en-US.json";

describe("plural copy", () => {
  it("says 1 time / 1 event, not 1 times / 1 events", async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: "en",
      resources: { en: { automations: enUS.automations } },
      ns: ["automations"],
      interpolation: { escapeValue: false },
    });
    const t = instance.getFixedT("en", "automations");
    expect(t("list.fired", { count: 1 })).toBe("Fired 1 time");
    expect(t("list.fired", { count: 3 })).toBe("Fired 3 times");
    expect(t("dryRun.evaluated", { count: 1 })).toBe("1 event examined.");
    expect(t("dryRun.evaluated", { count: 2 })).toBe("2 events examined.");
    expect(t("dryRun.summary", { count: 1, days: 7 })).toBe(
      "Would have fired 1 time in the last 7 days",
    );
  });
});
