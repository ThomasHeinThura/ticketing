import { FEATURE_FLAGS } from "@taskdesk/permissions";
import { z } from "../openapi";

const featureKey = z.enum(FEATURE_FLAGS);

export const featureWorkspaceParam = z.object({
  workspaceId: z.string().min(1).max(128),
});

export const featureProjectParam = z.object({
  projectId: z.string().min(1).max(128),
});

export const resolvedFeaturesQuery = z.object({
  project: z.string().min(1).max(128),
});

const expectedVersion = z.number().int().min(0).safe().optional();

/** Instance level: a flag value and/or its lock. */
export const patchInstanceFeaturesBody = z
  .object({
    changes: z
      .array(
        z
          .object({
            key: featureKey,
            enabled: z.boolean().optional(),
            locked: z.boolean().optional(),
            expectedVersion,
          })
          .strict()
          .refine((c) => c.enabled !== undefined || c.locked !== undefined, {
            message: "enabled or locked is required",
          }),
      )
      .min(1)
      .max(FEATURE_FLAGS.length),
  })
  .strict();

/** Workspace and project levels: `enabled: null` clears the override (inherit). */
export const patchLevelFeaturesBody = z
  .object({
    changes: z
      .array(
        z
          .object({
            key: featureKey,
            enabled: z.boolean().nullable(),
            expectedVersion,
          })
          .strict(),
      )
      .min(1)
      .max(FEATURE_FLAGS.length),
  })
  .strict();

const actorSchema = z
  .object({ id: z.string(), name: z.string().nullable() })
  .nullable();

const baseFeature = {
  key: featureKey,
  /** The value in force at this level after inheritance. */
  enabled: z.boolean(),
  /** Where that value comes from. */
  source: z.enum(["project", "workspace", "instance", "default"]),
  /** The instance flag is locked: lower levels may not override it. */
  locked: z.boolean(),
  defaultEnabled: z.boolean(),
  version: z.number().int().min(0),
  updatedAt: z.string().datetime().nullable(),
  updatedBy: actorSchema,
};

export const instanceFeaturesSchema = z.object({
  features: z.array(z.object(baseFeature)),
});

export const levelFeaturesSchema = z.object({
  features: z.array(
    z.object({
      ...baseFeature,
      /** This level's own override; null when it inherits. */
      override: z.boolean().nullable(),
      /** What this level would inherit if it held no override. */
      inherited: z.object({
        enabled: z.boolean(),
        source: z.enum(["workspace", "instance", "default"]),
      }),
    }),
  ),
});

export const resolvedFeaturesSchema = z.object({
  features: z.array(
    z.object({
      key: featureKey,
      enabled: z.boolean(),
      source: z.enum(["project", "workspace", "instance", "default"]),
      locked: z.boolean(),
    }),
  ),
});

/** Values only: no source, lock, override or version metadata (that is admin data). */
export const workspaceResolvedFeaturesSchema = z.object({
  features: z.array(z.object({ key: featureKey, enabled: z.boolean() })),
});

export const featureConflictSchema = z.object({
  message: z.enum(["feature_locked", "version_conflict"]),
  key: featureKey,
  version: z.number().int().min(0).optional(),
});

export type InstanceFeaturesResponse = z.infer<typeof instanceFeaturesSchema>;
export type LevelFeaturesResponse = z.infer<typeof levelFeaturesSchema>;
