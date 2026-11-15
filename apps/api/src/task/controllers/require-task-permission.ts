import type { Context, Next } from "hono";
import { resolveCallerIdentity } from "../../utils/has-project-reach";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { requireWorkspacePermission } from "../../utils/require-workspace-permission";
import { findTaskAssigneeId } from "../repository";

// Route middleware runs before the validators, so c.req.valid() is unavailable.
async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

export async function requireTaskAssigneePermission(c: Context, next: Next) {
  const id = c.req.param("id");
  // #281 sweep: this id reaches a raw `eq(taskTable.id, ...)` query below,
  // unvalidated -- a NUL byte would otherwise 500 instead of a clean 400.
  if (id) {
    rejectNulByte(id, "Task id");
  }
  const { userId: requestedUserId } = await readJsonBody(c);
  const nextAssignee =
    typeof requestedUserId === "string" ? requestedUserId : null;

  const userId = c.get("userId");
  const identity = userId ? await resolveCallerIdentity(c, userId) : null;
  const existingTask = identity
    ? await findTaskAssigneeId(identity, id ?? "")
    : undefined;

  if (existingTask && existingTask.userId !== nextAssignee) {
    return requireWorkspacePermission({ work_item: ["assign"] })(c, next);
  }

  return next();
}
