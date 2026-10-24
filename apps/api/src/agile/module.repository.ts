import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  personTable,
  userTable,
  workItemTable,
  workspaceUserTable,
} from "../database/schema";
import { moduleTable } from "../database/schema-p5-agile";
import type { AgileActor } from "./audit";
import { auditAgile } from "./audit";
import { VersionConflictError } from "./estimate.repository";
import {
  type ItemFact,
  itemsByKeys,
  loadItemFacts,
} from "./item-facts.repository";
import {
  forecastModule,
  type ModuleForecast,
  type ModuleState,
  toDateString,
  todayUtc,
} from "./logic";

export type ModuleRow = typeof moduleTable.$inferSelect;
type ProjectRef = { workspaceId: string; projectId: string };

export class ModuleRuleError extends HTTPException {
  constructor(status: 409 | 422, message: string) {
    super(status, { message });
  }
}

export async function getModule(executor: Executor, id: string) {
  const [row] = await executor
    .select()
    .from(moduleTable)
    .where(eq(moduleTable.id, id))
    .limit(1);
  return row;
}

/** Staff of the workspace who could lead a module. */
export async function leadCandidates(executor: Executor, workspaceId: string) {
  const rows = await executor
    .select({
      id: personTable.id,
      displayName: personTable.displayName,
      userName: userTable.name,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .innerJoin(personTable, eq(personTable.userId, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(personTable.side, "staff"),
        eq(personTable.active, true),
      ),
    )
    .orderBy(asc(userTable.name), asc(personTable.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.displayName ?? row.userName,
  }));
}

async function assertLead(
  executor: Executor,
  workspaceId: string,
  leadId: string,
) {
  const candidates = await leadCandidates(executor, workspaceId);
  if (!candidates.some((candidate) => candidate.id === leadId))
    throw new ModuleRuleError(422, "module_lead_invalid");
}

async function leadNames(executor: Executor, ids: string[]) {
  if (ids.length === 0) return new Map<string, string | null>();
  const rows = await executor
    .select({
      id: personTable.id,
      displayName: personTable.displayName,
      userName: userTable.name,
    })
    .from(personTable)
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(inArray(personTable.id, ids));
  return new Map(rows.map((row) => [row.id, row.displayName ?? row.userName]));
}

export type ModuleView = {
  row: ModuleRow;
  lead: { id: string; name: string | null } | null;
  progress: {
    total: number;
    completed: number;
    cancelled: number;
    remaining: number;
    percent: number;
  };
  forecast: ModuleForecast;
};

function progressOf(facts: ItemFact[]) {
  const completed = facts.filter((fact) => fact.group === "completed").length;
  const cancelled = facts.filter((fact) => fact.group === "cancelled").length;
  const total = facts.length;
  const live = total - cancelled;
  return {
    total,
    completed,
    cancelled,
    remaining: total - completed - cancelled,
    percent: live === 0 ? 0 : Math.round((completed / live) * 100),
  };
}

async function viewsFor(
  executor: Executor,
  rows: ModuleRow[],
  now: Date,
): Promise<ModuleView[]> {
  const today = todayUtc(now);
  const facts = rows.length
    ? await loadItemFacts(
        executor,
        inArray(
          workItemTable.moduleId,
          rows.map((row) => row.id),
        ),
      )
    : [];
  const byModule = new Map<string, ItemFact[]>();
  for (const fact of facts) {
    if (!fact.moduleId) continue;
    const list = byModule.get(fact.moduleId) ?? [];
    list.push(fact);
    byModule.set(fact.moduleId, list);
  }
  const names = await leadNames(
    executor,
    rows.map((row) => row.leadId).filter((id): id is string => id !== null),
  );
  return rows.map((row) => {
    const items = byModule.get(row.id) ?? [];
    const progress = progressOf(items);
    return {
      row,
      lead: row.leadId
        ? { id: row.leadId, name: names.get(row.leadId) ?? null }
        : null,
      progress,
      forecast: forecastModule({
        today,
        targetDate: row.targetDate,
        remaining: progress.remaining,
        state: row.state as ModuleState,
        resolvedDates: items
          .filter((item) => item.group === "completed" && item.resolvedAt)
          .map((item) => toDateString(item.resolvedAt as Date)),
      }),
    };
  });
}

export async function listModules(scope: ProjectRef, now: Date) {
  const rows = await db
    .select()
    .from(moduleTable)
    .where(eq(moduleTable.projectId, scope.projectId))
    .orderBy(asc(moduleTable.name), asc(moduleTable.id));
  return viewsFor(db, rows, now);
}

export async function moduleView(row: ModuleRow, now: Date) {
  return (await viewsFor(db, [row], now))[0] as ModuleView;
}

export async function createModule(
  scope: ProjectRef,
  input: {
    name: string;
    description?: string;
    leadId?: string | null;
    state?: ModuleState;
    targetDate?: string | null;
  },
  actor: AgileActor,
) {
  return db.transaction(async (tx) => {
    if (input.leadId) await assertLead(tx, scope.workspaceId, input.leadId);
    const [row] = await tx
      .insert(moduleTable)
      .values({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        name: input.name,
        description: input.description ?? null,
        leadId: input.leadId ?? null,
        state: input.state ?? "planned",
        targetDate: input.targetDate ?? null,
        createdBy: actor.userId,
      })
      .returning();
    if (!row) throw new Error("module insert returned no row");
    await auditAgile(tx, {
      action: "module.created",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      entityType: "module",
      entityId: row.id,
      actor,
      after: { name: row.name, state: row.state, targetDate: row.targetDate },
    });
    return row;
  });
}

export async function updateModule(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    leadId?: string | null;
    state?: ModuleState;
    targetDate?: string | null;
    version?: number;
  },
  actor: AgileActor,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(moduleTable)
      .where(eq(moduleTable.id, id))
      .for("update")
      .limit(1);
    if (!existing) return undefined;
    if (patch.version !== undefined && patch.version !== existing.version)
      throw new VersionConflictError(existing.version);
    if (patch.leadId) await assertLead(tx, existing.workspaceId, patch.leadId);
    const [row] = await tx
      .update(moduleTable)
      .set({
        name: patch.name ?? existing.name,
        description:
          patch.description === undefined
            ? existing.description
            : patch.description,
        leadId: patch.leadId === undefined ? existing.leadId : patch.leadId,
        state: patch.state ?? existing.state,
        targetDate:
          patch.targetDate === undefined
            ? existing.targetDate
            : patch.targetDate,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(moduleTable.id, id))
      .returning();
    if (!row) return undefined;
    await auditAgile(tx, {
      action: "module.updated",
      workspaceId: existing.workspaceId,
      projectId: existing.projectId,
      entityType: "module",
      entityId: id,
      actor,
      before: {
        name: existing.name,
        state: existing.state,
        leadId: existing.leadId,
        targetDate: existing.targetDate,
      },
      after: {
        name: row.name,
        state: row.state,
        leadId: row.leadId,
        targetDate: row.targetDate,
      },
    });
    return row;
  });
}

