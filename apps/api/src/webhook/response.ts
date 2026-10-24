import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const webhookHealthSchema = z.enum([
  "healthy",
  "failing",
  "paused",
  "inactive",
  "untested",
]);

export const webhookSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  disabledAt: nullableResponseTimestamp,
  disabledReason: z.string().nullable(),
  failingSince: nullableResponseTimestamp,
  lastError: z.string().nullable(),
  secretRotatedAt: nullableResponseTimestamp,
  /** True while the rotated-out secret still signs (`WH-13`). */
  previousSecretActive: z.boolean(),
  ownerPersonId: z.string(),
  ownerName: z.string().nullable(),
  health: webhookHealthSchema,
  lastDeliveryState: z.string().nullable(),
  lastDeliveryStatusCode: z.number().int().nullable(),
  lastDeliveryAt: nullableResponseTimestamp,
  version: z.number().int().min(1),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

export const webhookListSchema = z.object({
  data: z.array(webhookSchema),
  meta: z.object({ total: z.number().int().min(0) }),
});

export const webhookDeliverySchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  eventId: z.string(),
  eventKind: z.string(),
  source: z.enum(["event", "test", "redelivery"]),
  redeliveryOf: z.string().nullable(),
  attempt: z.number().int(),
  state: z.string(),
  nextAttemptAt: nullableResponseTimestamp,
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  attemptedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
  /** `WH-6`: null (redacted) when the delivery's entity is outside the reader's reach. */
  requestBody: z.unknown().nullable(),
  responseBody: z.string().nullable(),
  bodyRedacted: z.boolean(),
});

export const webhookDeliveryListSchema = z.object({
  data: z.array(webhookDeliverySchema),
  page: z.object({
    nextBefore: z.string().nullable(),
    hasMore: z.boolean(),
  }),
});

export const webhookVersionConflictSchema = z.object({
  message: z.string(),
  currentVersion: z.number().int(),
});
