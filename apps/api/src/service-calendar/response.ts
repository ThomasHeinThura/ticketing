import { responseTimestamp, z } from "../openapi";
import { calendarDataSchema } from "./schema";

export const calendarSchema = calendarDataSchema.extend({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  version: z.number().int().min(1),
});
export const calendarVersionConflictSchema = z
  .object({
    message: z.string(),
    assertedVersion: z.number().int(),
    currentVersion: z.number().int(),
  })
  .openapi("ServiceCalendarVersionConflict");
export const calendarListSchema = z.array(calendarSchema);
export const calendarPreviewSchema = z.object({
  calendarId: z.string(),
  year: z.number().int(),
  weeklyCoverMinutes: z.number().int(),
  annualCoverMinutes: z.number().int(),
  hasCover: z.boolean(),
});
