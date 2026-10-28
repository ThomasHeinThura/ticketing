import { createId } from "@paralleldrive/cuid2";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  personTable,
  projectTable,
  savedViewTable,
  teamMemberTable,
  teamTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { auditIfRegistered, type GovernanceActor } from "./audit";
import { memberRefusal, teamDeletionBlockers } from "./logic";

export type TeamRow = {
  id: string;
  workspaceId: string;
  name: string;
  isCab: boolean;
  capacityDaysPerWeek: number | null;
  memberCount: number;
  createdAt: Date;
};

export type TeamMemberRow = {
  personId: string;
  userId: string;
  name: string | null;
  isLead: boolean;
  allocationPct: number | null;
  active: boolean;
};

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  } | null;
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && (constraint === undefined || name === constraint);
}

function toCapacity(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** Active (not deactivated) member counts per team (TM-8). */
async function activeMemberCounts(
  executor: Executor,
  teamIds: readonly string[],
): Promise<Map<string, number>> {
  if (teamIds.length === 0) return new Map();
  const rows = await executor
    .select({ teamId: teamMemberTable.teamId, value: count() })
    .from(teamMemberTable)
    .innerJoin(personTable, eq(personTable.userId, teamMemberTable.userId))
    .where(
      and(
        inArray(teamMemberTable.teamId, [...teamIds]),
        eq(personTable.active, true),
      ),
    )
    .groupBy(teamMemberTable.teamId);
  return new Map(rows.map((row) => [row.teamId, Number(row.value)]));
}

export async function listTeams(workspaceId: string): Promise<TeamRow[]> {
  const rows = await db
    .select()
    .from(teamTable)
    .where(eq(teamTable.workspaceId, workspaceId))
    .orderBy(asc(teamTable.name), asc(teamTable.id));
  const counts = await activeMemberCounts(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    isCab: row.isCab,
    capacityDaysPerWeek: toCapacity(row.capacityDaysPerWeek),
    memberCount: counts.get(row.id) ?? 0,
    createdAt: row.createdAt,
  }));
}

export async function getTeamWorkspace(id: string) {
  const [row] = await db
    .select({ workspaceId: teamTable.workspaceId })
    .from(teamTable)
    .where(eq(teamTable.id, id))
    .limit(1);
  return row;
}

export async function listMembers(
  executor: Executor,
  teamId: string,
  includeInactive: boolean,
): Promise<TeamMemberRow[]> {
  const rows = await executor
    .select({
      personId: personTable.id,
      userId: teamMemberTable.userId,
      displayName: personTable.displayName,
      userName: userTable.name,
      isLead: teamMemberTable.isLead,
      allocationPct: teamMemberTable.allocationPct,
      active: personTable.active,
    })
    .from(teamMemberTable)
    .innerJoin(userTable, eq(userTable.id, teamMemberTable.userId))
    .innerJoin(personTable, eq(personTable.userId, teamMemberTable.userId))
    .where(eq(teamMemberTable.teamId, teamId))
    .orderBy(asc(userTable.name), asc(personTable.id));
  return rows
    .filter((row) => includeInactive || row.active)
    .map((row) => ({
      personId: row.personId,
      userId: row.userId,
      name: row.displayName ?? row.userName,
      isLead: row.isLead,
      allocationPct: row.allocationPct,
      active: row.active,
    }));
}

