import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Transaction } from "../../database/executor";
import {
  apikeyTable,
  personTable,
  projectTable,
  userTable,
  workspaceTable,
} from "../../database/schema";
import { enqueueOutboxEvent, eventScope } from "../../events/outbox";
import { invalidateNativeAuthorization } from "../../ws";
import {
  hasActiveChildren,
  lockProjectHierarchy,
} from "../hierarchy.repository";

type ArchiveActor = { userId: string; apiKeyId?: string };

async function resolveArchiveEventActor(
  tx: Transaction,
  workspaceId: string,
  actor: ArchiveActor,
) {
  if (actor.apiKeyId) {
    const [apiKey] = await tx
      .select({ id: apikeyTable.id, name: apikeyTable.name })
      .from(apikeyTable)
      .where(
        and(
          eq(apikeyTable.id, actor.apiKeyId),
          eq(apikeyTable.referenceId, actor.userId),
        ),
      )
      .limit(1);
    if (!apiKey)
      throw new Error("Could not resolve project-archive API-key actor");
    return {
      type: "api_key" as const,
      id: apiKey.id,
      name: apiKey.name ?? "API key",
    };
  }

  const [person] = await tx
    .select({ personId: personTable.id, name: userTable.name })
    .from(workspaceTable)
    .innerJoin(userTable, eq(userTable.id, actor.userId))
    .innerJoin(
      personTable,
      and(
        eq(personTable.userId, userTable.id),
        eq(personTable.organisationId, workspaceTable.organisationId),
        eq(personTable.side, "staff"),
      ),
    )
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!person)
    throw new Error("Could not resolve project-archive person actor");
  return { type: "person" as const, id: person.personId, name: person.name };
}

async function archiveProject(
  id: string,
  workspaceId: string,
  actor: ArchiveActor,
) {
  // The hierarchy lock serialises this with re-parenting, so a child cannot be attached
  // between the active-children check below and the archive write. The write stays one
  // conditional UPDATE: its project-row lock serializes with the in-transaction FOR SHARE
  // guard on legacy task writes and with soft deletion.
  const outcome = await db.transaction(async (tx) => {
    await lockProjectHierarchy(tx, workspaceId);

    // Edge-case table ("Parent archived with active children"): refused -- the children
    // must be archived first.
    if (await hasActiveChildren(tx, workspaceId, id)) {
      throw new HTTPException(409, {
        message:
          "project_has_active_children: archive its child projects first",
      });
    }

    const [current] = await tx
      .select()
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, id),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (current.archivedAt) return { project: current, changed: false };

    const [row] = await tx
      .update(projectTable)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(projectTable.id, id),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
          isNull(projectTable.archivedAt),
        ),
      )
      .returning();
    if (!row) return null;

    const eventActor = await resolveArchiveEventActor(tx, workspaceId, actor);
    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "project.archived",
      occurredAt: new Date().toISOString(),
      actor: eventActor,
      scope: eventScope({
        workspaceId,
        organisationId: row.organisationId,
        projectId: row.id,
      }),
      payload: {
        key: row.slug,
        url: `/agent/projects/${encodeURIComponent(row.slug)}`,
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    return { project: row, changed: true };
  });

  if (!outcome) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  if (outcome.changed) await invalidateNativeAuthorization({ projectId: id });

  return outcome.project;
}

export default archiveProject;
