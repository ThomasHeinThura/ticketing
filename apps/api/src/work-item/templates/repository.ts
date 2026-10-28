import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import type { Executor } from "../../database/executor";

/**
 * WI-5 persistence for `work_item_template`, `checklist_template` and `checklist_item`.
 *
 * ISOLATED ON PURPOSE: these tables are created by migration 0136 (proposed SQL in the P1 wave-2
 * hand-back), and `schema.ts` does not declare them until the coordinator applies it. Until
 * then every statement here is raw SQL through the shared executor, owned by this one module.
 * When the Drizzle tables land, only this file changes; controllers and the apply-on-create hook
 * depend on the typed functions below.
 *
 * Timestamp columns are `timestamp without time zone` holding UTC wall clock (`utils/db-time.ts`),
 * so writes use `now() AT TIME ZONE 'UTC'` and reads render them as explicit UTC ISO text rather
 * than trusting the driver's local-time parse.
 */

const ISO = (column: string) =>
  sql.raw(
    `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "${column.split(".").pop()}"`,
  );
const UTC_NOW = sql.raw(`(now() AT TIME ZONE 'UTC')`);

export type WorkItemTemplate = {
  id: string;
  workspaceId: string;
  typeId: string;
  name: string;
  title: string;
  description: unknown;
  labelIds: string[];
  customFieldValues: Record<string, unknown>;
  checklistTemplateId: string | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ChecklistTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  items: Array<{ id: string; position: number; text: string }>;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type TemplateRow = {
  id: string;
  workspace_id: string;
  type_id: string;
  name: string;
  title: string;
  description: unknown;
  labels: unknown;
  custom_field_values: unknown;
  checklist_template_id: string | null;
  archived_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

const TEMPLATE_COLUMNS = sql`
  t.id, t.workspace_id, t.type_id, t.name, t.title, t.description, t.labels,
  t.custom_field_values, t.checklist_template_id, t.version,
  ${ISO("t.archived_at")}, ${ISO("t.created_at")}, ${ISO("t.updated_at")}
`;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toTemplate(row: TemplateRow): WorkItemTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    typeId: row.type_id,
    name: row.name,
    title: row.title,
    description: row.description ?? null,
    labelIds: stringArray(row.labels),
    customFieldValues:
      row.custom_field_values &&
      typeof row.custom_field_values === "object" &&
      !Array.isArray(row.custom_field_values)
        ? (row.custom_field_values as Record<string, unknown>)
        : {},
    checklistTemplateId: row.checklist_template_id,
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function listWorkItemTemplates(
  executor: Executor,
  workspaceId: string,
  includeArchived: boolean,
): Promise<WorkItemTemplate[]> {
  const result = await executor.execute<TemplateRow>(sql`
    SELECT ${TEMPLATE_COLUMNS} FROM work_item_template t
    WHERE t.workspace_id = ${workspaceId}
      ${includeArchived ? sql`` : sql`AND t.archived_at IS NULL`}
    ORDER BY lower(t.name), t.id
  `);
  return result.rows.map(toTemplate);
}

export async function getWorkItemTemplate(
  executor: Executor,
  workspaceId: string,
  id: string,
  lock?: "share" | "update",
): Promise<WorkItemTemplate | undefined> {
  const result = await executor.execute<TemplateRow>(sql`
    SELECT ${TEMPLATE_COLUMNS} FROM work_item_template t
    WHERE t.workspace_id = ${workspaceId} AND t.id = ${id}
    ${lock === "share" ? sql`FOR SHARE` : lock === "update" ? sql`FOR UPDATE` : sql``}
  `);
  const row = result.rows[0];
  return row ? toTemplate(row) : undefined;
}

export type TemplateWrite = {
  name: string;
  typeId: string;
  title: string;
  description: unknown;
  labelIds: string[];
  customFieldValues: Record<string, unknown>;
  checklistTemplateId: string | null;
};

export async function insertWorkItemTemplate(
  executor: Executor,
  workspaceId: string,
  value: TemplateWrite,
): Promise<WorkItemTemplate> {
  const id = createId();
  await executor.execute(sql`
    INSERT INTO work_item_template (
      id, workspace_id, type_id, name, title, description, labels,
      custom_field_values, checklist_template_id, version, created_at, updated_at
    ) VALUES (
      ${id}, ${workspaceId}, ${value.typeId}, ${value.name}, ${value.title},
      ${value.description === undefined || value.description === null ? null : JSON.stringify(value.description)}::jsonb,
      ${JSON.stringify(value.labelIds)}::jsonb,
      ${JSON.stringify(value.customFieldValues)}::jsonb,
      ${value.checklistTemplateId}, 1, ${UTC_NOW}, ${UTC_NOW}
    )
  `);
  const created = await getWorkItemTemplate(executor, workspaceId, id);
  if (!created) throw new Error("Created work item template is missing");
  return created;
}

export async function replaceWorkItemTemplate(
  executor: Executor,
  workspaceId: string,
  id: string,
  value: TemplateWrite,
): Promise<WorkItemTemplate | undefined> {
  const result = await executor.execute(sql`
    UPDATE work_item_template SET
      type_id = ${value.typeId}, name = ${value.name}, title = ${value.title},
      description = ${value.description === undefined || value.description === null ? null : JSON.stringify(value.description)}::jsonb,
      labels = ${JSON.stringify(value.labelIds)}::jsonb,
      custom_field_values = ${JSON.stringify(value.customFieldValues)}::jsonb,
      checklist_template_id = ${value.checklistTemplateId},
      version = version + 1, updated_at = ${UTC_NOW}
    WHERE workspace_id = ${workspaceId} AND id = ${id} AND archived_at IS NULL
  `);
  return (result.rowCount ?? 0) === 0
    ? undefined
    : getWorkItemTemplate(executor, workspaceId, id);
}

export async function archiveWorkItemTemplate(
  executor: Executor,
  workspaceId: string,
  id: string,
): Promise<WorkItemTemplate | undefined> {
  const result = await executor.execute(sql`
    UPDATE work_item_template SET archived_at = ${UTC_NOW}, version = version + 1, updated_at = ${UTC_NOW}
    WHERE workspace_id = ${workspaceId} AND id = ${id} AND archived_at IS NULL
  `);
  return (result.rowCount ?? 0) === 0
    ? undefined
    : getWorkItemTemplate(executor, workspaceId, id);
}

/** Workspace-wide (catalogue) labels only: a workspace-scoped template cannot name a project label. */
export async function countWorkspaceLabels(
  executor: Executor,
  workspaceId: string,
  labelIds: readonly string[],
): Promise<string[]> {
  if (!labelIds.length) return [];
  const result = await executor.execute<{ id: string }>(sql`
    SELECT id FROM label
    WHERE workspace_id = ${workspaceId} AND project_id IS NULL AND task_id IS NULL
      AND id = ANY(${sql.param([...labelIds])}::text[])
  `);
  return result.rows.map((row) => row.id);
}

export async function workspaceHasType(
  executor: Executor,
  workspaceId: string,
  typeId: string,
): Promise<boolean> {
  const result = await executor.execute(
    sql`SELECT 1 FROM work_item_type WHERE workspace_id = ${workspaceId} AND id = ${typeId}`,
  );
  return (result.rowCount ?? 0) > 0;
}

// ── checklist templates ───────────────────────────────────────────────────────

type ChecklistRow = {
  id: string;
  workspace_id: string;
  name: string;
  version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const CHECKLIST_COLUMNS = sql`
  c.id, c.workspace_id, c.name, c.version,
  ${ISO("c.archived_at")}, ${ISO("c.created_at")}, ${ISO("c.updated_at")}
`;

async function checklistItems(
  executor: Executor,
  templateIds: readonly string[],
) {
  if (!templateIds.length) return new Map<string, ChecklistTemplate["items"]>();
  const result = await executor.execute<{
    id: string;
    template_id: string;
    position: number;
    text: string;
  }>(sql`
    SELECT id, template_id, position, text FROM checklist_item
    WHERE template_id = ANY(${sql.param([...templateIds])}::text[])
    ORDER BY position, id
  `);
  const grouped = new Map<string, ChecklistTemplate["items"]>();
  for (const row of result.rows) {
    const list = grouped.get(row.template_id) ?? [];
    list.push({ id: row.id, position: Number(row.position), text: row.text });
    grouped.set(row.template_id, list);
  }
  return grouped;
}

async function hydrateChecklists(
  executor: Executor,
  rows: readonly ChecklistRow[],
): Promise<ChecklistTemplate[]> {
  const items = await checklistItems(
    executor,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    items: items.get(row.id) ?? [],
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function listChecklistTemplates(
  executor: Executor,
  workspaceId: string,
  includeArchived: boolean,
) {
  const result = await executor.execute<ChecklistRow>(sql`
    SELECT ${CHECKLIST_COLUMNS} FROM checklist_template c
    WHERE c.workspace_id = ${workspaceId}
      ${includeArchived ? sql`` : sql`AND c.archived_at IS NULL`}
    ORDER BY lower(c.name), c.id
  `);
  return hydrateChecklists(executor, result.rows);
}

export async function getChecklistTemplate(
  executor: Executor,
  workspaceId: string,
  id: string,
  lock?: "share" | "update",
) {
  const result = await executor.execute<ChecklistRow>(sql`
    SELECT ${CHECKLIST_COLUMNS} FROM checklist_template c
    WHERE c.workspace_id = ${workspaceId} AND c.id = ${id}
    ${lock === "share" ? sql`FOR SHARE` : lock === "update" ? sql`FOR UPDATE` : sql``}
  `);
  const [hydrated] = await hydrateChecklists(executor, result.rows);
  return hydrated;
}

export async function insertChecklistTemplate(
  executor: Executor,
  workspaceId: string,
  name: string,
  items: readonly string[],
) {
  const id = createId();
  await executor.execute(sql`
    INSERT INTO checklist_template (id, workspace_id, name, version, created_at, updated_at)
    VALUES (${id}, ${workspaceId}, ${name}, 1, ${UTC_NOW}, ${UTC_NOW})
  `);
  await replaceChecklistTemplateItems(executor, workspaceId, id, items);
  const created = await getChecklistTemplate(executor, workspaceId, id);
  if (!created) throw new Error("Created checklist template is missing");
  return created;
}

export async function replaceChecklistTemplateItems(
  executor: Executor,
  workspaceId: string,
  templateId: string,
  items: readonly string[],
) {
  await executor.execute(
    sql`DELETE FROM checklist_item WHERE template_id = ${templateId} AND workspace_id = ${workspaceId}`,
  );
  for (const [index, text] of items.entries())
    await executor.execute(sql`
      INSERT INTO checklist_item (id, workspace_id, template_id, position, text, created_at)
      VALUES (${createId()}, ${workspaceId}, ${templateId}, ${index}, ${text}, ${UTC_NOW})
    `);
}

export async function renameChecklistTemplate(
  executor: Executor,
  workspaceId: string,
  id: string,
  name: string | undefined,
) {
  const result = await executor.execute(sql`
    UPDATE checklist_template SET
      ${name === undefined ? sql`` : sql`name = ${name},`}
      version = version + 1, updated_at = ${UTC_NOW}
    WHERE workspace_id = ${workspaceId} AND id = ${id} AND archived_at IS NULL
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function archiveChecklistTemplate(
  executor: Executor,
  workspaceId: string,
  id: string,
) {
  const result = await executor.execute(sql`
    UPDATE checklist_template SET archived_at = ${UTC_NOW}, version = version + 1, updated_at = ${UTC_NOW}
    WHERE workspace_id = ${workspaceId} AND id = ${id} AND archived_at IS NULL
  `);
  return (result.rowCount ?? 0) > 0;
}

/** Copies a template's items onto a work item (`WI-5`); never copies `done_at`/`done_by`. */
export async function copyChecklistToWorkItem(
  executor: Executor,
  workspaceId: string,
  checklistTemplateId: string,
  workItemId: string,
): Promise<number> {
  const result = await executor.execute<{ text: string; position: number }>(sql`
    SELECT text, position FROM checklist_item
    WHERE template_id = ${checklistTemplateId} AND workspace_id = ${workspaceId}
    ORDER BY position, id
  `);
  for (const [index, row] of result.rows.entries())
    await executor.execute(sql`
      INSERT INTO checklist_item (id, workspace_id, work_item_id, position, text, created_at)
      VALUES (${createId()}, ${workspaceId}, ${workItemId}, ${index}, ${row.text}, ${UTC_NOW})
    `);
  return result.rows.length;
}