export async function getTeam(
  id: string,
  workspaceId: string,
  executor: Executor = db,
) {
  const [row] = await executor
    .select()
    .from(teamTable)
    .where(and(eq(teamTable.id, id), eq(teamTable.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return undefined;
  const counts = await activeMemberCounts(executor, [row.id]);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    isCab: row.isCab,
    capacityDaysPerWeek: toCapacity(row.capacityDaysPerWeek),
    memberCount: counts.get(row.id) ?? 0,
    createdAt: row.createdAt,
  } satisfies TeamRow;
}

/**
 * Staff people who could join this team: active, signed-in members of the workspace not already
 * on it. Offered to roster editors only (TM-2: a customer-side person is never listed).
 */
export async function listCandidates(
  executor: Executor,
  team: { id: string; workspaceId: string },
) {
  const rows = await executor
    .select({
      personId: personTable.id,
      userId: personTable.userId,
      displayName: personTable.displayName,
      userName: userTable.name,
      email: userTable.email,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .innerJoin(personTable, eq(personTable.userId, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, team.workspaceId),
        eq(personTable.side, "staff"),
        eq(personTable.active, true),
      ),
    )
    .orderBy(asc(userTable.name), asc(personTable.id));
  const members = await executor
    .select({ userId: teamMemberTable.userId })
    .from(teamMemberTable)
    .where(eq(teamMemberTable.teamId, team.id));
  const onTeam = new Set(members.map((member) => member.userId));
  return rows
    .filter((row) => row.userId !== null && !onTeam.has(row.userId))
    .map((row) => ({
      personId: row.personId,
      name: row.displayName ?? row.userName,
      email: row.email,
    }));
}

/** The person row for a signed-in user, used for the lead check. */
export async function isLeadOfTeam(
  teamId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMemberTable.id })
    .from(teamMemberTable)
    .innerJoin(personTable, eq(personTable.userId, teamMemberTable.userId))
    .where(
      and(
        eq(teamMemberTable.teamId, teamId),
        eq(teamMemberTable.userId, userId),
        eq(teamMemberTable.isLead, true),
        eq(personTable.active, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Blockers for TM-7: shared views, the CAB flag and owned projects (every row, any state). */
export async function deletionBlockers(
  executor: Executor,
  team: { id: string; workspaceId: string; isCab: boolean },
): Promise<string[]> {
  const [shared] = await executor
    .select({ value: count() })
    .from(savedViewTable)
    .where(
      and(
        eq(savedViewTable.workspaceId, team.workspaceId),
        eq(savedViewTable.sharedWithTeamId, team.id),
      ),
    );
  // Soft-deleted and archived projects count too: the RESTRICT foreign key refuses the row
  // delete for any of them, so refusing here turns a 500 into a clean 409.
  const [owned] = await executor
    .select({ value: count() })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, team.workspaceId),
        eq(projectTable.ownerTeamId, team.id),
      ),
    );
  return teamDeletionBlockers({
    isCab: team.isCab,
    sharedViewCount: Number(shared?.value ?? 0),
    ownedProjectCount: Number(owned?.value ?? 0),
  });
}

export async function createTeam(input: {
  workspaceId: string;
  name: string;
  capacityDaysPerWeek?: number | null;
  isCab?: boolean;
  actor: GovernanceActor;
}) {
  try {
    return await db.transaction(async (tx) => {
      const id = createId();
      const now = new Date();
      await tx.insert(teamTable).values({
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        isCab: input.isCab ?? false,
        capacityDaysPerWeek:
          input.capacityDaysPerWeek === undefined ||
          input.capacityDaysPerWeek === null
            ? null
            : input.capacityDaysPerWeek.toFixed(1),
        createdAt: now,
        updatedAt: now,
      });
      await auditIfRegistered(tx, {
        action: "team.created",
        workspaceId: input.workspaceId,
        entityType: "team",
        entityId: id,
        actor: input.actor,
        after: { name: input.name, isCab: input.isCab ?? false },
      });
      return (await getTeam(id, input.workspaceId, tx)) as TeamRow;
    });
  } catch (error) {
    if (isUniqueViolation(error, "team_workspace_cab_unique"))
      throw new HTTPException(409, {
        message:
          "Another team is already the CAB team. Unset it before designating this one.",
      });
    throw error;
  }
}

export async function updateTeam(
  id: string,
  workspaceId: string,
  input: {
    name?: string;
    capacityDaysPerWeek?: number | null;
    isCab?: boolean;
  },
  actor: GovernanceActor,
) {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(teamTable)
        .where(
          and(eq(teamTable.id, id), eq(teamTable.workspaceId, workspaceId)),
        )
        .for("update");
      if (!before) return undefined;
      await tx
        .update(teamTable)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.capacityDaysPerWeek !== undefined
            ? {
                capacityDaysPerWeek:
                  input.capacityDaysPerWeek === null
                    ? null
                    : input.capacityDaysPerWeek.toFixed(1),
              }
            : {}),
          ...(input.isCab !== undefined ? { isCab: input.isCab } : {}),
          updatedAt: new Date(),
        })
        .where(eq(teamTable.id, id));
      await auditIfRegistered(tx, {
        action: "team.updated",
        workspaceId,
        entityType: "team",
        entityId: id,
        actor,
        before: { name: before.name, isCab: before.isCab },
        after: {
          name: input.name ?? before.name,
          isCab: input.isCab ?? before.isCab,
        },
      });
      return getTeam(id, workspaceId, tx);
    });
  } catch (error) {
    if (isUniqueViolation(error, "team_workspace_cab_unique"))
      throw new HTTPException(409, {
        message:
          "Another team is already the CAB team. Unset it before designating this one.",
      });
    throw error;
  }
}

