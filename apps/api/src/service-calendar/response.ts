import { z } from "../openapi";
import { calendarDataSchema } from "./schema";

export const calendarSchema = calendarDataSchema.extend({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
});
export const calendarListSchema = z.array(calendarSchema);
export const calendarPreviewSchema = z.object({
  calendarId: z.string(),
  year: z.number().int(),
  weeklyCoverMinutes: z.number().int(),
  annualCoverMinutes: z.number().int(),
  hasCover: z.boolean(),
});
