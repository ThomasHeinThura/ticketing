import { z } from "@hono/zod-openapi";

const metricSchema = z.object({
  metric: z.enum(["first_response", "resolution"]),
  state: z.enum(["none", "ok", "at_risk", "breached", "met", "missed"]),
  dueAt: z.date().nullable(),
  targetMinutes: z.number().int().nullable(),
  consumedMinutes: z.number().nonnegative(),
  consumedPct: z.number().nonnegative(),
  remainingMinutes: z.number().nonnegative().nullable(),
});

export const workItemSlaSchema = z.object({
  key: z.string(),
  startedAt: z.date(),
  evaluatedAt: z.date(),
  metrics: z.array(metricSchema).length(2),
});
