import { responseTimestamp, z } from "../openapi";
import { calendarDataSchema } from "./schema";

export const calendarSchema = calendarDataSchema.extend({
  id: z.string(),
  workspaceId: z.string(),
  key: z.string(),
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
export const calendarListSchema = z.object({
  data: z.array(calendarSchema),
  page: z.object({
    previousCursor: z.string().nullable(),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  meta: z.object({ total: z.number().int().min(0) }),
});
export const calendarPreviewSchema = z.object({
  calendarId: z.string(),
  year: z.number().int(),
  weeklyCoverMinutes: z.number().int(),
  annualCoverMinutes: z.number().int(),
  hasCover: z.boolean(),
});
/** CAL-13: open work items whose deadlines a retroactive holiday moves later; 0 when none. */
const affectedWorkItemCount = z.number().int().min(0).openapi({
  description:
    "CAL-13. Unresolved work items pinned to a policy version on this calendar that started on or before the end of a past or current-day holiday this change newly covers. Future-dated additions are not counted (due instants are not stored).",
});
export const calendarUpdateSchema = calendarSchema.extend({
  affectedWorkItemCount,
});
export const holidayPresetListSchema = z.object({
  datasetVersion: z.string(),
  presets: z.array(
    z.object({
      country: z.string(),
      name: z.string(),
      notIncluded: z.string(),
    }),
  ),
});
export const holidayPresetResultSchema = z.object({
  datasetVersion: z.string(),
  country: z.string(),
  year: z.number().int(),
  /** CAL-11: what this preset deliberately leaves out. A starting point, never authority. */
  notIncluded: z.string(),
  holidays: z.array(
    z.object({
      date: z.string(),
      name: z.string(),
      /** Already present on the calendar (as a dated or annually recurring holiday). */
      existing: z.boolean(),
    }),
  ),
  applied: z.boolean(),
  importedCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  affectedWorkItemCount,
  calendar: calendarSchema.nullable(),
});
export const calendarHolidayImportSchema = z.object({
  calendar: calendarSchema,
  affectedWorkItemCount,
  importedCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
});
