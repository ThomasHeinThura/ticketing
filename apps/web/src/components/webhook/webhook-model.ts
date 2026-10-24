import type {
  Webhook,
  WebhookDelivery,
  WebhookHealth,
} from "@/fetchers/webhook/webhooks";

/**
 * The events a workspace webhook can subscribe to: the W column of the events.md catalogue,
 * grouped for the picker. The API owns the list and refuses anything else, so this only decides
 * how the choices are laid out.
 */
export const WEBHOOK_EVENT_GROUPS: ReadonlyArray<{
  group: "workItems" | "sla" | "approvals" | "intake" | "projects";
  events: readonly string[];
}> = [
  {
    group: "workItems",
    events: [
      "work_item.created",
      "work_item.updated",
      "work_item.transitioned",
      "work_item.assigned",
      "work_item.unassigned",
      "work_item.commented",
      "work_item.escalated",
      "work_item.overdue",
      "work_item.deleted",
      "work_item.unblocked",
    ],
  },
  {
    group: "sla",
    events: ["sla.at_risk", "sla.breached", "sla.met", "sla.missed"],
  },
  {
    group: "approvals",
    events: [
      "approval.requested",
      "approval.decided",
      "approval.expired",
      "approval.withdrawn",
    ],
  },
  {
    group: "intake",
    events: [
      "submission.received",
      "submission.accepted",
      "submission.declined",
      "submission.withdrawn",
    ],
  },
  {
    group: "projects",
    events: [
      "project.created",
      "project.archived",
      "prerequisite.overdue",
      "budget.threshold_reached",
    ],
  },
];

export const ALL_WEBHOOK_EVENTS = WEBHOOK_EVENT_GROUPS.flatMap(
  (entry) => entry.events,
);

/** A random signing secret the owner copies into their receiver (it is never shown again). */
export function generateWebhookSecret(
  random: Pick<Crypto, "getRandomValues"> = crypto,
): string {
  const bytes = random.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `whsec_${encoded}`;
}

export type WebhookFormValues = {
  name: string;
  url: string;
  secret: string;
  events: string[];
};

export type WebhookFormError =
  | "nameRequired"
  | "urlInvalid"
  | "urlNotHttps"
  | "secretTooShort"
  | "eventsRequired";

/**
 * Client-side hints only; the API repeats every check and additionally resolves the
 * destination (private and metadata addresses are refused there, never here).
 */
export function validateWebhookForm(
  values: WebhookFormValues,
  options: { requireSecret: boolean; allowHttp?: boolean },
): WebhookFormError[] {
  const errors: WebhookFormError[] = [];
  if (values.name.trim().length === 0) errors.push("nameRequired");
  try {
    const url = new URL(values.url.trim());
    if (
      url.protocol !== "https:" &&
      !(options.allowHttp && url.protocol === "http:")
    )
      errors.push("urlNotHttps");
  } catch {
    errors.push("urlInvalid");
  }
  if (options.requireSecret && values.secret.length < 24)
    errors.push("secretTooShort");
  if (values.events.length === 0) errors.push("eventsRequired");
  return errors;
}

export function healthVariant(
  health: WebhookHealth,
): "success" | "error" | "warning" | "secondary" | "info" {
  switch (health) {
    case "healthy":
      return "success";
    case "failing":
      return "error";
    case "paused":
      return "warning";
    case "untested":
      return "info";
    default:
      return "secondary";
  }
}

export function deliveryVariant(
  delivery: Pick<WebhookDelivery, "state">,
): "success" | "error" | "warning" | "secondary" | "info" {
  switch (delivery.state) {
    case "delivered":
      return "success";
    case "dead":
      return "error";
    case "pending":
      return "info";
    case "skipped_out_of_reach":
    case "cancelled":
      return "warning";
    default:
      return "secondary";
  }
}

/** A paused webhook whose owner left has to be re-owned before it can be resumed. */
export function needsReown(webhook: Pick<Webhook, "disabledReason">): boolean {
  return webhook.disabledReason === "owner_left";
}

/** Pretty-print a recorded body for inspection; falls back to the raw value. */
export function formatPayload(body: unknown): string {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}
