import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  type Executor,
  executorOrDefault,
  type Transaction,
} from "../database/executor";
import {
  apikeyTable,
  personTable,
  projectTable,
  savedViewTable,
  teamMemberTable,
  teamTable,
  userPreferenceTable,
  userTable,
} from "../database/schema";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";

export type SavedViewTransaction = Transaction;

type MaterializedSavedView<T extends { query: unknown }> = Omit<T, "query"> & {
  query: JsonValue;
};

function materializeSavedViews<T extends { query: unknown }>(
  rows: T[],
): MaterializedSavedView<T>[] {
  return rows.map(
    (row): MaterializedSavedView<T> => ({
      ...row,
      query: row.query as JsonValue,
    }),
  );
}

function materializeSavedView<T extends { query: unknown }>(
  row: T | undefined,
): MaterializedSavedView<T> | undefined {
  return row ? { ...row, query: row.query as JsonValue } : undefined;
}

/** The live project's reach facts when it belongs to the workspace, else null. */
export async function findProjectInWorkspace(
  projectId: string,
  workspaceId: string,
) {
  const [project] = await db
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      organisationId: projectTable.organisationId,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return project ?? null;
}

export async function teamMemberInWorkspace(
  teamId: string,
  userId: string,
  workspaceId: string,
  executor?: Executor,
): Promise<boolean> {
  const [membership] = await executorOrDefault(executor)
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

export type SavedViewEventActor = {
  personId: string;
  userId: string;
  apiKeyId?: string;
};

async function savedViewEventActor(
  tx: SavedViewTransaction,
  actor: SavedViewEventActor,
) {
  if (actor.apiKeyId) {
    const [apiKey] = await tx
      .select({ id: apikeyTable.id, name: apikeyTable.name })
      .from(apikeyTable)
      .where(eq(apikeyTable.id, actor.apiKeyId))
      .limit(1);
    if (!apiKey) throw new Error("Could not resolve saved-view API-key actor");
    return {
      type: "api_key" as const,
      id: apiKey.id,
      name: apiKey.name ?? "API key",
    };
  }

  const [user] = await tx
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, actor.userId))
    .limit(1);
  if (!user) throw new Error("Could not resolve saved-view person actor");
  return { type: "person" as const, id: actor.personId, name: user.name };
}

async function enqueueSavedViewEvent(
  tx: SavedViewTransaction,
  input: {
    actor: SavedViewEventActor;
    kind: "saved_view.created" | "saved_view.updated" | "saved_view.pinned";
    workspaceId: string;
    payload: Record<string, unknown>;
  },
) {
  await enqueueOutboxEvent(tx, {
    id: `evt_${createId()}`,
    kind: input.kind,
    occurredAt: new Date().toISOString(),
    actor: await savedViewEventActor(tx, input.actor),
    scope: eventScope({
      workspaceId: input.workspaceId,
      organisationId: null,
      projectId: null,
    }),
    payload: input.payload,
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
}

export async function insertSavedView(
  values: typeof savedViewTable.$inferInsert,
  actor: SavedViewEventActor,
) {
  return db.transaction(async (tx) => {
    const [view] = await tx.insert(savedViewTable).values(values).returning();
    if (!view) return undefined;
    await enqueueSavedViewEvent(tx, {
      actor,
      kind: "saved_view.created",
      workspaceId: view.workspaceId,
      payload: {
        savedViewId: view.id,
        workspaceId: view.workspaceId,
        visibility: view.visibility,
      },
    });
    return materializeSavedView(view);
  });
}

/** Insert the two immutable-entity saved-view halves of one IQ-19 queue atomically. */
export async function insertSavedViewPairInTransaction(
  tx: SavedViewTransaction,
  values: readonly [
    typeof savedViewTable.$inferInsert,
    typeof savedViewTable.$inferInsert,
  ],
  actor: SavedViewEventActor,
) {
  const inserted: MaterializedSavedView<typeof savedViewTable.$inferSelect>[] =
    [];
  for (const value of values) {
    const [view] = await tx.insert(savedViewTable).values(value).returning();
    if (!view) throw new Error("Failed to create paired saved view");
    await enqueueSavedViewEvent(tx, {
      actor,
      kind: "saved_view.created",
      workspaceId: view.workspaceId,
      payload: {
        savedViewId: view.id,
        workspaceId: view.workspaceId,
        visibility: view.visibility,
      },
    });
    inserted.push(
      materializeSavedView(view) as MaterializedSavedView<
        typeof savedViewTable.$inferSelect
      >,
    );
  }
  return inserted as [
    MaterializedSavedView<typeof savedViewTable.$inferSelect>,
    MaterializedSavedView<typeof savedViewTable.$inferSelect>,
  ];
}

export async function findSavedViewById(id: string) {
  return materializeSavedView(
    await db.query.savedViewTable.findFirst({
      where: (view, { eq }) => eq(view.id, id),
    }),
  );
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
  return materializeSavedView(view);
}

/** Workspace-scoped views always; project-scoped views only for a reachable project. */
export function projectScopeInReach(reachableProjectIds: readonly string[]) {
  return reachableProjectIds.length === 0
    ? ne(savedViewTable.scope, "project")
    : or(
        ne(savedViewTable.scope, "project"),
        inArray(savedViewTable.scopeId, [...reachableProjectIds]),
      );
}

export async function listSavedViewsForWorkspace(
  workspaceId: string,
  personId: string,
  userId: string,
  reachableProjectIds: readonly string[],
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
      .where(
        and(
          eq(savedViewTable.workspaceId, workspaceId),
          visibleToCaller,
          // #740: a project-scoped view names its project (id, and the view's name and query
          // are about it), so it is listed only when that project is within reach.
          projectScopeInReach(reachableProjectIds),
        ),
      ),
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

  return {
    views: materializeSavedViews(views),
    pinnedValue: preference?.value as JsonValue | undefined,
  };
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
  return materializeSavedView(view);
}

export async function enqueueSavedViewUpdatedEvent(
  tx: SavedViewTransaction,
  view: { id: string; workspaceId: string },
  actor: SavedViewEventActor,
) {
  await enqueueSavedViewEvent(tx, {
    actor,
    kind: "saved_view.updated",
    workspaceId: view.workspaceId,
    payload: { savedViewId: view.id, workspaceId: view.workspaceId },
  });
}

type PinnedViewMutationResult = {
  pinnedViewIds: string[];
  wasPinned: boolean;
  isPinned: boolean;
};

export async function withSavedViewTransaction(
  work: (tx: SavedViewTransaction) => Promise<PinnedViewMutationResult>,
): Promise<PinnedViewMutationResult> {
  return db.transaction(work);
}

export async function togglePinnedView(
  personId: string,
  workspaceId: string,
  viewId: string,
  actor: SavedViewEventActor,
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

    await enqueueSavedViewEvent(tx, {
      actor,
      kind: "saved_view.pinned",
      workspaceId,
      payload: {
        savedViewId: viewId,
        workspaceId,
        pinned: !wasPinned,
      },
    });

    return {
      pinnedViewIds,
      wasPinned,
      isPinned: !wasPinned,
    };
  });
}
