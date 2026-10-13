import { responseTimestamp, z } from "../openapi";

export const preferenceItemSchema = z
  .object({
    key: z.string(),
    value: z.unknown(),
    updatedAt: responseTimestamp,
  })
  .openapi("UserPreferenceItem");

export const preferenceListSchema = z
  .object({
    scope: z.string(),
    scopeId: z.string().nullable(),
    preferences: z.array(preferenceItemSchema),
  })
  .openapi("UserPreferenceList");

export const preferenceWrittenSchema = z
  .object({
    scope: z.string(),
    scopeId: z.string().nullable(),
    key: z.string(),
    value: z.unknown(),
    updatedAt: responseTimestamp,
  })
  .openapi("UserPreference");