export async function addItemsToModule(
  moduleId: string,
  keys: string[],
  actor: AgileActor,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const [mod] = await tx
      .select()
      .from(moduleTable)
      .where(eq(moduleTable.id, moduleId))
      .for("update")
      .limit(1);
    if (!mod) return undefined;
    const unique = [...new Set(keys)];
    const facts = await itemsByKeys(tx, mod.projectId, unique);
    const byKey = new Map(facts.map((fact) => [fact.key, fact]));
    const result = {
      added: [] as string[],
      alreadyInModule: [] as string[],
      movedFromOtherModule: [] as string[],
      refused: [] as Array<{ key: string; reason: string }>,
    };
    const toAdd: ItemFact[] = [];
    for (const key of unique) {
      const fact = byKey.get(key);
      if (!fact) result.refused.push({ key, reason: "not_found" });
      else if (fact.moduleId === mod.id) result.alreadyInModule.push(key);
      else {
        toAdd.push(fact);
        if (fact.moduleId) result.movedFromOtherModule.push(key);
      }
    }
    if (toAdd.length > 0) {
      await tx
        .update(workItemTable)
        .set({ moduleId: mod.id, updatedAt: now })
        .where(
          inArray(
            workItemTable.id,
            toAdd.map((fact) => fact.id),
          ),
        );
      result.added = toAdd.map((fact) => fact.key);
      await auditAgile(tx, {
        action: "module.work_item_added",
        workspaceId: mod.workspaceId,
        projectId: mod.projectId,
        entityType: "module",
        entityId: mod.id,
        actor,
        after: {
          workItems: result.added,
          movedFromOtherModule: result.movedFromOtherModule,
        },
      });
    }
    return result;
  });
}

export async function removeItemFromModule(
  moduleId: string,
  key: string,
  actor: AgileActor,
  now: Date,
): Promise<"removed" | "not_in_module" | undefined> {
  return db.transaction(async (tx) => {
    const [mod] = await tx
      .select()
      .from(moduleTable)
      .where(eq(moduleTable.id, moduleId))
      .for("update")
      .limit(1);
    if (!mod) return undefined;
    const [fact] = await itemsByKeys(tx, mod.projectId, [key]);
    if (!fact || fact.moduleId !== mod.id) return "not_in_module";
    await tx
      .update(workItemTable)
      .set({ moduleId: null, updatedAt: now })
      .where(eq(workItemTable.id, fact.id));
    await auditAgile(tx, {
      action: "module.work_item_removed",
      workspaceId: mod.workspaceId,
      projectId: mod.projectId,
      entityType: "module",
      entityId: mod.id,
      actor,
      before: { workItem: key },
    });
    return "removed";
  });
}

export async function setItemModule(
  input: { projectId: string; key: string; moduleId: string | null },
  actor: AgileActor,
  now: Date,
) {
  if (input.moduleId === null) {
    const [fact] = await itemsByKeys(db, input.projectId, [input.key]);
    if (!fact) throw new HTTPException(404, { message: "Work item not found" });
    if (fact.moduleId)
      await removeItemFromModule(fact.moduleId, input.key, actor, now);
    return;
  }
  const mod = await getModule(db, input.moduleId);
  if (!mod || mod.projectId !== input.projectId)
    throw new HTTPException(404, { message: "Module not found" });
  const result = await addItemsToModule(mod.id, [input.key], actor, now);
  if (result?.refused.length)
    throw new HTTPException(404, { message: "Work item not found" });
}

/** Used by the deletion target: clear the pointers first (the composite FK is NO ACTION). */
export async function deleteModuleRow(
  tx: Executor,
  mod: ModuleRow,
  actor: AgileActor,
) {
  await tx
    .update(workItemTable)
    .set({ moduleId: null, updatedAt: new Date() })
    .where(eq(workItemTable.moduleId, mod.id));
  const deleted = await tx
    .delete(moduleTable)
    .where(eq(moduleTable.id, mod.id))
    .returning({ id: moduleTable.id });
  if (deleted.length === 0) return false;
  await auditAgile(tx, {
    action: "module.deleted",
    workspaceId: mod.workspaceId,
    projectId: mod.projectId,
    entityType: "module",
    entityId: mod.id,
    actor,
    before: { name: mod.name, state: mod.state },
  });
  return true;
}

export const getModuleById = (id: string) => getModule(db, id);
export const leadCandidatesFor = (workspaceId: string) =>
  leadCandidates(db, workspaceId);
