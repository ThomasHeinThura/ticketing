import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, exists, isNull, sql } from "drizzle-orm";
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
  const reachableWorkItem = exists(
    db
      .select({ one: schema.workItemTable.id })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.workItemTable.projectId, schema.projectTable.id),
      )
      .where(
        and(
          eq(schema.workItemTable.key, workItemKey),
          eq(schema.workItemTable.workspaceId, cannedResponseTable.workspaceId),
          eq(schema.projectTable.workspaceId, cannedResponseTable.workspaceId),
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
      ),
  );
  return db
    .select()
    .from(cannedResponseTable)
    .where(reachableWorkItem)
    .orderBy(cannedResponseTable.name);
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
