import { z } from "../openapi";
import { WEBHOOK_EVENT_KEYS } from "./constants";

const eventKey = z.enum(WEBHOOK_EVENT_KEYS);

const eventsField = z
  .array(eventKey)
  .min(1)
  .max(WEBHOOK_EVENT_KEYS.length)
  .refine((events) => new Set(events).size === events.length, {
    message: "events must not repeat",
  });

/**
 * The signing secret is write-only (`WH-1`: "never returned by the API"). The consumer therefore
 * chooses it and supplies it here; the UI offers a generator, and the value is never echoed.
 */
export const webhookSecretField = z.string().min(24).max(256);

export const webhookIdParam = z.object({ id: z.string().min(1).max(128) });
export const deliveryIdParam = z.object({ id: z.string().min(1).max(128) });

export const workspaceHeader = z.object({
  "x-workspace-id": z.string().min(1).max(128),
});

export const createWebhookBody = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2048),
  secret: webhookSecretField,
  events: eventsField,
});

export const updateWebhookBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    url: z.string().trim().min(1).max(2048).optional(),
    events: eventsField.optional(),
    active: z.boolean().optional(),
    /** Re-own a paused webhook to the caller (`WH-14`). */
    reown: z.literal(true).optional(),
    version: z.number().int().min(1).optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "version"), {
    message: "At least one field is required",
  });

export const rotateSecretBody = z.object({ secret: webhookSecretField });

export const deliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.iso.datetime().optional(),
});
