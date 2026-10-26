/**
 * `NO-6`: a digest is one bounded, deterministic summary message, not a wall of forwarded
 * notifications. It carries only finite event-kind counts and a link to the authenticated
 * inbox; no titles, bodies, names or resource ids. A kind with no customer-safe label falls
 * into "other updates" rather than leaking its internal key.
 */
export const DIGEST_INBOX_URL = "/agent/inbox";

const KIND_LABELS: Readonly<Record<string, string>> = {
  "work_item.assigned": "assignments",
  "work_item.unassigned": "unassignments",
  "work_item.commented": "new comments",
  "work_item.mentioned": "mentions",
  "work_item.transitioned": "status changes",
  "work_item.due_soon": "items due soon",
  "work_item.overdue": "overdue items",
  "work_item.unblocked": "items unblocked",
  "work_item.escalated": "escalations",
  "sla.at_risk": "SLA risks",
  "sla.breached": "SLA breaches",
  "approval.requested": "approval requests",
  "approval.decided": "approval decisions",
  "approval.expiring": "approvals expiring",
  "approval.expired": "approvals expired",
  "approval.withdrawn": "approvals withdrawn",
  "submission.received": "new requests",
  "submission.replied": "request replies",
};

/** At most this many distinct lines; the remainder is folded into one. */
export const DIGEST_MAX_LINES = 10;

export type DigestSummary = { title: string; body: string; url: string };

export function buildDigestSummary(
  cadence: "hourly" | "daily",
  eventKinds: readonly string[],
  inboxUrl = DIGEST_INBOX_URL,
): DigestSummary {
  const counts = new Map<string, number>();
  for (const kind of eventKinds) {
    const label = KIND_LABELS[kind] ?? "other updates";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const lines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(
      ([label, count]) =>
        `${label[0]?.toUpperCase()}${label.slice(1)}: ${count}`,
    );
  const shown = lines.slice(0, DIGEST_MAX_LINES);
  if (lines.length > shown.length)
    shown.push(`More kinds of update: ${lines.length - shown.length}`);
  const total = eventKinds.length;
  return {
    title:
      cadence === "hourly"
        ? `Your hourly summary: ${total} ${total === 1 ? "update" : "updates"}`
        : `Your daily summary: ${total} ${total === 1 ? "update" : "updates"}`,
    body: shown.join("\n"),
    url: inboxUrl,
  };
}

/** Customer copy contains counts only and points to the authenticated portal request list. */
export function buildCustomerDigestSummary(
  cadence: "hourly" | "daily",
  eventKinds: readonly string[],
  requestTerms: { singular: string; plural: string } = {
    singular: "request",
    plural: "requests",
  },
): DigestSummary {
  const requestTermLower = requestTerms.singular.toLocaleLowerCase();
  const requestTermPluralLower = requestTerms.plural.toLocaleLowerCase();
  // Keep grouping semantic. A rendered request label depends on runtime terminology, so
  // grouping by the final text can split equivalent event kinds ("Request updates" vs
  // "Requests updates") when the selected term has different singular/plural forms.
  const counts = new Map<string, number>();
  const labels: Readonly<Record<string, string>> = {
    comments: "new comments",
    mentions: "mentions",
    request_updates: `${requestTermLower} updates`,
    approval_requests: `approval ${requestTermPluralLower}`,
    approval_updates: "approval updates",
    approvals_expiring: "approvals expiring",
  };
  for (const kind of eventKinds) {
    const group =
      kind === "work_item.commented"
        ? "comments"
        : kind === "work_item.mentioned"
          ? "mentions"
          : kind === "work_item.transitioned"
            ? "request_updates"
            : kind === "approval.requested"
              ? "approval_requests"
              : kind === "approval.decided" ||
                  kind === "approval.expired" ||
                  kind === "approval.withdrawn"
                ? "approval_updates"
                : kind === "approval.expiring"
                  ? "approvals_expiring"
                  : "request_updates";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const lines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, DIGEST_MAX_LINES)
    .map(([group, count]) => {
      const label = labels[group] ?? `${requestTermLower} updates`;
      return `${label[0]?.toUpperCase()}${label.slice(1)}: ${count}`;
    });
  const total = eventKinds.length;
  return {
    title:
      cadence === "hourly"
        ? `Your hourly ${requestTermLower} summary: ${total} ${total === 1 ? "update" : "updates"}`
        : `Your daily ${requestTermLower} summary: ${total} ${total === 1 ? "update" : "updates"}`,
    body: lines.join("\n"),
    url: "/requests",
  };
}
