import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { PortalActionError } from "@/lib/portal-request";

// The customer request actions of P3 (CP-7, CP-8, CP-9). Each returns the updated portal
// submission projection (the same shape as `GET /api/portal/submissions/{ref}`). The calls use the
// shared first-party fetch rather than the typed client so they do not depend on generated route
// types. Failures are plain text with a stable leading code; `PortalActionError` keeps only the
// code and status, so server text never reaches the screen.

async function post(path: string, body: unknown = {}): Promise<unknown> {
  const response = await apiFetch(getApiUrl(path), {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new PortalActionError(response.status, await response.text());
  return response.json();
}

const submissionPath = (ref: string) =>
  `portal/submissions/${encodeURIComponent(ref)}`;

/** CP-7: escalate only; the API refuses an equal or lower priority. */
export function escalatePortalSubmissionPriority(input: {
  ref: string;
  priority: string;
}) {
  return post(`${submissionPath(input.ref)}/escalate-priority`, {
    priority: input.priority,
  });
}

/** CP-8: reopen a closed or resolved request within the reopen window. */
export function reopenPortalSubmission(ref: string) {
  return post(`${submissionPath(ref)}/reopen`);
}

/** CP-9: a one-to-five rating with an optional comment; changeable within the reopen window. */
export function ratePortalSubmission(input: {
  ref: string;
  rating: number;
  comment?: string;
}) {
  return post(`${submissionPath(input.ref)}/satisfaction`, {
    rating: input.rating,
    ...(input.comment ? { comment: input.comment } : {}),
  });
}
