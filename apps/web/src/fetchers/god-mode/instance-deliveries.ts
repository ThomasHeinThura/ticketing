import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export type InstanceDeliveryItem = {
  id: string;
  kind: "event" | "notification" | "digest" | "webhook";
  state: string;
  createdAt: string;
  requeueAllowed: boolean;
  eventId?: string;
  eventKind?: string;
  channel?: string;
  attempts?: number;
  nextAttemptAt?: string | null;
  deliveredAt?: string | null;
  errorPresent?: boolean;
  cadence?: string;
  children?: number;
  source?: string;
  statusCode?: number | null;
  durationMs?: number | null;
  attemptedAt?: string | null;
};

export type InstanceDeliveryCounts = {
  events: { pending: number; dead: number };
  notifications: {
    pending: number;
    delivered: number;
    suppressed: number;
    dead: number;
  };
  digests: {
    collecting: number;
    pending: number;
    delivered: number;
    suppressed: number;
    dead: number;
  };
  webhooks: {
    pending: number;
    delivered: number;
    dead: number;
    skippedOutOfReach: number;
    cancelled: number;
  };
};

export type InstanceDeliveries = {
  checkedAt: string;
  counts: InstanceDeliveryCounts;
  items: InstanceDeliveryItem[];
};

export async function getInstanceDeliveries(): Promise<InstanceDeliveries> {
  const response = await apiFetch(getApiUrl("instance/deliveries"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "Instance deliveries request failed");
  return (await response.json()) as InstanceDeliveries;
}

export async function requeueInstanceDelivery(
  id: string,
): Promise<{ id: string; kind: "event" | "notification"; state: "pending" }> {
  const response = await apiFetch(
    getApiUrl(`instance/deliveries/${encodeURIComponent(id)}/requeue`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok)
    throw new HttpError(response.status, "Instance delivery requeue failed");
  return (await response.json()) as {
    id: string;
    kind: "event" | "notification";
    state: "pending";
  };
}
