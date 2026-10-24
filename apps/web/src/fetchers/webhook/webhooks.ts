import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/**
 * Workspace webhooks (`WH-1`..`WH-15`). The workspace travels in `X-Workspace-Id`, as the API
 * contract states; the signing secret is write-only, supplied on create and rotate, never read.
 */

export type WebhookHealth =
  | "healthy"
  | "failing"
  | "paused"
  | "inactive"
  | "untested";

export type Webhook = {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  failingSince: string | null;
  lastError: string | null;
  secretRotatedAt: string | null;
  previousSecretActive: boolean;
  ownerPersonId: string;
  ownerName: string | null;
  health: WebhookHealth;
  lastDeliveryState: string | null;
  lastDeliveryStatusCode: number | null;
  lastDeliveryAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type WebhookDelivery = {
  id: string;
  webhookId: string;
  eventId: string;
  eventKind: string;
  source: "event" | "test" | "redelivery" | "automation";
  redeliveryOf: string | null;
  attempt: number;
  state: string;
  nextAttemptAt: string | null;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
  attemptedAt: string | null;
  createdAt: string;
  requestBody: unknown;
  responseBody: string | null;
  bodyRedacted: boolean;
};

export type WebhookDeliveryPage = {
  data: WebhookDelivery[];
  page: { hasMore: boolean; nextBefore: string | null };
};

export type CreateWebhookInput = {
  name: string;
  url: string;
  secret: string;
  events: string[];
};

export type UpdateWebhookInput = {
  name?: string;
  url?: string;
  events?: string[];
  active?: boolean;
  reown?: true;
  version?: number;
};

async function ensureOk(response: Response, message: string) {
  if (response.ok) return;
  throw new HttpError(
    response.status,
    await readErrorDetail(response, message),
  );
}

/** WH-15: the single-use step-up proof for create, destination change and secret rotation. */
const STEP_UP_HEADER = "X-TaskDesk-Step-Up-Token";

function workspaceHeaders(
  workspaceId: string,
  json = false,
  stepUpToken?: string,
) {
  return {
    "X-Workspace-Id": workspaceId,
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(stepUpToken ? { [STEP_UP_HEADER]: stepUpToken } : {}),
  };
}

export async function listWebhooks(workspaceId: string): Promise<Webhook[]> {
  const response = await apiFetch(getApiUrl("/webhooks"), {
    credentials: "include",
    cache: "no-store",
    headers: workspaceHeaders(workspaceId),
  });
  await ensureOk(response, "Unable to load webhooks");
  return ((await response.json()) as { data: Webhook[] }).data;
}

export async function createWebhook(
  workspaceId: string,
  input: CreateWebhookInput,
  stepUpToken: string,
): Promise<Webhook> {
  const response = await apiFetch(getApiUrl("/webhooks"), {
    method: "POST",
    credentials: "include",
    headers: workspaceHeaders(workspaceId, true, stepUpToken),
    body: JSON.stringify(input),
  });
  await ensureOk(response, "Failed to create the webhook");
  return (await response.json()) as Webhook;
}

export async function updateWebhook(
  id: string,
  input: UpdateWebhookInput,
  stepUpToken?: string,
): Promise<Webhook> {
  const response = await apiFetch(
    getApiUrl(`/webhooks/${encodeURIComponent(id)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(stepUpToken ? { [STEP_UP_HEADER]: stepUpToken } : {}),
      },
      body: JSON.stringify(input),
    },
  );
  await ensureOk(response, "Failed to update the webhook");
  return (await response.json()) as Webhook;
}

export async function rotateWebhookSecret(
  id: string,
  secret: string,
  stepUpToken: string,
): Promise<Webhook> {
  const response = await apiFetch(
    getApiUrl(`/webhooks/${encodeURIComponent(id)}/rotate-secret`),
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        [STEP_UP_HEADER]: stepUpToken,
      },
      body: JSON.stringify({ secret }),
    },
  );
  await ensureOk(response, "Failed to rotate the secret");
  return (await response.json()) as Webhook;
}

export async function sendWebhookTestEvent(
  id: string,
): Promise<WebhookDelivery> {
  const response = await apiFetch(
    getApiUrl(`/webhooks/${encodeURIComponent(id)}/test`),
    { method: "POST", credentials: "include" },
  );
  await ensureOk(response, "Failed to send the test event");
  return (await response.json()) as WebhookDelivery;
}

export async function listWebhookDeliveries(
  id: string,
  options: { before?: string; limit?: number } = {},
): Promise<WebhookDeliveryPage> {
  const query = new URLSearchParams();
  if (options.before) query.set("before", options.before);
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.toString();
  const response = await apiFetch(
    getApiUrl(
      `/webhooks/${encodeURIComponent(id)}/deliveries${suffix ? `?${suffix}` : ""}`,
    ),
    { credentials: "include", cache: "no-store" },
  );
  await ensureOk(response, "Unable to load the delivery history");
  return (await response.json()) as WebhookDeliveryPage;
}

export async function redeliverWebhookDelivery(
  deliveryId: string,
): Promise<WebhookDelivery> {
  const response = await apiFetch(
    getApiUrl(
      `/webhooks/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
    ),
    { method: "POST", credentials: "include" },
  );
  await ensureOk(response, "Failed to redeliver");
  return (await response.json()) as WebhookDelivery;
}

export type WebhookDeletionRequest = {
  pendingActionId: string;
  confirmation: "click" | "typed_name_step_up";
  expiresAt: string;
  approveUrl: string;
};

/**
 * AK-11: deleting a webhook only opens a typed-name + step-up pending action; nothing is
 * deleted until the requester approves it in the browser.
 */
export async function requestWebhookDeletion(
  id: string,
): Promise<WebhookDeletionRequest> {
  const response = await apiFetch(
    getApiUrl(`/webhooks/${encodeURIComponent(id)}`),
    { method: "DELETE", credentials: "include" },
  );
  await ensureOk(response, "Failed to request the deletion");
  return (await response.json()) as WebhookDeletionRequest;
}
