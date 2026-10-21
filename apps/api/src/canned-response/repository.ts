import { createId } from "@paralleldrive/cuid2";
import { resolveCannedResponseBody } from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, isNull, sql } from "drizzle-orm";
import db, { schema } from "../database";
import {
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";
import { cannedResponseTable } from "../database/schema";

export type CannedResponse = typeof cannedResponseTable.$inferSelect;
export type NewCannedResponse = Pick<
  typeof cannedResponseTable.$inferInsert,
  "workspaceId" | "name" | "body" | "visibilityDefault" | "createdBy"
>;
export type CannedResponseChanges = Partial<
  Pick<
    typeof cannedResponseTable.$inferInsert,
    "name" | "body" | "visibilityDefault"
  >
>;

export async function findCannedResponseWorkspaceId(
  identity: ResolvedIdentity,
  id: string,
): Promise<{ workspaceId: string } | undefined> {
  const [row] = await db
    .select({ workspaceId: cannedResponseTable.workspaceId })
    .from(cannedResponseTable)
    .where(
      and(
        eq(cannedResponseTable.id, id),
        currentWorkspaceReachPredicate(
          identity,
          cannedResponseTable.workspaceId,
        ),
      ),
    )
    .limit(1);
  return row;
}

export async function findCannedResponseWorkItem(
  identity: ResolvedIdentity,
  workItemKey: string,
) {
  const [row] = await db
    .select({
      id: schema.workItemTable.id,
      projectId: schema.workItemTable.projectId,
      workspaceId: schema.workItemTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.workItemTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.workItemTable.key, workItemKey),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
        eq(schema.workItemTable.workspaceId, schema.projectTable.workspaceId),
        currentProjectReachPredicate(
          identity,
          schema.projectTable.id,
          schema.projectTable.workspaceId,
          schema.projectTable.organisationId,
        ),
      ),
    )
    .limit(1);
  return row;
}

export async function listCannedResponsesForWorkItem(
  identity: ResolvedIdentity,
  workItemKey: string,
): Promise<CannedResponse[]> {
  // Context and catalogue share one item-reachable query, so expansion cannot race
  // into another workspace or resolve an arbitrary person supplied by the caller.
  const rows = await db
    .select({
      response: cannedResponseTable,
      key: schema.workItemTable.key,
      dueDate: schema.workItemTable.dueDate,
      requesterName: sql<
        string | null
      >`coalesce(${schema.personTable.displayName}, ${schema.userTable.name})`,
    })
    .from(cannedResponseTable)
    .innerJoin(
      schema.workItemTable,
      and(
        eq(schema.workItemTable.key, workItemKey),
        eq(schema.workItemTable.workspaceId, cannedResponseTable.workspaceId),
      ),
    )
    .innerJoin(
      schema.projectTable,
      and(
        eq(schema.projectTable.id, schema.workItemTable.projectId),
        eq(schema.projectTable.workspaceId, cannedResponseTable.workspaceId),
      ),
    )
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.workItemTable.requesterId),
    )
    .leftJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(
      and(
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
        currentProjectReachPredicate(
          identity,
          schema.projectTable.id,
          schema.projectTable.workspaceId,
          schema.projectTable.organisationId,
        ),
      ),
    )
    .orderBy(cannedResponseTable.name, cannedResponseTable.id);
  return rows.map(({ response, key, dueDate, requesterName }) => ({
    ...response,
    body: resolveCannedResponseBody(response.body, {
      requesterName,
      workItemKey: key,
      dueDate: dueDate?.toISOString().slice(0, 10) ?? null,
    }),
  }));
}

/** Workspace settings listing; the route separately requires manage_settings. */
export async function listCannedResponsesForManagement(
  identity: ResolvedIdentity,
  workspaceId: string,
): Promise<CannedResponse[]> {
  return db
    .select()
    .from(cannedResponseTable)
    .where(
      and(
        eq(cannedResponseTable.workspaceId, workspaceId),
        currentWorkspaceReachPredicate(
          identity,
          cannedResponseTable.workspaceId,
        ),
      ),
    )
    .orderBy(cannedResponseTable.name, cannedResponseTable.id);
}

export async function insertCannedResponse(
  identity: ResolvedIdentity,
  values: NewCannedResponse,
): Promise<CannedResponse | undefined> {
  const reachableWorkspace = db
    .select({
      id: sql<string>`${createId()}`.as("id"),
      workspaceId: schema.workspaceTable.id,
      name: sql<string>`${values.name}`.as("name"),
      body: sql`${JSON.stringify(values.body)}::jsonb`.as("body"),
      visibilityDefault: sql<string>`${values.visibilityDefault}`.as(
        "visibility_default",
      ),
      createdBy: sql<string>`${values.createdBy}`.as("created_by"),
      createdAt: sql<Date>`now()`.as("created_at"),
      updatedAt: sql<Date>`now()`.as("updated_at"),
    })
    .from(schema.workspaceTable)
    .where(
      and(
        eq(schema.workspaceTable.id, values.workspaceId),
        currentWorkspaceReachPredicate(identity, schema.workspaceTable.id),
      ),
    );
  const [created] = await db
    .insert(cannedResponseTable)
    .select(reachableWorkspace)
    .returning();
  return created;
}

export async function updateCannedResponseInWorkspace(
  identity: ResolvedIdentity,
  id: string,
  workspaceId: string,
  changes: CannedResponseChanges,
): Promise<CannedResponse | undefined> {
  const [updated] = await db
    .update(cannedResponseTable)
    .set(changes)
    .where(
      and(
        eq(cannedResponseTable.id, id),
        eq(cannedResponseTable.workspaceId, workspaceId),
        currentWorkspaceReachPredicate(
          identity,
          cannedResponseTable.workspaceId,
        ),
      ),
    )
    .returning();
  return updated;
}

export async function deleteCannedResponseInWorkspace(
  identity: ResolvedIdentity,
  id: string,
  workspaceId: string,
): Promise<CannedResponse | undefined> {
  const [deleted] = await db
    .delete(cannedResponseTable)
    .where(
      and(
        eq(cannedResponseTable.id, id),
        eq(cannedResponseTable.workspaceId, workspaceId),
        currentWorkspaceReachPredicate(
          identity,
          cannedResponseTable.workspaceId,
        ),
      ),
    )
    .returning();
  return deleted;
}
