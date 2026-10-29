import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { projectFeatureEnabled } from "../feature-flag/enforce";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import {
  assertCallerHasCapabilityOrOwner,
  capabilityCredential,
} from "../utils/require-workspace-capability";
import { findTimeEntryOwnerFacts } from "./repository";

/** A legacy entry belongs to a person; a workspace service key has no person to log time for. */
export async function mutationIdentity(c: Context): Promise<ResolvedIdentity> {
  const apiKey = c.get("apiKey");
  if (apiKey?.service) throw new HTTPException(403, { message: "Forbidden" });
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const identity = await resolveRequestIdentity({
    userId: c.get("userId") as string,
    apiKey,
    impersonatedBy: session?.impersonatedBy,
  });
  if (identity?.side !== "staff" || identity.portal !== "agent")
    throw new HTTPException(403, { message: "Forbidden" });
  return identity;
}

export async function requireMutationIdentity(c: Context, next: Next) {
  await mutationIdentity(c);
  await next();
}

/** Resolve the owner from legacy user_id -> person.user_id, never from the request body. */
export async function legacyEntryOwner(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing time entry id" });
  const row = await findTimeEntryOwnerFacts(id);
  if (
    !row ||
    row.workspaceId !== c.get("workspaceId") ||
    row.projectId !== c.get("projectId")
  )
    throw new HTTPException(404, { message: "Time entry not found" });
  c.set("policyRowFacts", { personId: row.ownerPersonId });
  c.set("timeEntryOwnerPersonId", row.ownerPersonId);
  await next();
}

/** Same canonical own/any split as the P5 time-entry route, including API-key scope. */
export async function requireLegacyEntryCapability(c: Context, next: Next) {
  const identity = await mutationIdentity(c);
  await assertCallerHasCapabilityOrOwner(
    c.get("workspaceId") as string,
    identity.userId,
    "time_entry:update_any",
    "time_entry:update_own",
    c.get("timeEntryOwnerPersonId") === identity.personId,
    capabilityCredential(c.get("apiKey")),
  );
  await next();
}

/** Admission check; each write repeats the project-scoped flag read inside its transaction. */
export async function requireLegacyTimeTracking(c: Context, next: Next) {
  const projectId = c.get("projectId") as string | undefined;
  if (
    !projectId ||
    !(await projectFeatureEnabled("feature.time_tracking", projectId))
  )
    throw new HTTPException(409, { message: "feature_disabled" });
  await next();
}
