import { z } from "../openapi";
import {
  AUTOMATION_MAX_ACTIONS,
  AUTOMATION_MAX_CONDITIONS,
  DRY_RUN_DEFAULT_WINDOW_DAYS,
  DRY_RUN_MAX_WINDOW_DAYS,
} from "./constants";

/**
 * Request shapes. Conditions and actions are accepted as loose JSON here and validated by
 * `validateRuleDefinition` (`./validation.ts`), which answers with a path-named problem list and
 * distinguishes an invalid shape (400) from a recognised-but-unavailable key (422).
 */
const looseList = (max: number) => z.array(z.unknown()).max(max);

export const automationIdParam = z.object({ id: z.string().min(1).max(128) });
export const workspaceIdParam = z.object({ id: z.string().min(1).max(128) });
export const projectKeyParam = z.object({ key: z.string().min(1).max(128) });

const nameField = z.string().trim().min(1).max(120);

export const createAutomationBody = z.object({
  name: nameField,
  trigger: z.string().min(1).max(64),
  scheduleCron: z.string().max(100).nullable().optional(),
  conditions: looseList(AUTOMATION_MAX_CONDITIONS).default([]),
  actions: looseList(AUTOMATION_MAX_ACTIONS),
  effectiveRoleId: z.string().min(1).max(128),
  stopProcessing: z.boolean().default(false),
  /** Workspace rules only: restrict to these project ids (`AM` scope). */
  projectFilter: z
    .array(z.string().min(1).max(128))
    .max(200)
    .nullable()
    .optional(),
});

export const updateAutomationBody = z
  .object({
    name: nameField.optional(),
    trigger: z.string().min(1).max(64).optional(),
    scheduleCron: z.string().max(100).nullable().optional(),
    conditions: looseList(AUTOMATION_MAX_CONDITIONS).optional(),
    actions: looseList(AUTOMATION_MAX_ACTIONS).optional(),
    effectiveRoleId: z.string().min(1).max(128).optional(),
    stopProcessing: z.boolean().optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    projectFilter: z
      .array(z.string().min(1).max(128))
      .max(200)
      .nullable()
      .optional(),
    version: z.number().int().min(1).optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "version"), {
    message: "At least one field is required",
  });

export const dryRunQuery = z.object({
  windowDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(DRY_RUN_MAX_WINDOW_DAYS)
    .default(DRY_RUN_DEFAULT_WINDOW_DAYS),
});

export const runsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.iso.datetime().optional(),
});

export const toggleBody = z
  .object({ version: z.number().int().min(1).optional() })
  .default({});
