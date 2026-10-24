import { createId } from "@paralleldrive/cuid2";
import { generateReleaseNotes } from "@taskdesk/domain";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  checklistItemTable,
  personTable,
  stateTable,
  stateTemplateTable,
  workItemTable,
  workItemTypeTable,
} from "../database/schema";
import {
  changeDetailTable,
  releaseTable,
  serviceReleaseChecklistItemTable,
  serviceTable,
} from "../database/schema-p5-service";
import { auditIfRegistered, type GovernanceActor } from "../team/audit";
import { VersionConflictError } from "./common";

export type ReleaseRow = typeof releaseTable.$inferSelect;

export async function getReleaseWorkspace(id: string) {
  const [row] = await db
    .select({ workspaceId: releaseTable.workspaceId })
    .from(releaseTable)
    .where(eq(releaseTable.id, id))
    .limit(1);
  return row;
}

export async function listReleases(workspaceId: string, serviceId?: string) {
  const rows = await db
    .select({
      release: releaseTable,
      serviceName: serviceTable.name,
    })
    .from(releaseTable)
    .innerJoin(serviceTable, eq(serviceTable.id, releaseTable.serviceId))
    .where(
      and(
        eq(releaseTable.workspaceId, workspaceId),
        serviceId ? eq(releaseTable.serviceId, serviceId) : undefined,
      ),
    )
    .orderBy(desc(releaseTable.plannedDate), desc(releaseTable.id));
  const ids = rows.map((row) => row.release.id);
  const changeCounts = new Map<string, number>();
  const checklist = new Map<string, { total: number; done: number }>();
  if (ids.length > 0) {
    for (const row of await db
      .select({ releaseId: changeDetailTable.releaseId, value: count() })
      .from(changeDetailTable)
      .where(inArray(changeDetailTable.releaseId, ids))
      .groupBy(changeDetailTable.releaseId))
      if (row.releaseId) changeCounts.set(row.releaseId, row.value);
    for (const item of await db
      .select({
        releaseId: checklistItemTable.releaseId,
        doneAt: checklistItemTable.doneAt,
      })
      .from(checklistItemTable)
      .where(inArray(checklistItemTable.releaseId, ids))) {
      if (!item.releaseId) continue;
      const entry = checklist.get(item.releaseId) ?? { total: 0, done: 0 };
      entry.total += 1;
      if (item.doneAt) entry.done += 1;
      checklist.set(item.releaseId, entry);
    }
  }
  return rows.map((row) => ({
    ...summary(row.release),
    serviceName: row.serviceName,
    changeCount: changeCounts.get(row.release.id) ?? 0,
    checklistTotal: checklist.get(row.release.id)?.total ?? 0,
    checklistDone: checklist.get(row.release.id)?.done ?? 0,
  }));
}

function summary(release: ReleaseRow) {
  return {
    id: release.id,
    workspaceId: release.workspaceId,
    name: release.name,
    serviceId: release.serviceId,
    plannedDate: release.plannedDate,
    status: release.status,
    publishToPortal: release.publishToPortal,
    publishedAt: release.publishedAt,
    version: release.version,
    createdAt: release.createdAt,
  };
}

async function associatedChanges(
  releaseId: string,
  reachableProjectIds: readonly string[],
) {
  const rows = await db
    .select({
      key: workItemTable.key,
      title: workItemTable.title,
      projectId: workItemTable.projectId,
      typeName: workItemTypeTable.name,
      stateName: stateTemplateTable.name,
      risk: changeDetailTable.risk,
      windowStart: changeDetailTable.windowStart,
      windowEnd: changeDetailTable.windowEnd,
    })
    .from(changeDetailTable)
    .innerJoin(
      workItemTable,
      eq(workItemTable.id, changeDetailTable.workItemId),
    )
    .innerJoin(
      workItemTypeTable,
      eq(workItemTypeTable.id, workItemTable.typeId),
    )
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        eq(changeDetailTable.releaseId, releaseId),
        isNull(workItemTable.deletedAt),
      ),
    )
    .orderBy(asc(workItemTable.key));
  const reachable = new Set(reachableProjectIds);
  const visible = rows.filter((row) => reachable.has(row.projectId));
  return {
    visible: visible.map(({ projectId: _projectId, ...rest }) => rest),
    hiddenCount: rows.length - visible.length,
  };
}

