import { HttpError, readErrorDetail } from "@/lib/http-error";

const PENDING_APPROVAL = /^pending_approval: ([A-Za-z0-9_-]{1,64})$/;

/**
 * Deletion routes answer `202` with a durable pending action; the target is removed only when
 * the requester approves it in the browser. Anything else (including a direct `200`) is never
 * treated as "deleted".
 */
export async function readPendingDeletion(
  response: Response,
  fallback: string,
): Promise<{ pendingActionId: string }> {
  if (response.status !== 202) {
    const detail = await readErrorDetail(response, fallback);
    // A repeated request meets the requester's own pending action for the same target; the
    // API names it as `pending_approval: <id>`, so open that one instead of failing.
    const existing =
      response.status === 409 ? PENDING_APPROVAL.exec(detail)?.[1] : undefined;
    if (existing) return { pendingActionId: existing };
    throw new HttpError(response.status, detail);
  }
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("pendingActionId" in result) ||
    typeof result.pendingActionId !== "string" ||
    !result.pendingActionId
  )
    throw new Error("Missing pending action reference");
  return { pendingActionId: result.pendingActionId };
}
