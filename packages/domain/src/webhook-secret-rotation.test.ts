import { describe, expect, it } from "vitest";
import { canonicalWebhookSecretRotationPayload } from "./webhook-secret-rotation";

describe("webhook incident rotation binding bytes", () => {
  const entries = [
    { webhookId: "z", expectedVersion: 2, secret: "replacement-z" },
    { webhookId: "a", expectedVersion: 1, secret: " replacement-ä " },
  ] as const;
  it("sorts IDs deterministically and preserves exact Unicode/whitespace without mutating the input", () => {
    expect(canonicalWebhookSecretRotationPayload(entries)).toBe(
      '{"webhooks":[{"webhookId":"a","expectedVersion":1,"secret":" replacement-ä "},{"webhookId":"z","expectedVersion":2,"secret":"replacement-z"}]}',
    );
    expect(entries.map((x) => x.webhookId)).toEqual(["z", "a"]);
    expect(canonicalWebhookSecretRotationPayload([...entries].reverse())).toBe(
      canonicalWebhookSecretRotationPayload(entries),
    );
  });
  it("changes the binding bytes for a different target, version, or secret", () => {
    const baseline = canonicalWebhookSecretRotationPayload(entries);
    for (const changed of [
      { ...entries[0], webhookId: "other" },
      { ...entries[0], expectedVersion: 3 },
      { ...entries[0], secret: "different" },
    ])
      expect(
        canonicalWebhookSecretRotationPayload([changed, entries[1]]),
      ).not.toBe(baseline);
  });
});
