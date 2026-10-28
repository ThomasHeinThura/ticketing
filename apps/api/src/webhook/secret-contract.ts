import { z } from "@hono/zod-openapi";

/** The signing secret is write-only: consumers supply it, and APIs never echo it. */
export const webhookSecretField = z.string().min(24).max(256);
