import { isIanaTimeZone } from "@taskdesk/domain";
import { z } from "../openapi";

const windowSchema = z.object({
  from: z.number().int().min(0).max(1439),
  to: z.number().int().min(1).max(1440),
});

const datedHoliday = z.object({
  date: z.iso.date(),
  name: z.string().optional(),
});
const rangedHoliday = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  name: z.string().optional(),
});
const recurringHoliday = z
  .object({
    recurs: z.literal("annually"),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    name: z.string().optional(),
  })
  .refine(
    ({ month, day }) => {
      const maximumDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
        month - 1
      ];
      return maximumDays !== undefined && day <= maximumDays;
    },
    { message: "Recurring holiday must be a valid calendar date" },
  );
const holidaySchema = z.union([datedHoliday, rangedHoliday, recurringHoliday]);

const POSTGRES_INTEGER_MAX = 2147483647;
export const optionalCalendarIfMatchHeader = z.object({
  "if-match": z
    .string()
    .regex(
      /^"[1-9]\d*"$/,
      'If-Match must be a positive quoted calendar version, e.g. "3"',
    )
    .refine(
      (value) => Number(value.slice(1, -1)) <= POSTGRES_INTEGER_MAX,
      `If-Match must not exceed ${POSTGRES_INTEGER_MAX}`,
    )
    .optional(),
});

export const calendarDataSchema = z.object({
  timezone: z
    .string()
    .min(1)
    .refine(isIanaTimeZone, "Expected an IANA timezone"),
  windows: z.object({
    sun: z.array(windowSchema).optional(),
    mon: z.array(windowSchema).optional(),
    tue: z.array(windowSchema).optional(),
    wed: z.array(windowSchema).optional(),
    thu: z.array(windowSchema).optional(),
    fri: z.array(windowSchema).optional(),
    sat: z.array(windowSchema).optional(),
  }),
  holidays: z.array(holidaySchema),
});

export const workspaceIdQuery = z.object({ workspaceId: z.string().min(1) });
export const calendarIdParam = z.object({ id: z.string().min(1) });
export const previewQuery = z.object({
  year: z.coerce.number().int().min(1).max(9998),
});
export const createCalendarBody = calendarDataSchema.extend({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
});
export const updateCalendarBody = calendarDataSchema
  .partial()
  .extend({ name: z.string().trim().min(1).max(120).optional() })
  .refine((value) => Object.keys(value).length > 0);
