import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import { canonicalWebhookSecretRotationPayload } from "@taskdesk/domain";
import { webhookSecretField } from "./secret-contract";

export const webhookSecretRotationEntrySchema = z
  .object({
    webhookId: z.string().min(1).max(128),
    expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    secret: webhookSecretField,
  })
  .strict();

/** The caller supplies one distinct replacement secret for each current webhook. */
export const rotateAllWebhookSecretsBody = z
  .object({
    webhooks: z.array(webhookSecretRotationEntrySchema).min(1),
  })
  .strict()
  .superRefine(({ webhooks }, context) => {
    const ids = new Set<string>();
    const secrets = new Set<string>();
    webhooks.forEach((entry, index) => {
      if (ids.has(entry.webhookId)) {
        context.addIssue({
          code: "custom",
          path: ["webhooks", index, "webhookId"],
          message: "Each current webhook must appear exactly once",
        });
      }
      if (secrets.has(entry.secret)) {
        context.addIssue({
          code: "custom",
          path: ["webhooks", index, "secret"],
          message: "Each webhook needs a distinct replacement secret",
        });
      }
      ids.add(entry.webhookId);
      secrets.add(entry.secret);
    });
  });

export type WebhookSecretRotationEntry = z.infer<
  typeof webhookSecretRotationEntrySchema
>;
export type RotateAllWebhookSecretsBody = z.infer<
  typeof rotateAllWebhookSecretsBody
>;

/** Canonical secret-set bytes for PA-15 hashing; callers must never persist or log the result. */
export function canonicalWebhookSecretRotationSet(
  input: RotateAllWebhookSecretsBody,
): string {
  const validated = rotateAllWebhookSecretsBody.parse(input);
  return canonicalWebhookSecretRotationPayload(validated.webhooks);
}

/** Single binding digest implementation shared by the route and PA-15 registration. */
export function webhookSecretRotationSetDigest(
  input: RotateAllWebhookSecretsBody,
): string {
  return createHash("sha256")
    .update(canonicalWebhookSecretRotationSet(input), "utf8")
    .digest("hex");
}

/** Exact current id/version equality prevents partial, stale, or overbroad bulk rotation. */
export function matchesExactWebhookSecretRotationSet(
  replacements: readonly Pick<
    WebhookSecretRotationEntry,
    "webhookId" | "expectedVersion"
  >[],
  current: readonly { id: string; version: number }[],
): boolean {
  if (replacements.length !== current.length) return false;
  const currentById = new Map(
    current.map((entry) => [entry.id, entry.version]),
  );
  if (currentById.size !== current.length) return false;
  return replacements.every(
    (entry) => currentById.get(entry.webhookId) === entry.expectedVersion,
  );
}
