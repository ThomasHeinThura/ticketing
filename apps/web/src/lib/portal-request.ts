/**
 * Customer-facing wording and rules for the portal request screens (CP-5, CP-6, CP-7, CP-10).
 * Pure functions: the screens translate the keys they return, so nothing here discloses an
 * internal term ("work item", "triager", "assignee") or a policy name to a customer.
 */

/** Priorities in escalation order. `no-priority` ranks below `low`; the server owns the real rule. */
export const PORTAL_PRIORITY_ORDER = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type PortalPriority = (typeof PORTAL_PRIORITY_ORDER)[number];

/** CP-7: only strictly higher priorities are offered; a decrease is never shown (the API refuses it too). */
export function higherPriorities(current: string | null | undefined) {
  const index = PORTAL_PRIORITY_ORDER.indexOf(
    (current ?? "no-priority") as PortalPriority,
  );
  if (index < 0) return [] as PortalPriority[];
  return PORTAL_PRIORITY_ORDER.slice(index + 1);
}

const SUBMISSION_STATES = [
  "new",
  "clarifying",
  "accepted",
  "declined",
  "duplicate",
  "withdrawn",
] as const;

/** i18n key (under `portal`) for a submission state in customer language, or null for an unknown state. */
export function submissionStateKey(state: string | null | undefined) {
  return (SUBMISSION_STATES as readonly string[]).includes(state ?? "")
    ? `request.state.${state}`
    : null;
}

/**
 * CP-4: the viewer's own message is "You"; staff are named only when the API names them
 * (`authorName`), otherwise "Our team"; another customer in the organisation is "A colleague".
 * Customer names are never shown or invented.
 */
export function messageAuthor(message: {
  actorType: string;
  authorName?: string | null;
  mine?: boolean;
}): { key: string } | { name: string } {
  if (message.mine) return { key: "request.author.you" };
  // `P2R1-05`: the IQ-15 auto-decline is written by the system, not a person.
  if (message.actorType === "system") return { key: "request.author.system" };
  if (message.actorType === "customer")
    return { key: "request.author.colleague" };
  return message.authorName
    ? { name: message.authorName }
    : { key: "request.author.team" };
}

const CUSTOMER_STATUSES = [
  "received",
  "need_more_info",
  "in_progress",
  "resolved",
  "declined",
  "closed",
  "withdrawn",
] as const;

/**
 * i18n key (under `portal`) for the customer-language status. The server's `customerStatus`
 * wins; without it the submission state maps as before. A raw workflow state name is never used (CP-5).
 */
export function customerStatusKey(
  customerStatus: string | null | undefined,
  submissionState?: string | null,
) {
  if ((CUSTOMER_STATUSES as readonly string[]).includes(customerStatus ?? ""))
    return `request.status.${customerStatus}`;
  return submissionStateKey(submissionState);
}

export type PortalSla = {
  state: "on_track" | "at_risk" | "breached" | "met" | "missed";
  dueAt: string | null;
  /** Which target `dueAt` belongs to; absent means the resolution target. */
  metric?: "first_response" | "resolution";
};

const SLA_STATES = ["on_track", "at_risk", "breached", "met", "missed"];

/** Reads an optional `sla` off an API row, ignoring anything that is not the documented shape. */
export function readPortalSla(value: unknown): PortalSla | null {
  if (!value || typeof value !== "object") return null;
  const { state, dueAt, metric } = value as {
    state?: unknown;
    dueAt?: unknown;
    metric?: unknown;
  };
  if (typeof state !== "string" || !SLA_STATES.includes(state)) return null;
  return {
    state: state as PortalSla["state"],
    dueAt: typeof dueAt === "string" ? dueAt : null,
    metric:
      metric === "first_response" || metric === "resolution"
        ? metric
        : undefined,
  };
}

/** CP-6: "today" / "tomorrow" / a calendar date, with the time of day. */
export function describeDue(
  dueAt: string,
  now: Date,
  locale?: string,
): { day: "today" | "tomorrow" | "date"; date: string; time: string } {
  const due = new Date(dueAt);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(due);
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(due);
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(now)) / 86_400_000);
  return {
    day: days === 0 ? "today" : days === 1 ? "tomorrow" : "date",
    date,
    time,
  };
}

/**
 * Portal action errors are plain text that starts with a stable code (`code` or `code: detail`).
 * The code, never the server text, selects the message the customer reads.
 */
export class PortalActionError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, body: string) {
    super(`portal action failed (${status})`);
    this.name = "PortalActionError";
    this.status = status;
    this.code = parseErrorCode(body);
  }
}

export function parseErrorCode(body: string): string | null {
  const match = /^\s*([a-z][a-z0-9_]{1,63})(?=$|[\s:.,;-])/u.exec(body);
  return match?.[1] ?? null;
}

const KNOWN_ACTION_CODES = [
  "cannot_deescalate",
  "no_change",
  "not_escalatable",
  "not_reopenable",
  "reopen_pending_review",
  "not_rateable",
  "rating_locked",
  "conflict",
] as const;

/** i18n key (under `portal:request.errors`) for a failed action; unknown codes fall back by status. */
export function actionErrorKey(error: unknown): string {
  if (!(error instanceof PortalActionError)) return "generic";
  if (
    error.code &&
    (KNOWN_ACTION_CODES as readonly string[]).includes(error.code)
  )
    return error.code;
  if (error.status === 404) return "notFound";
  if (error.status === 403) return "forbidden";
  if (error.status === 409) return "conflict";
  return "generic";
}
