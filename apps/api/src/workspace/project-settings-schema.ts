import { z } from "../openapi";

const id = z.string().min(1).max(128);

export const projectSettingsVersionSchema = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647);

export const stateTemplateGroupSchema = z.enum([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
]);

export const workspaceProjectSettingsSchema = z
  .object({
    workspaceId: id,
    defaultSlaPolicyId: id.nullable(),
    defaultServiceCalendarId: id.nullable(),
    enabledStateTemplateIds: z.array(id),
    version: projectSettingsVersionSchema,
  })
  .strict()
  .openapi("WorkspaceProjectSettings");

export const updateWorkspaceProjectSettingsBodySchema = z
  .object({
    expectedVersion: projectSettingsVersionSchema,
    defaultSlaPolicyId: id.nullable().optional(),
    defaultServiceCalendarId: id.nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.defaultSlaPolicyId !== undefined ||
      body.defaultServiceCalendarId !== undefined,
    "At least one setting must be provided",
  );

export const workspaceStateTemplateSchema = z
  .object({
    id,
    key: z.string().min(1).max(80),
    name: z.string().min(1).max(200),
    group: stateTemplateGroupSchema,
    enabled: z.boolean(),
  })
  .strict();

export const workspaceStateTemplateListSchema = z
  .object({
    workspaceId: id,
    version: projectSettingsVersionSchema,
    templates: z.array(workspaceStateTemplateSchema),
  })
  .strict()
  .openapi("WorkspaceStateTemplateList");

export const createWorkspaceStateTemplateBodySchema = z
  .object({
    expectedVersion: projectSettingsVersionSchema,
    key: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9_-]*$/u),
    name: z.string().trim().min(1).max(200),
    group: stateTemplateGroupSchema,
  })
  .strict();

export const updateWorkspaceStateTemplateBodySchema = z
  .object({
    expectedVersion: projectSettingsVersionSchema,
    name: z.string().trim().min(1).max(200).optional(),
    group: stateTemplateGroupSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.name !== undefined ||
      body.group !== undefined ||
      body.enabled !== undefined,
    "At least one state-template change must be provided",
  );

const projectInheritanceModeSchema = z.enum(["inherit", "override"]);

const resolvedSettingSchema = z
  .object({
    mode: projectInheritanceModeSchema,
    overrideId: id.nullable(),
    effectiveId: id.nullable(),
    effectiveName: z.string().nullable(),
    source: z.enum(["project", "workspace", "none"]),
  })
  .strict();

export const projectSettingsInheritanceSchema = z
  .object({
    projectId: id,
    workspaceId: id,
    projectVersion: projectSettingsVersionSchema,
    workspaceVersion: projectSettingsVersionSchema,
    slaPolicy: resolvedSettingSchema,
    serviceCalendar: resolvedSettingSchema,
    states: z
      .object({
        mode: projectInheritanceModeSchema,
        activeTemplateIds: z.array(id),
        workspaceTemplateIds: z.array(id),
      })
      .strict(),
  })
  .strict()
  .openapi("ProjectSettingsInheritance");

const overrideSettingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inherit") }).strict(),
  z.object({ mode: z.literal("override"), id: id.nullable() }).strict(),
]);

export const updateProjectSettingsInheritanceBodySchema = z
  .object({
    expectedProjectVersion: projectSettingsVersionSchema,
    expectedWorkspaceVersion: projectSettingsVersionSchema,
    slaPolicy: overrideSettingSchema.optional(),
    serviceCalendar: overrideSettingSchema.optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.slaPolicy !== undefined || body.serviceCalendar !== undefined,
    "At least one project setting must be provided",
  );

export const inheritProjectStateSetBodySchema = z
  .object({
    expectedProjectVersion: projectSettingsVersionSchema,
    expectedWorkspaceVersion: projectSettingsVersionSchema,
    mode: z.literal("inherit"),
  })
  .strict();

export const stateSetConflictSchema = z
  .object({
    code: z.literal("state_in_use"),
    hasHiddenAffectedItems: z.boolean(),
    affectedItems: z.array(
      z
        .object({
          id,
          key: z.string().min(1).max(128),
          title: z.string().max(500),
          projectId: id,
          projectName: z.string().max(200),
        })
        .strict(),
    ),
  })
  .strict();