export async function addMember(
  teamId: string,
  workspaceId: string,
  input: { personId: string; isLead?: boolean; allocationPct?: number | null },
  actor: GovernanceActor,
) {
  try {
    return await db.transaction(async (tx) => {
      const [team] = await tx
        .select({ id: teamTable.id })
        .from(teamTable)
        .where(
          and(eq(teamTable.id, teamId), eq(teamTable.workspaceId, workspaceId)),
        )
        .for("update");
      if (!team) return undefined;
      const [person] = await tx
        .select({
          id: personTable.id,
          side: personTable.side,
          active: personTable.active,
          userId: personTable.userId,
        })
        .from(personTable)
        .where(eq(personTable.id, input.personId))
        .limit(1);
      let isWorkspaceMember = false;
      if (person?.userId) {
        const [member] = await tx
          .select({ id: workspaceUserTable.id })
          .from(workspaceUserTable)
          .where(
            and(
              eq(workspaceUserTable.workspaceId, workspaceId),
              eq(workspaceUserTable.userId, person.userId),
            ),
          )
          .limit(1);
        isWorkspaceMember = member !== undefined;
      }
      const refusal = memberRefusal(person, isWorkspaceMember);
      if (refusal || !person?.userId)
        throw new HTTPException(person ? 400 : 404, {
          message: refusal ?? "Person not found",
        });
      await tx.insert(teamMemberTable).values({
        id: createId(),
        teamId,
        userId: person.userId,
        isLead: input.isLead ?? false,
        allocationPct: input.allocationPct ?? null,
        createdAt: new Date(),
      });
      await auditIfRegistered(tx, {
        action: "team.member_added",
        workspaceId,
        entityType: "team",
        entityId: teamId,
        actor,
        after: { personId: person.id, isLead: input.isLead ?? false },
      });
      return true as const;
    });
  } catch (error) {
    if (isUniqueViolation(error, "team_member_team_user_unique"))
      throw new HTTPException(409, {
        message: "That person is already on this team",
      });
    throw error;
  }
}

async function memberRowForPerson(
  tx: Executor,
  teamId: string,
  personId: string,
) {
  const [row] = await tx
    .select({ id: teamMemberTable.id, userId: teamMemberTable.userId })
    .from(teamMemberTable)
    .innerJoin(personTable, eq(personTable.userId, teamMemberTable.userId))
    .where(
      and(eq(teamMemberTable.teamId, teamId), eq(personTable.id, personId)),
    )
    .limit(1);
  return row;
}

export async function updateMember(
  teamId: string,
  workspaceId: string,
  personId: string,
  input: { isLead?: boolean; allocationPct?: number | null },
  actor: GovernanceActor,
) {
  return db.transaction(async (tx) => {
    const [team] = await tx
      .select({ id: teamTable.id })
      .from(teamTable)
      .where(
        and(eq(teamTable.id, teamId), eq(teamTable.workspaceId, workspaceId)),
      )
      .for("update");
    if (!team) return undefined;
    const member = await memberRowForPerson(tx, teamId, personId);
    if (!member) return undefined;
    await tx
      .update(teamMemberTable)
      .set({
        ...(input.isLead !== undefined ? { isLead: input.isLead } : {}),
        ...(input.allocationPct !== undefined
          ? { allocationPct: input.allocationPct }
          : {}),
      })
      .where(eq(teamMemberTable.id, member.id));
    await auditIfRegistered(tx, {
      action: "team.member_updated",
      workspaceId,
      entityType: "team",
      entityId: teamId,
      actor,
      after: { personId, ...input },
    });
    return true as const;
  });
}

/**
 * TM-6/TM-3: removing a member leaves history alone. The last lead may be removed (the team simply
 * has no lead until one is set).
 */
export async function removeMember(
  teamId: string,
  workspaceId: string,
  personId: string,
  actor: GovernanceActor,
) {
  return db.transaction(async (tx) => {
    const [team] = await tx
      .select({ id: teamTable.id })
      .from(teamTable)
      .where(
        and(eq(teamTable.id, teamId), eq(teamTable.workspaceId, workspaceId)),
      )
      .for("update");
    if (!team) return undefined;
    const member = await memberRowForPerson(tx, teamId, personId);
    if (!member) return undefined;
    await tx.delete(teamMemberTable).where(eq(teamMemberTable.id, member.id));
    await auditIfRegistered(tx, {
      action: "team.member_removed",
      workspaceId,
      entityType: "team",
      entityId: teamId,
      actor,
      before: { personId },
    });
    return true as const;
  });
}

/** The delete the pending action executes (TM-7 blockers are rechecked by the caller). */
export async function deleteTeamRow(
  tx: Executor,
  id: string,
  workspaceId: string,
  actor: GovernanceActor,
) {
  const [row] = await tx
    .delete(teamTable)
    .where(and(eq(teamTable.id, id), eq(teamTable.workspaceId, workspaceId)))
    .returning({ id: teamTable.id, name: teamTable.name });
  if (!row) return false;
  await auditIfRegistered(tx, {
    action: "team.deleted",
    workspaceId,
    entityType: "team",
    entityId: id,
    actor,
    before: { name: row.name },
  });
  return true;
}