export async function getReleaseDetail(
  id: string,
  workspaceId: string,
  reachableProjectIds: readonly string[],
  /** Holder of `release:manage`: sees the stored notes whatever the reach over the changes. */
  canManage: boolean,
) {
  const [row] = await db
    .select({ release: releaseTable, serviceName: serviceTable.name })
    .from(releaseTable)
    .innerJoin(serviceTable, eq(serviceTable.id, releaseTable.serviceId))
    .where(
      and(eq(releaseTable.id, id), eq(releaseTable.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!row) return undefined;
  const [changes, checklist] = await Promise.all([
    associatedChanges(id, reachableProjectIds),
    db
      .select({
        id: checklistItemTable.id,
        text: checklistItemTable.text,
        position: checklistItemTable.position,
        doneAt: checklistItemTable.doneAt,
      })
      .from(checklistItemTable)
      .where(eq(checklistItemTable.releaseId, id))
      .orderBy(asc(checklistItemTable.position)),
  ]);
  // P5-R1-05: stored notes are free text built from (or written about) every change in the
  // release, including ones in projects the author reached and this reader does not. A reader
  // gets them only when they manage releases or their reach covers every change; otherwise the
  // notes are withheld (the reach-filtered change list above is unaffected).
  const notesRedacted = !canManage && changes.hiddenCount > 0;
  return {
    ...summary(row.release),
    serviceName: row.serviceName,
    notes: notesRedacted ? null : row.release.notes,
    notesRedacted,
    notesGeneratedAt: row.release.notesGeneratedAt,
    notesEditedAt: row.release.notesEditedAt,
    notesLocked: row.release.publishedAt !== null,
    changes: changes.visible,
    hiddenChangeCount: changes.hiddenCount,
    checklist: checklist.map((item) => ({
      id: item.id,
      text: item.text,
      position: item.position,
      done: item.doneAt !== null,
    })),
  };
}

/** Resolve change keys to work item ids: live changes of the workspace in projects the caller reaches. */
async function resolveChangeKeys(
  executor: Executor,
  workspaceId: string,
  keys: string[],
  reachableProjectIds: readonly string[],
) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const rows = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      projectId: workItemTable.projectId,
      isChange: workItemTypeTable.isChange,
    })
    .from(workItemTable)
    .innerJoin(
      workItemTypeTable,
      eq(workItemTypeTable.id, workItemTable.typeId),
    )
    .where(
      and(
        eq(workItemTable.workspaceId, workspaceId),
        inArray(workItemTable.key, unique),
        isNull(workItemTable.deletedAt),
      ),
    );
  const reachable = new Set(reachableProjectIds);
  const usable = rows.filter((row) => reachable.has(row.projectId));
  if (usable.length !== unique.length)
    throw new HTTPException(422, { message: "change_not_found" });
  if (usable.some((row) => !row.isChange))
    throw new HTTPException(422, { message: "not_a_change" });
  return usable.map((row) => row.id);
}

async function setReleaseChanges(
  tx: Executor,
  workspaceId: string,
  releaseId: string,
  workItemIds: string[],
  reachableProjectIds: readonly string[],
) {
  // Clear removed associations, then attach the new set (creating the satellite row when needed).
  // A change in a project the caller cannot reach is neither shown nor detached by them.
  const existing =
    reachableProjectIds.length === 0
      ? []
      : await tx
          .select({ id: changeDetailTable.workItemId })
          .from(changeDetailTable)
          .innerJoin(
            workItemTable,
            eq(workItemTable.id, changeDetailTable.workItemId),
          )
          .where(
            and(
              eq(changeDetailTable.releaseId, releaseId),
              inArray(workItemTable.projectId, [...reachableProjectIds]),
            ),
          );
  const keep = new Set(workItemIds);
  const drop = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (drop.length > 0)
    await tx
      .update(changeDetailTable)
      .set({ releaseId: null })
      .where(inArray(changeDetailTable.workItemId, drop));
  for (const workItemId of workItemIds) {
    await tx
      .insert(changeDetailTable)
      .values({ workItemId, workspaceId, releaseId })
      .onConflictDoUpdate({
        target: changeDetailTable.workItemId,
        set: { releaseId },
      });
  }
}

export async function createRelease(input: {
  workspaceId: string;
  name: string;
  serviceId: string;
  plannedDate?: string | null;
  changeKeys?: string[];
  reachableProjectIds: readonly string[];
  actor: GovernanceActor;
}) {
  const id = await db.transaction(async (tx) => {
    const [service] = await tx
      .select({ id: serviceTable.id })
      .from(serviceTable)
      .where(
        and(
          eq(serviceTable.id, input.serviceId),
          eq(serviceTable.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!service)
      throw new HTTPException(422, { message: "service_not_found" });
    const workItemIds = await resolveChangeKeys(
      tx,
      input.workspaceId,
      input.changeKeys ?? [],
      input.reachableProjectIds,
    );
    const id = createId();
    await tx.insert(releaseTable).values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      serviceId: input.serviceId,
      plannedDate: input.plannedDate ?? null,
      createdBy: input.actor.userId,
    });
    // REL-3: the service's checklist definition is instantiated for this release.
    const template = await tx
      .select({
        text: serviceReleaseChecklistItemTable.text,
        position: serviceReleaseChecklistItemTable.position,
      })
      .from(serviceReleaseChecklistItemTable)
      .where(eq(serviceReleaseChecklistItemTable.serviceId, input.serviceId))
      .orderBy(asc(serviceReleaseChecklistItemTable.position));
    if (template.length > 0)
      await tx.insert(checklistItemTable).values(
        template.map((item) => ({
          workspaceId: input.workspaceId,
          releaseId: id,
          position: item.position,
          text: item.text,
        })),
      );
    await setReleaseChanges(
      tx,
      input.workspaceId,
      id,
      workItemIds,
      input.reachableProjectIds,
    );
    await auditIfRegistered(tx, {
      action: "release.created",
      workspaceId: input.workspaceId,
      entityType: "release",
      entityId: id,
      actor: input.actor,
      after: {
        name: input.name,
        serviceId: input.serviceId,
        changeCount: workItemIds.length,
        checklistItems: template.length,
      },
    });
    return id;
  });
  return id;
}

