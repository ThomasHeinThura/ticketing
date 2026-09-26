import { CLOSED_STATE_GROUPS } from "@taskdesk/domain";
import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
} from "drizzle-orm";
import db from "../../database";
import {
  membershipTable,
  personTable,
  roleTable,
  stateTable,
  stateTemplateTable,
  userTable,
  workItemTable,
} from "../../database/schema";

/**
 * `GET /api/projects/{projectId}/assignable` (`docs/03-features/assignment.md` § API) --
 * the person-picker feed.
 *
 * Returns the project's roster with each person's current open-work count, **filtered to
 * the people the ACTOR may actually assign to** (the spec's own sentence: "The client
 * never filters this itself"):
 *
 * - an actor holding `work_item:assign` (AS-1) sees the whole active roster;
 * - an actor holding `work_item:update` but NOT `work_item:assign` (AS-2) sees exactly
 *   one candidate -- themselves -- because that capability lets them assign the item to
 *   themselves and nobody else. The screens section: "Where the actor may only assign
 *   themselves, the picker shows a single 'Assign to me' action rather than a disabled
 *   list of colleagues";
 * - anyone else (a viewer: `work_item:read` alone) sees an empty list, not a tease of
 *   names it could never use. The filter keys on the CAPABILITY, never on "the caller
 *   happens to have a person row" -- the ordinary review of PR #362 (F2) proved that
 *   distinction with a rostered viewer who was shown themselves.
 *
 * The roster predicate (`membership(scope = 'project', scope_id = project)` + an active
 * person) is intentionally the SAME shape `assign-work-item.ts` enforces on the write, so
 * the picker and the write cannot disagree about who is assignable. The Opus review of
 * PR #353 (S3) asks for exactly that; #359 tracks factoring the pair into one helper
 * (the write route lives on an unmerged branch, so the shared extraction lands when they
 * meet).
 *
 * Open work: `AS-...` -- "Open means the assigned work item's mapped
 * `state_template.group not in ('completed', 'cancelled')`", resolved through
 * `state.state_template_id` (ADR 0011) -- never a state name. The count answers "who is
 * already loaded"; it is scoped to the PROJECT'S WORKSPACE, never the whole instance --
 * the Opus review of PR #362 (L1) measured that an unscoped count leaks activity in
 * workspaces the caller cannot read, one number at a time. The same review's L2 ask is
 * also applied below: the aggregate is restricted to the people actually being shown,
 * so a picker open does not scan the instance's whole assigned backlog.
 *
 * The roster predicate additionally pins `person.side = 'staff'` and
 * `is_placeholder = false` (the same review's L3): `data-model.md` says a placeholder
 * "can never be assigned or hold a membership" and customer people hold only
 * organisation-scoped memberships, but the database enforces neither, so the query
 * states both rules rather than trusting that no writer has ever broken them.
 */
export type AssignablePerson = {
  personId: string;
  name: string | null;
  roleName: string;
  openWorkCount: number;
};

export async function listAssignablePeople({
  projectId,
  workspaceId,
  callerPersonId,
  callerCanAssignAnyone,
  callerCanSelfAssign,
}: {
  projectId: string;
  /**
   * The project's OWN workspace, already resolved by the route middleware. The load
   * count is bounded to it (review L1): workspaces are not the security boundary
   * (`multi-tenancy.md`), but a count that ranges over every workspace in the instance
   * still reports activity inside ones the caller cannot read.
   */
  workspaceId: string;
  callerPersonId: string | null;
  callerCanAssignAnyone: boolean;
  callerCanSelfAssign: boolean;
}): Promise<AssignablePerson[]> {
  const rosterRows = await db
    .select({
      personId: membershipTable.personId,
      roleName: roleTable.name,
      roleRank: roleTable.rank,
      name: userTable.name,
    })
    .from(membershipTable)
    .innerJoin(personTable, eq(personTable.id, membershipTable.personId))
    .innerJoin(roleTable, eq(roleTable.id, membershipTable.roleId))
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(
      and(
        eq(membershipTable.scope, "project"),
        eq(membershipTable.scopeId, projectId),
        eq(personTable.active, true),
        // Review L3: the two rules `data-model.md` states but no constraint enforces --
        // a placeholder can never be assigned, and customer-side people hold only
        // organisation-scoped memberships. Stated here so a future writer that breaks
        // either rule cannot leak such a person into the picker.
        eq(personTable.side, "staff"),
        eq(personTable.isPlaceholder, false),
      ),
    );

  // One row per person, carrying their most privileged role on this project. `rank` is
  // "higher wins" (roles.ts/rbac.md: "You cannot edit or mint a role whose rank is >=
  // your own") -- the ordinary review of PR #362 (F1) caught this sorted the wrong way.
  // Inherited memberships (PR-3/PR-4) can put more than one row behind one person, and
  // the picker shows a single role: the strongest one.
  const byPerson = new Map<string, { name: string | null; roleName: string }>();
  for (const row of [...rosterRows].sort((a, b) => b.roleRank - a.roleRank)) {
    if (!byPerson.has(row.personId)) {
      byPerson.set(row.personId, {
        name: row.name ?? null,
        roleName: row.roleName,
      });
    }
  }

  const selfEntry =
    callerPersonId !== null ? byPerson.get(callerPersonId) : undefined;
  const allowed = callerCanAssignAnyone
    ? byPerson
    : callerCanSelfAssign && selfEntry !== undefined && callerPersonId !== null
      ? new Map([[callerPersonId, selfEntry]])
      : new Map<string, { name: string | null; roleName: string }>();

  if (allowed.size === 0) {
    return [];
  }

  const loadRows = await db
    .select({ assigneeId: workItemTable.assigneeId, open: count() })
    .from(workItemTable)
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        isNotNull(workItemTable.assigneeId),
        // Review L2: restrict the aggregate to the people this response can actually
        // name. Without this the query groups the instance's whole assigned backlog and
        // discards all but a handful -- cheap load amplification for anyone who can
        // open the picker.
        inArray(workItemTable.assigneeId, [...allowed.keys()]),
        // Review L1: the count is "who is already loaded" WITHIN this workspace, never
        // across every workspace the person works in.
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
        // The closed-group vocabulary's single source (`isClosedGroup`'s own set): the
        // SQL cannot call the pure predicate, so it names the same list -- never a
        // second, drifting idea of "closed".
        notInArray(stateTemplateTable.group, [...CLOSED_STATE_GROUPS]),
      ),
    )
    .groupBy(workItemTable.assigneeId);

  const loadByPerson = new Map(
    loadRows.map((row) => [row.assigneeId as string, Number(row.open)]),
  );

  return [...allowed.entries()]
    .map(([personId, entry]) => ({
      personId,
      name: entry.name,
      roleName: entry.roleName,
      openWorkCount: loadByPerson.get(personId) ?? 0,
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export default listAssignablePeople;
