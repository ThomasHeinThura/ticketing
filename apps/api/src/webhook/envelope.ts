/**
 * The webhook envelope (`feature-contracts-p4.md` "Envelope"): a projection of the internal
 * `events.md` envelope. `causationId`, `depth` and `originAutomationId` are internal and never
 * sent. `data` always carries a `url`, because the first thing a consumer does is build a link.
 */

export type InternalEnvelope = {
  id: string;
  kind: string;
  occurredAt: string;
  actor: { type: string; id: string | null; name: string };
  scope: { workspaceId?: string; projectId?: string; organisationId?: string };
  payload: Record<string, unknown>;
};

export type EnvelopeContext = {
  /** Public base URL of the instance (`TASKDESK_AGENT_URL`); relative links are made absolute. */
  instance: string;
  workItem?: { key: string; title: string } | null;
  project?: { key: string; name: string } | null;
};

export type WebhookBody = {
  id: string;
  event: string;
  occurredAt: string;
  instance: string;
  actor: { id: string | null; name: string } | null;
  data: Record<string, unknown>;
};

export type ProjectionResult =
  | { kind: "deliver"; body: WebhookBody }
  | { kind: "nothing_visible" };

type Change = { field?: unknown; visibility?: unknown } & Record<
  string,
  unknown
>;

/** EV-5 / NO-19: only explicitly classified public changes leave the instance. */
export function visibleChanges(value: unknown): Change[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Change =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof (entry as Change).field === "string" &&
      (entry as Change).visibility === "public",
  );
}

export function absoluteUrl(instance: string, url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return null;
  return `${instance.replace(/\/+$/, "")}${url}`;
}

/** Payload fields that become `workItem` / the top-level `url`, not repeated in the detail bag. */
const LIFTED = new Set(["key", "url", "workItemId", "title"]);

const DETAIL_KEYS: Record<string, string> = {
  sla: "sla",
  approval: "approval",
  submission: "submission",
  prerequisite: "prerequisite",
  budget: "budget",
  project: "project",
};

export function projectWebhookEnvelope(
  envelope: InternalEnvelope,
  context: EnvelopeContext,
): ProjectionResult {
  const family = envelope.kind.split(".")[0] ?? "event";
  const payload = { ...envelope.payload };
  const url = absoluteUrl(context.instance, payload.url);

  if (envelope.kind === "work_item.updated") {
    const changes = visibleChanges(payload.changes);
    if (changes.length === 0) return { kind: "nothing_visible" };
    payload.changes = changes;
  }
  if (envelope.kind === "work_item.transitioned") {
    // NO-19 (P2R1-17): a transition note leaves the instance only when it is public. A payload
    // that names no visibility (an older outbox row) fails closed: the note is dropped.
    if (payload.noteVisibility !== "public") delete payload.note;
  }

  const data: Record<string, unknown> = {};
  const workItemFamily = family === "work_item" || family === "sla";
  if (workItemFamily && typeof payload.key === "string") {
    data.workItem = {
      key: payload.key,
      title: context.workItem?.title ?? null,
      url,
    };
  }
  if (context.project) {
    data.project = { key: context.project.key, name: context.project.name };
  }

  const detail: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(payload)) {
    if (LIFTED.has(name)) continue;
    detail[name] = value;
  }
  const detailKey =
    workItemFamily && family === "work_item"
      ? "details"
      : (DETAIL_KEYS[family] ?? "details");
  if (family === "project") {
    // A project event's own key and name describe the project itself.
    data.project = {
      ...(data.project as object | undefined),
      key: payload.key ?? null,
      ...detail,
    };
  } else {
    data[detailKey] = detail;
  }
  data.url = url ?? context.instance;

  const actor =
    envelope.actor.type === "system"
      ? null
      : { id: envelope.actor.id, name: envelope.actor.name };

  return {
    kind: "deliver",
    body: {
      id: envelope.id,
      event: envelope.kind,
      occurredAt: envelope.occurredAt,
      instance: context.instance,
      actor,
      data,
    },
  };
}

/** The synthetic event a "Send test event" delivers; clearly marked, never a real entity. */
export function buildTestWebhookBody(input: {
  deliveryEventId: string;
  occurredAt: Date;
  instance: string;
  actor: { id: string | null; name: string };
  webhookName: string;
}): WebhookBody {
  return {
    id: input.deliveryEventId,
    event: "webhook.test",
    occurredAt: input.occurredAt.toISOString(),
    instance: input.instance,
    actor: input.actor,
    data: {
      test: true,
      webhook: { name: input.webhookName },
      url: input.instance,
    },
  };
}
