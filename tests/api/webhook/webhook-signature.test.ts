import { describe, expect, it } from "vitest";
import {
  WEBHOOK_SECRET_OVERLAP_MS,
  webhookRetryDelayMs,
} from "../../../apps/api/src/webhook/constants";
import {
  buildWebhookHeaders,
  previousSecretStillValid,
  signWebhookBody,
} from "../../../apps/api/src/webhook/signature";

const BODY = '{"id":"evt_01TEST","event":"work_item.created"}';
const SECRET = "whsec_known_vector_secret_0001";
const PREVIOUS = "whsec_previous_secret_value_02";
const NOW = new Date("2026-10-23T10:00:00.000Z");

describe("WH-1 signature", () => {
  it("matches a fixed known vector over the raw body", () => {
    expect(signWebhookBody(SECRET, BODY)).toBe(
      "b7807130e01c02b9ddddebdc52216c61356bb35264003ec725d2b450cf03ffba",
    );
  });

  it("signs the exact bytes, so a re-serialised body does not verify", () => {
    const reordered = '{"event":"work_item.created","id":"evt_01TEST"}';
    expect(signWebhookBody(SECRET, reordered)).not.toBe(
      signWebhookBody(SECRET, BODY),
    );
  });
});

describe("WH-2 headers", () => {
  const headers = buildWebhookHeaders({
    rawBody: BODY,
    secret: SECRET,
    secretPrevious: null,
    secretRotatedAt: null,
    eventKind: "work_item.created",
    deliveryId: "dlv_1",
    now: NOW,
  });

  it("carries event, delivery and timestamp headers", () => {
    expect(headers["X-TaskDesk-Event"]).toBe("work_item.created");
    expect(headers["X-TaskDesk-Delivery"]).toBe("dlv_1");
    expect(headers["X-TaskDesk-Timestamp"]).toBe(
      String(Math.floor(NOW.getTime() / 1000)),
    );
    expect(headers["X-TaskDesk-Signature"]).toBe(signWebhookBody(SECRET, BODY));
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends no previous signature without a rotation", () => {
    expect(headers["X-TaskDesk-Signature-Previous"]).toBeUndefined();
  });
});

describe("WH-13 rotation overlap", () => {
  const rotatedAt = new Date(NOW.getTime() - 60_000);

  it("adds a second signature with the previous secret inside 24 hours", () => {
    const headers = buildWebhookHeaders({
      rawBody: BODY,
      secret: SECRET,
      secretPrevious: PREVIOUS,
      secretRotatedAt: rotatedAt,
      eventKind: "work_item.created",
      deliveryId: "dlv_1",
      now: NOW,
    });
    expect(headers["X-TaskDesk-Signature"]).toBe(signWebhookBody(SECRET, BODY));
    expect(headers["X-TaskDesk-Signature-Previous"]).toBe(
      "1b4cce69eeca1bc523e591920be99b9c5a85abc1c3279e63169e61a2fb853d72",
    );
  });

  it("stops signing with the previous secret at exactly 24 hours", () => {
    expect(
      previousSecretStillValid(
        new Date(NOW.getTime() - WEBHOOK_SECRET_OVERLAP_MS + 1),
        NOW,
      ),
    ).toBe(true);
    expect(
      previousSecretStillValid(
        new Date(NOW.getTime() - WEBHOOK_SECRET_OVERLAP_MS),
        NOW,
      ),
    ).toBe(false);
    expect(previousSecretStillValid(null, NOW)).toBe(false);
  });

  it("does not add the second signature after the window", () => {
    const headers = buildWebhookHeaders({
      rawBody: BODY,
      secret: SECRET,
      secretPrevious: PREVIOUS,
      secretRotatedAt: new Date(NOW.getTime() - WEBHOOK_SECRET_OVERLAP_MS - 1),
      eventKind: "work_item.created",
      deliveryId: "dlv_1",
      now: NOW,
    });
    expect(headers["X-TaskDesk-Signature-Previous"]).toBeUndefined();
  });
});

describe("WH-4 retry schedule", () => {
  it("waits 30 s, 2 m, 10 m, 1 h, 6 h and is dead after the sixth attempt", () => {
    expect(
      [1, 2, 3, 4, 5].map((attempt) => webhookRetryDelayMs(attempt)),
    ).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
    expect(webhookRetryDelayMs(6)).toBeNull();
  });

  it("rejects a non-positive attempt", () => {
    expect(() => webhookRetryDelayMs(0)).toThrow(RangeError);
  });
});
