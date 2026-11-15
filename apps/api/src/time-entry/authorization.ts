import {
  type Capability,
  can,
  type ResolvedIdentity,
} from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import { projectFeatureEnabled } from "../feature-flag/enforce";
import { resolveIdentity } from "../permissions/resolve-identity";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { projectAncestryFor } from "../utils/project-ancestry";
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

/**
 * Project-scoped own/any decision for a legacy entry: the caller's project role overrides the
 * workspace role, and an API key stays clamped to its stored subset (`keyCapabilities`).
 * Authority and ancestry are re-read from `executor`, so a call inside the write transaction
 * sees role changes committed while it waited on the task lock.
 */
export async function assertLegacyEntryAuthority(
  executor: Executor,
  identity: ResolvedIdentity,
  facts: { workspaceId: string; projectId: string; workItemId: string },
  capability: Capability,
  owner?: {
    capability: Capability;
    isOwner: (fresh: ResolvedIdentity) => boolean;
  },
): Promise<void> {
  const fresh = await resolveIdentity(
    {
      userId: identity.userId,
      credential: identity.credential,
      ...(identity.keyCapabilities !== undefined && {
        apiKey: {
          enabled: true,
          ownerUserId: identity.userId,
          capabilities: identity.keyCapabilities,
        },
      }),
    },
    executor,
  );
  if (fresh?.side !== "staff" || fresh.portal !== "agent")
    throw new HTTPException(403, { message: "Insufficient permissions" });
  const target = {
    projectId: facts.projectId,
    workItemProjectId: facts.projectId,
    workItemId: facts.workItemId,
    workspaceId: facts.workspaceId,
    ancestorProjectIds: await projectAncestryFor(
      executor,
      fresh,
      facts.workspaceId,
      facts.projectId,
    ),
  };
  if (can(fresh, capability, "work_item", target)) return;
  if (
    owner?.isOwner(fresh) === true &&
    can(fresh, owner.capability, "work_item", target)
  )
    return;
  throw new HTTPException(403, { message: "Insufficient permissions" });
}

/** Same canonical own/any split as the P5 time-entry route, decided at the entry's project. */
export async function requireLegacyEntryCapability(c: Context, next: Next) {
  const identity = await mutationIdentity(c);
  await assertLegacyEntryAuthority(
    db,
    identity,
    {
      workspaceId: c.get("workspaceId") as string,
      projectId: c.get("projectId") as string,
      workItemId: c.get("workItemId") as string,
    },
    "time_entry:update_any",
    {
      capability: "time_entry:update_own",
      isOwner: (fresh) => c.get("timeEntryOwnerPersonId") === fresh.personId,
    },
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
