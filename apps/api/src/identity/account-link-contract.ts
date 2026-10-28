import { createHash } from "node:crypto";
import { z } from "../openapi";

export const ACCOUNT_LINK_INTENT_TTL_MS = 5 * 60_000;

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

/** Private server-side OIDC purpose metadata. Never accept this shape from a request body. */
export const accountLinkOidcContextSchema = z
  .object({
    purpose: z.literal("account_link"),
    intentId: opaqueId,
    sourceConnectionId: z.string().min(1).max(128),
    sourceConfigVersion: z.number().int().positive(),
    targetConfigVersion: z.number().int().positive(),
    sessionId: z.string().min(1).max(128),
    userId: z.string().min(1).max(128),
    personId: z.string().min(1).max(128),
  })
  .strict();

export type AccountLinkOidcContext = z.infer<
  typeof accountLinkOidcContextSchema
>;

export const accountLinkIntentSchema = accountLinkOidcContextSchema
  .extend({
    portal: z.enum(["agent", "customer"]),
    organisationId: z.string().nullable(),
    targetConnectionId: z.string().min(1).max(128),
    issuer: z.string().url().max(2048),
    subject: z.string().min(1).max(512),
    accountLabel: z.string().min(1).max(254).nullable(),
    displayName: z.string().min(1).max(200).nullable(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type AccountLinkIntent = z.infer<typeof accountLinkIntentSchema>;

export const accountLinkListResponseSchema = z.object({
  source: z.object({
    connectionId: z.string(),
    displayName: z.string(),
  }),
  targets: z.array(
    z.object({
      connectionId: z.string(),
      displayName: z.string(),
      linked: z.boolean(),
    }),
  ),
});

export const accountLinkIntentResponseSchema = z.object({
  intentId: opaqueId,
  sourceDisplayName: z.string(),
  targetDisplayName: z.string(),
  accountLabel: z.string().nullable(),
  displayName: z.string().nullable(),
  expiresAt: z.string().datetime(),
});

export const accountLinkConfirmedSchema = z.object({
  linked: z.literal(true),
  alreadyLinked: z.boolean(),
});

export function accountLinkIntentIdentifier(intentId: string): string {
  return `identity-link-intent:${createHash("sha256")
    .update(intentId, "utf8")
    .digest("hex")}`;
}
