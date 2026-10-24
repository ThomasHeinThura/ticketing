import { z } from "../openapi";

/**
 * Request/response contracts for `/api/me/api-keys` and `/api/workspaces/{id}/api-keys`
 * (feature-contracts-p4.md, "Webhooks and API keys" § API).
 *
 * `capabilities` is the key's explicit subset. Omitted means the read-only default (AK-9);
 * any capability outside the read set is the warned write opt-in. A service-key body has no
 * `isMcp` field: a service key can never be an MCP key (AK-10 / MC-21), and the strict
 * object refuses it rather than ignoring it.
 */
const keyName = z.string().trim().min(3).max(64);
const expiresIn = z
  .number()
  .int()
  .min(60)
  .max(60 * 60 * 24 * 365 * 5)
  .nullable()
  .optional()
  .openapi({ description: "Seconds until expiry; null or omitted for none" });
const ipAllowlist = z
  .array(z.string().trim().min(1).max(64))
  .max(50)
  .optional()
  .openapi({
    description: "Addresses or CIDR ranges; omitted means any address",
  });
const rateLimitPerMinute = z.number().int().min(1).max(10_000).optional();
const capabilities = z.array(z.string().min(1).max(64)).max(100).optional();

export const createPersonalKeyBody = z
  .object({
    name: keyName,
    expiresIn,
    capabilities,
    isMcp: z.boolean().optional().openapi({
      description: 'Set by the "Use with an AI agent" flow (MC-14)',
    }),
    ipAllowlist,
    rateLimitPerMinute,
  })
  .strict();

export const createServiceKeyBody = z
  .object({
    name: keyName,
    expiresIn,
    capabilities: z.array(z.string().min(1).max(64)).min(1).max(100),
    ipAllowlist,
    rateLimitPerMinute,
  })
  .strict();

export const workspaceIdParam = z.object({ id: z.string().min(1) });
export const workspaceKeyParam = z.object({
  id: z.string().min(1),
  keyId: z.string().min(1),
});
export const personalKeyParam = z.object({ id: z.string().min(1) });

export const apiKeySummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  kind: z.enum(["personal", "service"]),
  prefix: z.string().nullable(),
  start: z.string().nullable(),
  enabled: z.boolean(),
  isMcp: z.boolean(),
  capabilities: z.array(z.string()),
  writesEnabled: z.boolean(),
  ipAllowlist: z.array(z.string()).nullable(),
  rateLimitPerMinute: z.number().int().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  lastUsedIp: z.string().nullable(),
  disabledAt: z.string().datetime().nullable(),
  disabledReason: z.string().nullable(),
  workspaceId: z.string().nullable(),
  createdByFormerMember: z.boolean(),
});

export const apiKeyListSchema = z.object({
  apiKeys: z.array(apiKeySummarySchema),
});

export const apiKeyCreatedSchema = apiKeySummarySchema.extend({
  key: z.string().openapi({
    description: "The key itself. Shown once; it cannot be retrieved later.",
  }),
});

export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;
