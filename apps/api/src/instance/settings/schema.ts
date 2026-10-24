import { isKnownTimezone } from "../../notification/digest-window";
import { z } from "../../openapi";

/**
 * The `instance_setting` columns God Mode → General and Storage edit that the data model names.
 * Fields the contract describes only in prose (instance name, support email, terms and privacy
 * URLs, health thresholds, MCP ceilings) have no named column and are not part of this DTO.
 */
const extension = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{1,16}$/u, "invalid_extension");

export const settingsFields = {
  approvalDefaultExpiryDays: z.number().int().min(1).max(90),
  clarificationWindowDays: z.number().int().min(1).max(365),
  reopenWindowDays: z.number().int().min(1).max(365),
  notificationRetentionDays: z.number().int().min(1).max(3650),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isKnownTimezone, "unknown_timezone"),
  attachmentMaxBytes: z.number().int().min(1024).max(2_147_483_647),
  attachmentMaxPerItem: z.number().int().min(1).max(10_000),
  attachmentAllowedExtensions: z
    .array(extension)
    .min(1)
    .max(200)
    .transform((values) => [...new Set(values)]),
};

export const patchSettingsBody = z
  .object({
    /** The `updatedAt` the caller last read; a different stored value answers 409. */
    expectedUpdatedAt: z.string().datetime(),
    changes: z
      .object(settingsFields)
      .partial()
      .strict()
      .refine((value) => Object.keys(value).length > 0, "no_changes"),
  })
  .strict();

export const settingsResponseSchema = z.object({
  updatedAt: z.string().datetime(),
  settings: z.object({
    approvalDefaultExpiryDays: z.number().int(),
    clarificationWindowDays: z.number().int(),
    reopenWindowDays: z.number().int(),
    notificationRetentionDays: z.number().int(),
    timezone: z.string(),
    attachmentMaxBytes: z.number().int(),
    attachmentMaxPerItem: z.number().int(),
    attachmentAllowedExtensions: z.array(z.string()),
  }),
});

export type SettingsChanges = z.infer<typeof patchSettingsBody>["changes"];
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
