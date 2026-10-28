import { canonicalWebhookSecretRotationPayload } from "@taskdesk/domain/webhook-secret-rotation";
import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export type WebhookSecurityPostureEntry = {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  ownerPersonId: string;
  ownerName: string | null;
  receivesEverythingBecause: "instance_admin" | "sees_all";
  events: string[];
  active: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  secretRotatedAt: string | null;
};

export type WebhookSecurityPosturePage = {
  data: WebhookSecurityPostureEntry[];
  page: { nextCursor: string | null; hasMore: boolean };
};

export type WebhookRotationTarget = {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  version: number;
};

export type WebhookRotationTargetPage = {
  data: WebhookRotationTarget[];
  page: { nextCursor: string | null; hasMore: boolean };
};

export type WebhookSecretReplacement = {
  webhookId: string;
  expectedVersion: number;
  secret: string;
};

export type WebhookRotationResult = {
  rotatedAt: string;
  rotatedCount: number;
};

export async function listWebhookSecurityPosture(
  input: { limit?: number; cursor?: string } = {},
): Promise<WebhookSecurityPosturePage> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
  if (input.cursor) query.set("cursor", input.cursor);
  const response = await apiFetch(
    getApiUrl(`instance/webhooks/security-posture?${query.toString()}`),
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Webhook security posture request failed",
    );
  return (await response.json()) as WebhookSecurityPosturePage;
}

export async function listWebhookRotationTargets(
  input: { limit?: number; cursor?: string } = {},
): Promise<WebhookRotationTargetPage> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 100) });
  if (input.cursor) query.set("cursor", input.cursor);
  const response = await apiFetch(
    getApiUrl(`instance/webhooks/rotation-targets?${query.toString()}`),
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Webhook rotation target request failed",
    );
  return (await response.json()) as WebhookRotationTargetPage;
}

/** Loads the complete exact-set snapshot; the rotate route rejects any later change. */
export async function listAllWebhookRotationTargets(): Promise<
  WebhookRotationTarget[]
> {
  const result: WebhookRotationTarget[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await listWebhookRotationTargets({ limit: 100, cursor });
    for (const target of page.data) {
      if (seen.has(target.id))
        throw new Error("Webhook rotation target pagination was inconsistent");
      seen.add(target.id);
      result.push(target);
    }
    cursor = page.page.nextCursor ?? undefined;
    if (!page.page.hasMore) cursor = undefined;
  } while (cursor);
  return result;
}

/** Proof binding contains only this digest; cleartext replacements go only to the rotate POST. */
export async function webhookSecretRotationSetDigest(
  webhooks: readonly WebhookSecretReplacement[],
): Promise<string> {
  const canonical = canonicalWebhookSecretRotationPayload(webhooks);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function rotateAllWebhookSecrets(
  webhooks: readonly WebhookSecretReplacement[],
  token: string,
): Promise<WebhookRotationResult> {
  const response = await apiFetch(
    getApiUrl("instance/webhooks/rotate-secrets"),
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-TaskDesk-Step-Up-Token": token,
      },
      body: JSON.stringify({ webhooks }),
    },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Webhook secrets could not be rotated",
    );
  return (await response.json()) as WebhookRotationResult;
}
