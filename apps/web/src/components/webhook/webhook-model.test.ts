import { describe, expect, it } from "vitest";
import {
  ALL_WEBHOOK_EVENTS,
  formatPayload,
  generateWebhookSecret,
  needsReown,
  validateWebhookForm,
} from "./webhook-model";

describe("generateWebhookSecret", () => {
  it("produces a long, url-safe, prefixed secret that differs each time", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("uses the supplied random source", () => {
    const secret = generateWebhookSecret({
      getRandomValues: ((array: Uint8Array) => {
        array.fill(0);
        return array;
      }) as Crypto["getRandomValues"],
    });
    expect(secret).toBe(`whsec_${"A".repeat(43)}`);
  });
});

describe("validateWebhookForm", () => {
  const valid = {
    name: "Ops",
    url: "https://hooks.example.com/in",
    secret: "x".repeat(24),
    events: ["work_item.created"],
  };

  it("accepts a complete form", () => {
    expect(validateWebhookForm(valid, { requireSecret: true })).toEqual([]);
  });

  it("names every problem", () => {
    expect(
      validateWebhookForm(
        { name: " ", url: "nope", secret: "short", events: [] },
        { requireSecret: true },
      ),
    ).toEqual([
      "nameRequired",
      "urlInvalid",
      "secretTooShort",
      "eventsRequired",
    ]);
  });

  it("requires https unless the development relaxation is on", () => {
    const http = { ...valid, url: "http://hooks.example.com/in" };
    expect(validateWebhookForm(http, { requireSecret: true })).toEqual([
      "urlNotHttps",
    ]);
    expect(
      validateWebhookForm(http, { requireSecret: true, allowHttp: true }),
    ).toEqual([]);
  });

  it("does not ask for a secret on an edit", () => {
    expect(
      validateWebhookForm({ ...valid, secret: "" }, { requireSecret: false }),
    ).toEqual([]);
  });

  it("offers only distinct events", () => {
    expect(new Set(ALL_WEBHOOK_EVENTS).size).toBe(ALL_WEBHOOK_EVENTS.length);
  });
});

describe("helpers", () => {
  it("flags a webhook paused because its owner left", () => {
    expect(needsReown({ disabledReason: "owner_left" })).toBe(true);
    expect(needsReown({ disabledReason: "failing_24h" })).toBe(false);
  });

  it("formats payloads", () => {
    expect(formatPayload(null)).toBe("");
    expect(formatPayload("raw")).toBe("raw");
    expect(formatPayload({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
