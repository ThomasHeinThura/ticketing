import enUS from "@i18n/en-US.json";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { formatWebhookEventCount } from "./webhook-list";

describe("formatWebhookEventCount", () => {
  it("uses real en-US i18next plural rules for singular and plural counts", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "en-US",
      fallbackLng: "en-US",
      defaultNS: "webhooks",
      resources: {
        "en-US": {
          webhooks: enUS.webhooks,
        },
      },
    });
    const t = i18n.getFixedT("en-US", "webhooks");

    expect(formatWebhookEventCount(t, 1)).toBe("1 event");
    expect(formatWebhookEventCount(t, 0)).toBe("0 events");
    expect(formatWebhookEventCount(t, 2)).toBe("2 events");
  });
});
