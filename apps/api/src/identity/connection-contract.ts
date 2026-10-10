import { z } from "../openapi";

export const connectionConfigVersionSchema = z.number().int().positive().safe();

export const identityClaimMappingSchema = z
  .object({
    version: z.literal(1),
    displayName: z.literal("name"),
  })
  .strict();

export const identityJitPolicySchema = z
  .object({
    enabled: z.boolean(),
    default_role_id: z.string().min(1).max(128).nullable(),
    required_entra_app_role: z.string().min(1).max(256),
  })
  .strict();

const domainBindingSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u);

const scopeListSchema = z
  .array(z.string().min(1).max(256))
  .max(32)
  .refine((items) => new Set(items).size === items.length);

const domainBindingsSchema = z
  .array(domainBindingSchema)
  .max(100)
  .transform((items) => items.map((item) => item.toLowerCase()).sort())
  .refine((items) => new Set(items).size === items.length);

export const identityConnectionCreateRequestSchema = z
  .object({
    portalScope: z.enum(["agent", "customer"]),
    organisationId: z.string().min(1).max(128).nullable(),
    defaultWorkspaceId: z.string().min(1).max(128).nullable(),
    displayName: z.string().trim().min(1).max(128),
    tenantId: z.string().uuid(),
    clientId: z.string().uuid(),
    clientSecret: z.string().min(1).max(16_384),
    scopes: scopeListSchema,
    claimMapping: identityClaimMappingSchema.nullable().optional(),
    domainBindings: domainBindingsSchema,
    jitPolicy: identityJitPolicySchema,
    maxRoleRank: z.number().int().min(0).max(10_000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.portalScope === "customer") {
      if (!value.organisationId)
        context.addIssue({
          code: "custom",
          path: ["organisationId"],
          message: "Customer connections require an organisation",
        });
      if (value.defaultWorkspaceId !== null)
        context.addIssue({
          code: "custom",
          path: ["defaultWorkspaceId"],
          message: "Customer connections cannot select a workspace",
        });
      if (value.maxRoleRank !== null)
        context.addIssue({
          code: "custom",
          path: ["maxRoleRank"],
          message: "Customer connections do not have a role ceiling",
        });
    } else {
      if (value.organisationId !== null)
        context.addIssue({
          code: "custom",
          path: ["organisationId"],
          message: "Agent connections cannot select a customer organisation",
        });
      if (value.maxRoleRank === null)
        context.addIssue({
          code: "custom",
          path: ["maxRoleRank"],
          message: "Agent connections require a role ceiling",
        });
      if (value.jitPolicy.enabled && !value.defaultWorkspaceId)
        context.addIssue({
          code: "custom",
          path: ["defaultWorkspaceId"],
          message: "Enabled agent JIT requires a configured workspace",
        });
    }
  });

export const identityConnectionConfigureRequestSchema = z
  .object({
    configVersion: connectionConfigVersionSchema,
    displayName: z.string().trim().min(1).max(128).optional(),
    clientId: z.string().uuid().optional(),
    clientSecret: z.string().min(1).max(16_384).optional(),
    scopes: scopeListSchema.optional(),
    claimMapping: identityClaimMappingSchema.nullable().optional(),
    domainBindings: domainBindingsSchema.optional(),
    defaultWorkspaceId: z.string().min(1).max(128).nullable().optional(),
    jitPolicy: identityJitPolicySchema.optional(),
    maxRoleRank: z.number().int().min(0).max(10_000).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "configVersion"),
    {
      message: "At least one configuration field is required",
    },
  );

export type IdentityConnectionCreateRequest = z.infer<
  typeof identityConnectionCreateRequestSchema
>;
export type IdentityConnectionConfigureRequest = z.infer<
  typeof identityConnectionConfigureRequestSchema
>;
