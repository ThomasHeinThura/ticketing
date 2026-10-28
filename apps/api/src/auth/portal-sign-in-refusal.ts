import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import { userHasLinkedData } from "./repository";

/**
 * Addresses whose user row this request is inserting (recorded by the user-create hook, which only
 * runs when no row existed, and read by the sign-in after-hook of the same request). A portal sign-in
 * after-hook may remove a user row only when this request created it: an existing account that
 * merely reached the portal door (staff, instance admin, deactivated customer, customer whose
 * organisation lost portal access) only ever has its new session revoked. Anything that cannot be
 * tied to a request object is treated as "not created here", the safe default.
 */
const createdByRequest = new WeakMap<object, Set<string>>();

const addressKey = (email: string) => email.trim().toLowerCase();

type RequestScope = { request?: Request | undefined } | null | undefined;

function requestKey(ctx: RequestScope): object | null {
  const request = ctx?.request;
  return request && typeof request === "object" ? request : null;
}

export function markUserCreatedInRequest(ctx: RequestScope, email: string) {
  const key = requestKey(ctx);
  if (!key) return;
  const ids = createdByRequest.get(key) ?? new Set<string>();
  ids.add(addressKey(email));
  createdByRequest.set(key, ids);
}

export function wasUserCreatedInRequest(ctx: RequestScope, email: string) {
  const key = requestKey(ctx);
  return key
    ? (createdByRequest.get(key)?.has(addressKey(email)) ?? false)
    : false;
}

/** The row may be removed only while nothing else hangs off it (person link, API keys). */
export async function userRowIsDisposable(userId: string): Promise<boolean> {
  return !(await userHasLinkedData(userId));
}

/** Reason code and entity id only; never the address. A failed audit write never blocks the refusal. */
export async function auditPortalSignInRefusal(
  userId: string,
  reason: string,
): Promise<void> {
  try {
    await appendAuditLog(db, {
      actorId: null,
      actorType: "system",
      workspaceId: null,
      action: "permission.denied",
      entityType: "person",
      entityId: userId,
      before: null,
      after: { scope: "portal_sign_in", reason },
    });
  } catch {
    // The refusal already stands.
  }
}
