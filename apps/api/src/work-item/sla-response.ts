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

const pauseSchema = z.object({
  metric: z.enum(["first_response", "resolution"]),
  startedAt: z.date(),
  endedAt: z.date().nullable(),
  reason: z.string(),
});

// `calendarName`, `atRiskThresholdPct` and `pauses` serve the staff detail (SLA-13, SLA-19).
// The route sits behind `work_item:read` (staff); the requester-scoped portal SLA is a
// separate route that returns only `{state, dueAt}`.
export const workItemSlaSchema = z.object({
  key: z.string(),
  startedAt: z.date(),
  evaluatedAt: z.date(),
  metrics: z.array(metricSchema).length(2),
  calendarName: z.string().nullable(),
  atRiskThresholdPct: z.number().int().nullable(),
  pauses: z.array(pauseSchema),
});

type PauseRow = {
  metric: string;
  startedAt: Date;
  endedAt: Date | null;
  reason: string;
};

/** SLA-13: the pauses still running, oldest first; closed pauses are not part of the display. */
export function openSlaPauses(pauses: readonly PauseRow[]) {
  return pauses
    .filter((pause) => pause.endedAt === null)
    .map((pause) => ({
      metric: pause.metric as "first_response" | "resolution",
      startedAt: pause.startedAt,
      endedAt: null,
      reason: pause.reason,
    }));
}
