export type DeliveryItemKind = "event" | "notification" | "digest" | "webhook";

export type DeliveryItem = {
  id: string;
  kind: DeliveryItemKind;
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

export type RawDeliveryItem = {
  id: string;
  kind: DeliveryItemKind;
  state: string;
  createdAt: Date | string;
  requeueAllowed?: boolean | null;
  eventId?: string | null;
  eventKind?: string | null;
  channel?: string | null;
  attempts?: number | null;
  nextAttemptAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  hasError?: boolean | null;
  digestId?: string | null;
  recipientPersonId?: string | null;
  dedupeKey?: string | null;
  cadence?: string | null;
  children?: number | null;
  source?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  attemptedAt?: Date | string | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Project database rows into the instance delivery inspector's safe shape.
 * Payloads, recipient identities, endpoint details, and raw provider/error bodies are never
 * copied into this response.
 */
export function projectDeliveryItems(
  rows: readonly RawDeliveryItem[],
): DeliveryItem[] {
  return rows.flatMap((row) => {
    const createdAt = iso(row.createdAt);
    if (!createdAt) return [];
    const item: DeliveryItem = {
      id: row.id,
      kind: row.kind,
      state: row.state,
      createdAt,
      requeueAllowed: row.requeueAllowed === true,
    };
    if (row.eventId != null) item.eventId = row.eventId;
    if (row.eventKind != null) item.eventKind = row.eventKind;
    if (row.channel != null) item.channel = row.channel;
    if (row.attempts != null) item.attempts = row.attempts;
    if (row.nextAttemptAt !== undefined)
      item.nextAttemptAt = iso(row.nextAttemptAt);
    if (row.deliveredAt !== undefined) item.deliveredAt = iso(row.deliveredAt);
    if (row.hasError !== undefined) item.errorPresent = Boolean(row.hasError);
    if (row.cadence != null) item.cadence = row.cadence;
    if (row.children != null) item.children = row.children;
    if (row.source != null) item.source = row.source;
    if (row.statusCode !== undefined) item.statusCode = row.statusCode;
    if (row.durationMs !== undefined) item.durationMs = row.durationMs;
    if (row.attemptedAt !== undefined) item.attemptedAt = iso(row.attemptedAt);
    return [item];
  });
}

export type DeliveryCounts = {
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

export function projectDeliveryCounts(
  row: Record<string, unknown>,
): DeliveryCounts {
  const count = (key: string) => {
    const value = Number(row[key] ?? 0);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  return {
    events: { pending: count("eventsPending"), dead: count("eventsDead") },
    notifications: {
      pending: count("notificationsPending"),
      delivered: count("notificationsDelivered"),
      suppressed: count("notificationsSuppressed"),
      dead: count("notificationsDead"),
    },
    digests: {
      collecting: count("digestsCollecting"),
      pending: count("digestsPending"),
      delivered: count("digestsDelivered"),
      suppressed: count("digestsSuppressed"),
      dead: count("digestsDead"),
    },
    webhooks: {
      pending: count("webhooksPending"),
      delivered: count("webhooksDelivered"),
      dead: count("webhooksDead"),
      skippedOutOfReach: count("webhooksSkippedOutOfReach"),
      cancelled: count("webhooksCancelled"),
    },
  };
}
