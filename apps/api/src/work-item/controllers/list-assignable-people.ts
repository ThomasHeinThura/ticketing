import { and, count, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
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
 * - anyone else with reach on the project (AS-2) sees exactly one candidate -- themselves
 *   -- because `work_item:update` lets them assign the item to themselves and nobody
 *   else. The screens section: "Where the actor may only assign themselves, the picker
 *   shows a single 'Assign to me' action rather than a disabled list of colleagues";
 * - a caller without either capability (a viewer) sees an empty list, not a tease of
 *   names it could never use.
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
 * `state.state_template_id` (ADR 0011) -- never a state name. The count is the person's
 * load ACROSS projects (it answers "who is already loaded"), not scoped to this project.
 */
export type AssignablePerson = {
  personId: string;
  name: string | null;
  roleName: string;
  openWorkCount: number;
};

export async function listAssignablePeople({
  projectId,
  callerPersonId,
  callerCanAssignAnyone,
}: {
  projectId: string;
  callerPersonId: string | null;
  callerCanAssignAnyone: boolean;
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
      ),
    );

  // One row per person, carrying their most privileged role on this project (lowest
  // `rank`): inherited memberships (PR-3/PR-4) can put more than one row behind one
  // person, and the picker shows a single role.
  const byPerson = new Map<string, { name: string | null; roleName: string }>();
  for (const row of [...rosterRows].sort((a, b) => a.roleRank - b.roleRank)) {
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
    : selfEntry !== undefined && callerPersonId !== null
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
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
        notInArray(stateTemplateTable.group, ["completed", "cancelled"]),
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