export async function updateRelease(
  id: string,
  workspaceId: string,
  input: {
    name?: string;
    plannedDate?: string | null;
    status?: "planned" | "in_progress" | "released" | "cancelled";
    changeKeys?: string[];
    publishToPortal?: boolean;
    version?: number;
  },
  reachableProjectIds: readonly string[],
  actor: GovernanceActor,
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(releaseTable)
      .where(
        and(eq(releaseTable.id, id), eq(releaseTable.workspaceId, workspaceId)),
      )
      .for("update")
      .limit(1);
    if (!before) return false;
    if (input.version !== undefined && before.version !== input.version)
      throw new VersionConflictError(before.version);
    const status = input.status ?? before.status;
    const publishToPortal = input.publishToPortal ?? before.publishToPortal;
    // REL-5: a release reaches the portal only when switched on AND released.
    const publishedAt =
      publishToPortal && status === "released"
        ? (before.publishedAt ?? new Date())
        : null;
    if (input.changeKeys) {
      const workItemIds = await resolveChangeKeys(
        tx,
        workspaceId,
        input.changeKeys,
        reachableProjectIds,
      );
      await setReleaseChanges(
        tx,
        workspaceId,
        id,
        workItemIds,
        reachableProjectIds,
      );
    }
    await tx
      .update(releaseTable)
      .set({
        name: input.name ?? before.name,
        plannedDate:
          input.plannedDate !== undefined
            ? input.plannedDate
            : before.plannedDate,
        status,
        publishToPortal,
        publishedAt,
        version: before.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(releaseTable.id, id));
    await auditIfRegistered(tx, {
      action:
        publishedAt && !before.publishedAt
          ? "release.published"
          : "release.updated",
      workspaceId,
      entityType: "release",
      entityId: id,
      actor,
      before: {
        name: before.name,
        status: before.status,
        publishToPortal: before.publishToPortal,
      },
      after: {
        changedFields: Object.keys(input).filter((key) => key !== "version"),
        status,
        publishToPortal,
      },
    });
    return true;
  });
}

export async function setReleaseNotes(
  id: string,
  workspaceId: string,
  input: { notes?: string; regenerate?: true },
  reachableProjectIds: readonly string[],
  actor: GovernanceActor,
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(releaseTable)
      .where(
        and(eq(releaseTable.id, id), eq(releaseTable.workspaceId, workspaceId)),
      )
      .for("update")
      .limit(1);
    if (!before) return false;
    if (before.publishedAt)
      throw new HTTPException(409, { message: "notes_locked_after_publish" });
    const now = new Date();
    if (input.regenerate) {
      const changes = await associatedChanges(id, reachableProjectIds);
      const notes = generateReleaseNotes(
        before.name,
        changes.visible.map((change) => ({
          key: change.key,
          title: change.title,
          typeName: change.typeName,
        })),
      );
      await tx
        .update(releaseTable)
        .set({
          notes,
          notesGeneratedAt: now,
          notesEditedAt: null,
          version: before.version + 1,
          updatedAt: now,
        })
        .where(eq(releaseTable.id, id));
    } else {
      await tx
        .update(releaseTable)
        .set({
          notes: input.notes ?? null,
          notesEditedAt: now,
          version: before.version + 1,
          updatedAt: now,
        })
        .where(eq(releaseTable.id, id));
    }
    await auditIfRegistered(tx, {
      action: "release.notes_updated",
      workspaceId,
      entityType: "release",
      entityId: id,
      actor,
      after: { regenerated: input.regenerate === true },
    });
    return true;
  });
}

export async function toggleChecklistItem(
  releaseId: string,
  itemId: string,
  workspaceId: string,
  done: boolean,
  actor: GovernanceActor,
) {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: checklistItemTable.id })
      .from(checklistItemTable)
      .where(
        and(
          eq(checklistItemTable.id, itemId),
          eq(checklistItemTable.releaseId, releaseId),
          eq(checklistItemTable.workspaceId, workspaceId),
        ),
      )
      .for("update")
      .limit(1);
    if (!item) return false;
    let doneBy: string | null = null;
    if (done) {
      const [person] = await tx
        .select({ id: personTable.id })
        .from(personTable)
        .where(eq(personTable.userId, actor.userId))
        .limit(1);
      doneBy = person?.id ?? null;
    }
    await tx
      .update(checklistItemTable)
      .set({ doneAt: done ? new Date() : null, doneBy })
      .where(eq(checklistItemTable.id, itemId));
    await auditIfRegistered(tx, {
      action: "release.checklist_toggled",
      workspaceId,
      entityType: "release",
      entityId: releaseId,
      actor,
      after: { itemId, done },
    });
    return true;
  });
}
