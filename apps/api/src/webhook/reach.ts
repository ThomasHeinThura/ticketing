import {
  can,
  type ProjectReachFacts,
  type ResolvedIdentity,
  reaches,
} from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Executor } from "../database/executor";
import {
  personTable,
  projectTable,
  workspaceUserTable,
} from "../database/schema";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";

/**
 * `WH-14`: a webhook delivers only events inside its **owner's** current reach. The owner is the
 * person stamped on `webhook.created_by`; reach is re-evaluated at send time with the same
 * identity, `reaches()` and `can()` the notification send-time check uses, never inherited from
 * whoever edited the webhook last and never from the delivery worker.
 *
 * Outcomes:
 * - `owner_gone`: the owner is deactivated, is no longer a member of the webhook's workspace, or
 *   cannot be resolved as a staff identity. The caller **pauses** the webhook (it must be
 *   re-owned by someone holding `webhook:manage`), it does not retry into a void.
 * - `out_of_reach`: the owner is fine but this event's entity is outside what they may see. The
 *   delivery is recorded `skipped_out_of_reach` (not a failure).
 * - `in_reach`: deliver.
 */
export type OwnerReachDecision =
  | { kind: "in_reach" }
  | { kind: "out_of_reach" }
  | { kind: "owner_gone" };

/**
 * True when the identity sees every project of the workspace without per-project membership:
 * instance admin (`reach.kind === "all"`), or `sees_all` granted on this workspace. Such an owner
 * receives everything (`WH-14`) and, per `WH-15`, creating that webhook needs `instance:admin`.
 */
export function receivesEverything(
  identity: Pick<ResolvedIdentity, "reach" | "memberships">,
  workspaceId: string,
): boolean {
  if (identity.reach.kind === "all") return true;
  if (
    identity.reach.kind === "membership_with_workspaces" &&
    identity.reach.workspaceIds.includes(workspaceId)
  )
    return true;
  return identity.memberships.some(
    (membership) =>
      membership.seesAll &&
      membership.scope === "workspace" &&
      membership.scopeId === workspaceId,
  );
}

export type EventReachSubject = {
  workspaceId: string;
  /** Present for project-scoped events (every `work_item.*`, `sla.*`, ...). */
  projectId: string | null;
  /** True when the event is about a work item (read authority is `work_item:read`). */
  workItemEvent: boolean;
  /** The event kind: `budget.threshold_reached` also needs the owner's `budget:read` and `time_entry:manage_rates` (P5-R1-07). */
  eventKind?: string;
};

export async function decideOwnerReach(
  executor: Executor,
  ownerPersonId: string,
  subject: EventReachSubject,
): Promise<OwnerReachDecision> {
  const [person] = await executor
    .select({
      active: personTable.active,
      userId: personTable.userId,
      side: personTable.side,
    })
    .from(personTable)
    .where(eq(personTable.id, ownerPersonId))
    .limit(1);
  if (!person?.active || !person.userId || person.side !== "staff")
    return { kind: "owner_gone" };

  const identity = await resolveIdentity(
    { userId: person.userId, credential: "session" },
    executor,
  );
  if (
    !identity ||
    identity.personId !== ownerPersonId ||
    identity.side !== "staff"
  )
    return { kind: "owner_gone" };

  // Still a member of this workspace (an instance admin is global and needs no membership row).
  if (identity.reach.kind !== "all") {
    const [membership] = await executor
      .select({ role: workspaceUserTable.role })
      .from(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.userId, person.userId),
          eq(workspaceUserTable.workspaceId, subject.workspaceId),
        ),
      )
      .limit(1);
    if (!membership) return { kind: "owner_gone" };
  }

  if (
    !can(identity, "workspace:read", "workspace", {
      workspaceId: subject.workspaceId,
    })
  )
    return { kind: "out_of_reach" };

  // Every deliverable event is about an entity that lives in a project. One that carries no
  // project cannot be reach-checked, so it is delivered only to an owner who sees everything.
  if (!subject.projectId)
    return receivesEverything(identity, subject.workspaceId)
      ? { kind: "in_reach" }
      : { kind: "out_of_reach" };

  const [project] = await executor
    .select({
      workspaceId: projectTable.workspaceId,
      organisationId: projectTable.organisationId,
    })
    .from(projectTable)
    .where(eq(projectTable.id, subject.projectId))
    .limit(1);
  if (!project || project.workspaceId !== subject.workspaceId)
    return { kind: "out_of_reach" };

  const ancestorProjectIds = await projectAncestryFor(
    executor,
    identity,
    subject.workspaceId,
    subject.projectId,
  );
  const facts: ProjectReachFacts = {
    projectId: subject.projectId,
    workspaceId: subject.workspaceId,
    organisationId: project.organisationId,
    ancestorProjectIds,
    ownerTeamId: await projectOwnerTeamFor(
      executor,
      identity,
      subject.workspaceId,
      subject.projectId,
    ),
  };
  if (!reaches(identity, facts)) return { kind: "out_of_reach" };

  const readable = subject.workItemEvent
    ? can(identity, "work_item:read", "work_item", {
        workspaceId: subject.workspaceId,
        organisationId: project.organisationId ?? undefined,
        workItemProjectId: subject.projectId,
        projectId: subject.projectId,
        ancestorProjectIds,
      })
    : can(identity, "project:read", "project", {
        workspaceId: subject.workspaceId,
        organisationId: project.organisationId ?? undefined,
        projectId: subject.projectId,
        ancestorProjectIds,
      });
  if (!readable) return { kind: "out_of_reach" };
  // A budget figure moves with priced time: only an owner who may see it at this project is sent it.
  if (subject.eventKind === "budget.threshold_reached") {
    const scope = {
      workspaceId: subject.workspaceId,
      organisationId: project.organisationId ?? undefined,
      projectId: subject.projectId,
      ancestorProjectIds,
    };
    if (
      !can(identity, "budget:read", "project", scope) ||
      !can(identity, "time_entry:manage_rates", "project", scope)
    )
      return { kind: "out_of_reach" };
  }
  return { kind: "in_reach" };
}

/**
 * P4R1-H1: whether the webhook's current owner receives everything (`sees_all` or
 * `instance:admin`). An owner who cannot be resolved as active staff is not such an owner.
 */
export async function ownerReceivesEverything(
  executor: Executor,
  ownerPersonId: string,
  workspaceId: string,
): Promise<boolean> {
  const [person] = await executor
    .select({
      active: personTable.active,
      userId: personTable.userId,
      side: personTable.side,
    })
    .from(personTable)
    .where(eq(personTable.id, ownerPersonId))
    .limit(1);
  if (!person?.active || !person.userId || person.side !== "staff")
    return false;
  const identity = await resolveIdentity(
    { userId: person.userId, credential: "session" },
    executor,
  );
  if (!identity || identity.personId !== ownerPersonId) return false;
  return receivesEverything(identity, workspaceId);
}
