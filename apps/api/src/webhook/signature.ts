import { createHmac } from "node:crypto";
import {
  WEBHOOK_HEADER_DELIVERY,
  WEBHOOK_HEADER_EVENT,
  WEBHOOK_HEADER_SIGNATURE,
  WEBHOOK_HEADER_SIGNATURE_PREVIOUS,
  WEBHOOK_HEADER_SIGNATURE_V2,
  WEBHOOK_HEADER_SIGNATURE_V2_PREVIOUS,
  WEBHOOK_HEADER_TIMESTAMP,
  WEBHOOK_SECRET_OVERLAP_MS,
} from "./constants";

/**
 * `WH-1`: HMAC-SHA256 over the **raw request body** (the exact bytes sent), lowercase hex, using
 * the per-webhook secret. The encoding matches the one the notification webhook channel already
 * ships under the same header name (`notification-preferences/delivery.ts`). The timestamp
 * header is deliberately not part of the signed bytes: the contract signs the raw body, and
 * replay defence is the consumer rejecting an old `X-TaskDesk-Timestamp` plus idempotency on the
 * event id.
 */
export function signWebhookBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * `WH-1` v2: HMAC-SHA256 over `<timestamp>.<raw body>` (timestamp = the `X-TaskDesk-Timestamp`
 * value, unix seconds), lowercase hex. Binding the timestamp stops a captured delivery being
 * replayed with a fresh one. v1 stays unchanged for existing consumers.
 */
export function signWebhookBodyV2(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return signWebhookBody(secret, `${timestamp}.${rawBody}`);
}

/** True while a rotated-out secret should still sign (`WH-13`, 24 hours). */
export function previousSecretStillValid(
  rotatedAt: Date | null,
  now: Date,
): boolean {
  if (!rotatedAt) return false;
  const age = now.getTime() - rotatedAt.getTime();
  return age >= 0 && age < WEBHOOK_SECRET_OVERLAP_MS;
}

export type SignedWebhookHeaders = Record<string, string>;

/**
 * Headers for one delivery attempt (`WH-1`, `WH-2`, `WH-13`). The timestamp is unix epoch
 * seconds, taken at send time so a retry never reuses an old one.
 */
export function buildWebhookHeaders(input: {
  rawBody: string;
  secret: string;
  secretPrevious: string | null;
  secretRotatedAt: Date | null;
  eventKind: string;
  deliveryId: string;
  now: Date;
}): SignedWebhookHeaders {
  const timestamp = String(Math.floor(input.now.getTime() / 1000));
  const headers: SignedWebhookHeaders = {
    "Content-Type": "application/json",
    "User-Agent": "TaskDesk-Webhook/1",
    [WEBHOOK_HEADER_EVENT]: input.eventKind,
    [WEBHOOK_HEADER_DELIVERY]: input.deliveryId,
    [WEBHOOK_HEADER_TIMESTAMP]: timestamp,
    [WEBHOOK_HEADER_SIGNATURE]: signWebhookBody(input.secret, input.rawBody),
    [WEBHOOK_HEADER_SIGNATURE_V2]: signWebhookBodyV2(
      input.secret,
      timestamp,
      input.rawBody,
    ),
  };
  if (
    input.secretPrevious &&
    previousSecretStillValid(input.secretRotatedAt, input.now)
  ) {
    headers[WEBHOOK_HEADER_SIGNATURE_PREVIOUS] = signWebhookBody(
      input.secretPrevious,
      input.rawBody,
    );
    headers[WEBHOOK_HEADER_SIGNATURE_V2_PREVIOUS] = signWebhookBodyV2(
      input.secretPrevious,
      timestamp,
      input.rawBody,
    );
  }
  return headers;
}
