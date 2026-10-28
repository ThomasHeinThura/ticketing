import {
  TERMINOLOGY_LOCALES,
  TERMINOLOGY_TERM_KEYS,
  type TerminologyForms,
  type TerminologyTermKey,
} from "@taskdesk/domain";
import { z } from "../openapi";

export const terminologyTermKeySchema = z.enum(TERMINOLOGY_TERM_KEYS);
export const terminologyAudienceSchema = z.enum(["agent", "customer", "both"]);
export const terminologyScopeSchema = z.enum(["instance", "workspace"]);
export const terminologyLocaleSchema = z.enum(TERMINOLOGY_LOCALES);
export const terminologyFormsSchema = z.record(z.string(), z.string());

export const terminologyOverrideSchema = z.object({
  scope: terminologyScopeSchema,
  workspaceId: z.string().nullable(),
  audience: terminologyAudienceSchema,
  termKey: terminologyTermKeySchema,
  locale: terminologyLocaleSchema,
  forms: terminologyFormsSchema,
});

export const terminologyOverrideListSchema = z.array(terminologyOverrideSchema);

export const terminologyAdminResponseSchema = z.object({
  overrides: terminologyOverrideListSchema,
  etag: z.string(),
});

export const terminologyPublicResponseSchema = z.object({
  locale: terminologyLocaleSchema,
  audience: z.enum(["agent", "customer"]),
  terms: z.record(z.string(), terminologyFormsSchema),
  etag: z.string(),
});

export const terminologyMutationBodySchema = z
  .object({
    expectedEtag: z.string().min(3).max(100),
    override: z.object({
      audience: terminologyAudienceSchema,
      termKey: terminologyTermKeySchema,
      locale: terminologyLocaleSchema,
      forms: terminologyFormsSchema.nullable(),
    }),
  })
  .strict();

export const terminologyWorkspaceParamSchema = z.object({
  workspaceId: z.string().min(1).max(128),
});

export const terminologyRuntimeQuerySchema = z
  .object({ locale: terminologyLocaleSchema })
  .strict();

export const terminologyPublicQuerySchema = z
  .object({
    locale: terminologyLocaleSchema,
  })
  .strict();

export const terminologyPortalQuerySchema = z
  .object({
    locale: terminologyLocaleSchema,
    requestTypeKey: z.string().min(1).max(128).optional(),
    submissionRef: z.string().min(1).max(64).optional(),
    workItemKey: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.requestTypeKey, value.submissionRef, value.workItemKey].filter(
        Boolean,
      ).length <= 1,
    "Choose at most one reachable portal resource",
  );

export const terminologyPreviewBodySchema = z
  .object({
    audience: z.enum(["agent", "customer"]),
    termKey: terminologyTermKeySchema,
    locale: terminologyLocaleSchema,
    forms: terminologyFormsSchema,
  })
  .strict();

export const terminologyPreviewResponseSchema = z.object({
  termKey: terminologyTermKeySchema,
  locale: terminologyLocaleSchema,
  audience: z.enum(["agent", "customer"]),
  examples: z.array(
    z.object({
      category: z.string(),
      count: z.number().nonnegative(),
      label: z.string(),
    }),
  ),
});

export type TerminologyMutationBody = z.infer<
  typeof terminologyMutationBodySchema
>;
export type TerminologyPreviewBody = z.infer<
  typeof terminologyPreviewBodySchema
>;
export type TerminologyFormsInput = TerminologyForms;
export type TerminologyTerm = TerminologyTermKey;
