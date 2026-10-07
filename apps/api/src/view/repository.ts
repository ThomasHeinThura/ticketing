import { and, eq, inArray, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  personTable,
  projectTable,
  savedViewTable,
  teamMemberTable,
  teamTable,
  userPreferenceTable,
} from "../database/schema";

export type SavedViewTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function projectBelongsToWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const [project] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return Boolean(project);
}

export async function teamMemberInWorkspace(
  teamId: string,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [membership] = await db
    .select({ id: teamMemberTable.id })
    .from(teamMemberTable)
    .innerJoin(teamTable, eq(teamMemberTable.teamId, teamTable.id))
    .where(
      and(
        eq(teamMemberTable.teamId, teamId),
        eq(teamMemberTable.userId, userId),
        eq(teamTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

export async function teamMemberInWorkspaceTransaction(
  tx: SavedViewTransaction,
  teamId: string,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [membership] = await tx
    .select({ id: teamMemberTable.id })
    .from(teamMemberTable)
    .innerJoin(teamTable, eq(teamMemberTable.teamId, teamTable.id))
    .where(
      and(
        eq(teamMemberTable.teamId, teamId),
        eq(teamMemberTable.userId, userId),
        eq(teamTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

export async function insertSavedView(
  values: typeof savedViewTable.$inferInsert,
) {
  const [view] = await db.insert(savedViewTable).values(values).returning();
  return view;
}

export async function findSavedViewById(id: string) {
  return db.query.savedViewTable.findFirst({
    where: (view, { eq }) => eq(view.id, id),
  });
}

export async function lockSavedViewByIdInTransaction(
  tx: SavedViewTransaction,
  id: string,
) {
  const [view] = await tx
    .select()
    .from(savedViewTable)
    .where(eq(savedViewTable.id, id))
    .for("update")
    .limit(1);
  return view;
}

export async function listSavedViewsForWorkspace(
  workspaceId: string,
  personId: string,
  userId: string,
) {
  const memberships = await db
    .select({ teamId: teamMemberTable.teamId })
    .from(teamMemberTable)
    .where(eq(teamMemberTable.userId, userId));
  const teamIds = memberships.map(({ teamId }) => teamId);
  const visibleToCaller = or(
    eq(savedViewTable.visibility, "workspace"),
    eq(savedViewTable.createdBy, personId),
    teamIds.length > 0
      ? and(
          eq(savedViewTable.visibility, "team"),
          inArray(savedViewTable.sharedWithTeamId, teamIds),
        )
      : undefined,
  );

  const [views, preference] = await Promise.all([
    db
      .select()
      .from(savedViewTable)
      .where(and(eq(savedViewTable.workspaceId, workspaceId), visibleToCaller)),
    db.query.userPreferenceTable.findFirst({
      where: (row, { and, eq }) =>
        and(
          eq(row.personId, personId),
          eq(row.scope, "workspace"),
          eq(row.scopeId, workspaceId),
          eq(row.key, "pinned_view_ids"),
        ),
    }),
  ]);

  return { views, pinnedValue: preference?.value };
}

export async function listShareableViewTeamsForWorkspace(
  workspaceId: string,
  userId: string,
) {
  return db
    .select({ id: teamTable.id, name: teamTable.name })
    .from(teamMemberTable)
    .innerJoin(teamTable, eq(teamMemberTable.teamId, teamTable.id))
    .where(
      and(
        eq(teamTable.workspaceId, workspaceId),
        eq(teamMemberTable.userId, userId),
      ),
    )
    .orderBy(teamTable.name, teamTable.id);
}

export async function findTeamMembership(teamId: string, userId: string) {
  const [membership] = await db
    .select({ id: teamMemberTable.id })
    .from(teamMemberTable)
    .where(
      and(
        eq(teamMemberTable.teamId, teamId),
        eq(teamMemberTable.userId, userId),
      ),
    )
    .limit(1);
  return membership;
}

export async function findPersonIdByUserId(userId: string) {
  const [person] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
  return person?.id ?? null;
}

export async function updateSavedView(
  tx: SavedViewTransaction,
  id: string,
  values: Partial<typeof savedViewTable.$inferInsert>,
) {
  const [view] = await tx
    .update(savedViewTable)
    .set(values)
    .where(eq(savedViewTable.id, id))
    .returning();
  return view;
}

export async function withSavedViewTransaction<T>(
  work: (tx: SavedViewTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(work);
}

export async function togglePinnedView(
  personId: string,
  workspaceId: string,
  viewId: string,
) {
  return withSavedViewTransaction(async (tx) => {
    // Serialize on the preference identity, including when the row does not yet
    // exist. A row lock alone cannot protect the first insert from a concurrent
    // pin of a different view by the same person.
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`pinned_view_ids:${personId}:${workspaceId}`}, 0)
      )
    `);
    const [view] = await tx
      .select({ id: savedViewTable.id })
      .from(savedViewTable)
      .where(
        and(
          eq(savedViewTable.id, viewId),
          eq(savedViewTable.workspaceId, workspaceId),
        ),
      )
      .for("update")
      .limit(1);
    if (!view)
      throw new HTTPException(404, { message: "Saved view not found" });

    const [existing] = await tx
      .select()
      .from(userPreferenceTable)
      .where(
        and(
          eq(userPreferenceTable.personId, personId),
          eq(userPreferenceTable.scope, "workspace"),
          eq(userPreferenceTable.scopeId, workspaceId),
          eq(userPreferenceTable.key, "pinned_view_ids"),
        ),
      )
      .limit(1);

    const currentIds = Array.isArray(existing?.value)
      ? existing.value.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const wasPinned = currentIds.includes(viewId);
    const pinnedViewIds = wasPinned
      ? currentIds.filter((entry) => entry !== viewId)
      : [...currentIds, viewId];

    if (existing) {
      await tx
        .update(userPreferenceTable)
        .set({ value: pinnedViewIds })
        .where(eq(userPreferenceTable.id, existing.id));
    } else {
      await tx.insert(userPreferenceTable).values({
        personId,
        scope: "workspace",
        scopeId: workspaceId,
        key: "pinned_view_ids",
        value: pinnedViewIds,
      });
    }

    return {
      pinnedViewIds,
      wasPinned,
      isPinned: !wasPinned,
    };
  });
}
