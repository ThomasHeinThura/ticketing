import { createId } from "@paralleldrive/cuid2";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  customFieldSectionTable,
  customFieldTable,
  customFieldTypeVisibilityTable,
  customFieldValueTable,
} from "../database/migration-schema";
import { workItemTable, workItemTypeTable } from "../database/schema";
import { auditIfRegistered } from "../team/audit";
import {
  applicableFields,
  type CustomFieldFormat,
  type CustomFieldOption,
  conditionRefusal,
  conditionSatisfied,
  defaultValueFor,
  type FieldDefinition,
  fieldsConditionedOn,
  formatChangeRefused,
  isValueSet,
  missingRequiredFields,
  parseVisibilityCondition,
  removedOptionKeys,
  type TypeVisibility,
  type VisibilityCondition,
  validateFieldValue,
  validateOptions,
} from "./logic";
import { CUSTOM_FIELD_RESTORE_WINDOW_MS } from "./retention";

export type FieldRow = typeof customFieldTable.$inferSelect;
export type SectionRow = typeof customFieldSectionTable.$inferSelect;

/** The editable attributes of a field, as recorded in `custom_field.updated` before/after. */
function fieldAttributes(row: FieldRow) {
  return {
    name: row.name,
    key: row.key,
    sectionId: row.sectionId,
    options: row.options,
    defaultValue: row.defaultValue,
    helpText: row.helpText,
    customerVisible: row.customerVisible,
    visibilityCondition: row.visibilityCondition,
  };
}

export type CustomFieldActor = {
  userId: string;
  actorType: "person" | "api_key";
  apiKeyId?: string | null;
};

export type FieldVisibilityRow = {
  workItemTypeId: string;
  visible: boolean;
  required: boolean;
};

export type MaterializedField = Omit<
  FieldRow,
  "options" | "visibilityCondition" | "format"
> & {
  format: CustomFieldFormat;
  options: CustomFieldOption[];
  visibilityCondition: VisibilityCondition | null;
  visibility: FieldVisibilityRow[];
};

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const causeCode = (error as { cause?: { code?: string } } | null)?.cause
    ?.code;
  return code === "23505" || causeCode === "23505";
}

function conflict(message: string): never {
  throw new HTTPException(409, { message });
}

function asOptions(raw: unknown): CustomFieldOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { key, label } = entry as Record<string, unknown>;
    return typeof key === "string" && typeof label === "string"
      ? [{ key, label }]
      : [];
  });
}

function asCondition(raw: unknown): VisibilityCondition | null {
  const parsed = parseVisibilityCondition(raw);
  return parsed === "invalid" ? null : parsed;
}

// ── sections ─────────────────────────────────────────────────────────────────

export async function listSections(workspaceId: string) {
  return db
    .select()
    .from(customFieldSectionTable)
    .where(eq(customFieldSectionTable.workspaceId, workspaceId))
    .orderBy(
      asc(customFieldSectionTable.position),
      asc(customFieldSectionTable.id),
    );
}

export async function getSection(id: string) {
  const [row] = await db
    .select()
    .from(customFieldSectionTable)
    .where(eq(customFieldSectionTable.id, id))
    .limit(1);
  return row;
}

export async function createSection(
  workspaceId: string,
  name: string,
  actor: CustomFieldActor,
) {
  try {
    return await db.transaction(async (tx) => {
      const [last] = await tx
        .select({ value: sql<number>`coalesce(max(position), -1)` })
        .from(customFieldSectionTable)
        .where(eq(customFieldSectionTable.workspaceId, workspaceId));
      const [created] = await tx
        .insert(customFieldSectionTable)
        .values({
          id: createId(),
          workspaceId,
          name,
          position: Number(last?.value ?? -1) + 1,
        })
        .returning();
      if (!created) throw new Error("custom_field_section insert failed");
      await auditIfRegistered(tx, {
        action: "custom_field_section.created",
        workspaceId,
        entityType: "custom_field_section",
        entityId: created.id,
        actor,
        after: { name },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      conflict("A section with that name already exists");
    throw error;
  }
}

export async function renameSection(
  id: string,
  workspaceId: string,
  name: string,
  actor: CustomFieldActor,
) {
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(customFieldSectionTable)
        .where(
          and(
            eq(customFieldSectionTable.id, id),
            eq(customFieldSectionTable.workspaceId, workspaceId),
          ),
        )
        .for("update");
      if (!before) return undefined;
      const [updated] = await tx
        .update(customFieldSectionTable)
        .set({ name, updatedAt: new Date() })
        .where(eq(customFieldSectionTable.id, id))
        .returning();
      await auditIfRegistered(tx, {
        action: "custom_field_section.updated",
        workspaceId,
        entityType: "custom_field_section",
        entityId: id,
        actor,
        before: { name: before.name },
        after: { name },
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      conflict("A section with that name already exists");
    throw error;
  }
}

/** A section with any field (even soft-deleted) cannot be removed; move the fields first. */
export async function deleteSection(
  id: string,
  workspaceId: string,
  actor: CustomFieldActor,
) {
  return db.transaction(async (tx) => {
    const [section] = await tx
      .select()
      .from(customFieldSectionTable)
      .where(
        and(
          eq(customFieldSectionTable.id, id),
          eq(customFieldSectionTable.workspaceId, workspaceId),
        ),
      )
      .for("update");
    if (!section) return false;
    const [inUse] = await tx
      .select({ value: count() })
      .from(customFieldTable)
      .where(
        and(
          eq(customFieldTable.workspaceId, workspaceId),
          eq(customFieldTable.sectionId, id),
        ),
      );
    if ((inUse?.value ?? 0) > 0)
      conflict("Move or delete this section's fields before deleting it");
    await tx
      .delete(customFieldSectionTable)
      .where(eq(customFieldSectionTable.id, id));
    await auditIfRegistered(tx, {
      action: "custom_field_section.deleted",
      workspaceId,
      entityType: "custom_field_section",
      entityId: id,
      actor,
      before: { name: section.name },
    });
    return true;
  });
}

export async function reorderSections(
  workspaceId: string,
  orderedIds: readonly string[],
) {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: customFieldSectionTable.id })
      .from(customFieldSectionTable)
      .where(eq(customFieldSectionTable.workspaceId, workspaceId))
      .for("update");
    const known = new Set(rows.map((row) => row.id));
    if (
      orderedIds.length !== known.size ||
      new Set(orderedIds).size !== orderedIds.length ||
      orderedIds.some((id) => !known.has(id))
    )
      throw new HTTPException(400, {
        message: "Reorder must list every section exactly once",
      });
    for (const [position, id] of orderedIds.entries()) {
      await tx
        .update(customFieldSectionTable)
        .set({ position, updatedAt: new Date() })
        .where(eq(customFieldSectionTable.id, id));
    }
  });
}

// ── fields ───────────────────────────────────────────────────────────────────

async function materialize(
  executor: Executor,
  rows: FieldRow[],
): Promise<MaterializedField[]> {
  if (rows.length === 0) return [];
  const visibilityRows = await executor
    .select()
    .from(customFieldTypeVisibilityTable)
    .where(
      inArray(
        customFieldTypeVisibilityTable.customFieldId,
        rows.map((row) => row.id),
      ),
    );
  const byField = new Map<string, FieldVisibilityRow[]>();
  for (const row of visibilityRows) {
    const list = byField.get(row.customFieldId) ?? [];
    list.push({
      workItemTypeId: row.workItemTypeId,
      visible: row.visible,
      required: row.required,
    });
    byField.set(row.customFieldId, list);
  }
  return rows.map((row) => ({
    ...row,
    format: row.format as CustomFieldFormat,
    options: asOptions(row.options),
    visibilityCondition: asCondition(row.visibilityCondition),
    visibility: byField.get(row.id) ?? [],
  }));
}

export async function listFields(
  workspaceId: string,
  options: { includeDeleted?: boolean } = {},
  executor: Executor = db,
): Promise<MaterializedField[]> {
  const rows = await executor
    .select()
    .from(customFieldTable)
    .where(
      and(
        eq(customFieldTable.workspaceId, workspaceId),
        options.includeDeleted ? undefined : isNull(customFieldTable.deletedAt),
      ),
    )
    .orderBy(asc(customFieldTable.position), asc(customFieldTable.id));
  return materialize(executor, rows);
}

export async function getFieldWorkspace(id: string) {
  const [row] = await db
    .select({
      workspaceId: customFieldTable.workspaceId,
      deletedAt: customFieldTable.deletedAt,
    })
    .from(customFieldTable)
    .where(eq(customFieldTable.id, id))
    .limit(1);
  return row;
}

export async function getField(
  id: string,
  workspaceId: string,
  executor: Executor = db,
) {
  const [row] = await executor
    .select()
    .from(customFieldTable)
    .where(
      and(
        eq(customFieldTable.id, id),
        eq(customFieldTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  const [field] = await materialize(executor, [row]);
  return field;
}

/** How many work items hold a set value for each field. */
export async function fieldUsageCounts(
  fieldIds: readonly string[],
): Promise<Map<string, number>> {
  if (fieldIds.length === 0) return new Map();
  const rows = await db
    .select({
      fieldId: customFieldValueTable.customFieldId,
      value: count(),
    })
    .from(customFieldValueTable)
    .where(
      and(
        inArray(customFieldValueTable.customFieldId, [...fieldIds]),
        sql`${customFieldValueTable.value} not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)`,
      ),
    )
    .groupBy(customFieldValueTable.customFieldId);
  return new Map(rows.map((row) => [row.fieldId, Number(row.value)]));
}

export type CreateFieldInput = {
  workspaceId: string;
  sectionId: string;
  key: string;
  name: string;
  format: CustomFieldFormat;
  options: CustomFieldOption[];
  defaultValue?: unknown;
  helpText?: string | null;
  customerVisible?: boolean;
  visibilityCondition?: unknown;
  visibility?: FieldVisibilityRow[];
  actor: CustomFieldActor;
};

async function assertTypesInWorkspace(
  tx: Executor,
  workspaceId: string,
  typeIds: readonly string[],
) {
  if (typeIds.length === 0) return;
  const rows = await tx
    .select({ id: workItemTypeTable.id })
    .from(workItemTypeTable)
    .where(
      and(
        eq(workItemTypeTable.workspaceId, workspaceId),
        inArray(workItemTypeTable.id, [...typeIds]),
      ),
    );
  if (rows.length !== new Set(typeIds).size)
    throw new HTTPException(400, {
      message: "Unknown work item type for this workspace",
    });
}

async function writeVisibility(
  tx: Executor,
  fieldId: string,
  workspaceId: string,
  rows: readonly FieldVisibilityRow[],
) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.workItemTypeId))
      throw new HTTPException(400, {
        message: "A work item type may appear only once",
      });
    seen.add(row.workItemTypeId);
    if (row.required && !row.visible)
      throw new HTTPException(400, {
        message: "A required field must also be visible",
      });
  }
  await assertTypesInWorkspace(tx, workspaceId, [...seen]);
  await tx
    .delete(customFieldTypeVisibilityTable)
    .where(eq(customFieldTypeVisibilityTable.customFieldId, fieldId));
  if (rows.length > 0)
    await tx.insert(customFieldTypeVisibilityTable).values(
      rows.map((row) => ({
        workspaceId,
        customFieldId: fieldId,
        workItemTypeId: row.workItemTypeId,
        visible: row.visible,
        required: row.required,
      })),
    );
}

export async function createField(input: CreateFieldInput) {
  const optionsError = validateOptions(input.format, input.options);
  if (optionsError) throw new HTTPException(400, { message: optionsError });
  if (input.defaultValue !== undefined && input.defaultValue !== null) {
    const result = validateFieldValue(
      { format: input.format, options: input.options },
      input.defaultValue,
    );
    if (!result.ok)
      throw new HTTPException(400, {
        message: `Default value: ${result.message}`,
      });
  }
  try {
    return await db.transaction(async (tx) => {
      const [section] = await tx
        .select({ id: customFieldSectionTable.id })
        .from(customFieldSectionTable)
        .where(
          and(
            eq(customFieldSectionTable.id, input.sectionId),
            eq(customFieldSectionTable.workspaceId, input.workspaceId),
          ),
        )
        .for("share");
      if (!section)
        throw new HTTPException(400, { message: "Unknown section" });

      const existing = await listFields(
        input.workspaceId,
        { includeDeleted: true },
        tx,
      );
      let condition: VisibilityCondition | null = null;
      if (input.visibilityCondition !== undefined) {
        const parsed = parseVisibilityCondition(input.visibilityCondition);
        if (parsed === "invalid")
          throw new HTTPException(400, {
            message: "Invalid visibility condition",
          });
        if (parsed) {
          const refusal = conditionRefusal(
            { key: input.key },
            parsed,
            existing.filter((field) => field.deletedAt === null),
          );
          if (refusal) throw new HTTPException(400, { message: refusal });
        }
        condition = parsed;
      }
      const [last] = await tx
        .select({ value: sql<number>`coalesce(max(position), -1)` })
        .from(customFieldTable)
        .where(eq(customFieldTable.workspaceId, input.workspaceId));
      const id = createId();
      await tx.insert(customFieldTable).values({
        id,
        workspaceId: input.workspaceId,
        sectionId: input.sectionId,
        entityType: "work_item",
        key: input.key,
        name: input.name,
        format: input.format,
        options: input.options,
        defaultValue: input.defaultValue ?? null,
        helpText: input.helpText ?? null,
        customerVisible: input.customerVisible ?? false,
        visibilityCondition: condition,
        position: Number(last?.value ?? -1) + 1,
      });
      await writeVisibility(tx, id, input.workspaceId, input.visibility ?? []);
      await auditIfRegistered(tx, {
        action: "custom_field.created",
        workspaceId: input.workspaceId,
        entityType: "custom_field",
        entityId: id,
        actor: input.actor,
        after: { key: input.key, name: input.name, format: input.format },
      });
      const created = await getField(id, input.workspaceId, tx);
      if (!created) throw new Error("custom_field insert failed");
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      conflict("A custom field with that key already exists");
    throw error;
  }
}

export type UpdateFieldInput = {
  name?: string;
  format?: CustomFieldFormat;
  sectionId?: string;
  options?: CustomFieldOption[];
  defaultValue?: unknown;
  helpText?: string | null;
  customerVisible?: boolean;
  visibilityCondition?: unknown;
};

export async function updateField(
  id: string,
  workspaceId: string,
  input: UpdateFieldInput,
  actor: CustomFieldActor,
) {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(customFieldTable)
      .where(
        and(
          eq(customFieldTable.id, id),
          eq(customFieldTable.workspaceId, workspaceId),
          isNull(customFieldTable.deletedAt),
        ),
      )
      .for("update");
    if (!locked) return undefined;
    // CF-9.
    if (formatChangeRefused(locked.format as CustomFieldFormat, input.format))
      conflict(
        "A field's format cannot change. Create a new field and migrate the values.",
      );
    const format = locked.format as CustomFieldFormat;
    const options =
      input.options !== undefined ? input.options : asOptions(locked.options);
    const optionsError = validateOptions(format, options);
    if (optionsError) throw new HTTPException(400, { message: optionsError });

    if (input.options !== undefined) {
      // CF-7: an option in use cannot be removed.
      const removed = removedOptionKeys(asOptions(locked.options), options);
      if (removed.length > 0) {
        const inUse = await optionUsage(tx, id, format, removed);
        const blocking = [...inUse.entries()].filter(([, n]) => n > 0);
        if (blocking.length > 0)
          conflict(
            `Options still in use: ${blocking
              .map(([key, n]) => `${key} (${n} items)`)
              .join(", ")}. Migrate those items first.`,
          );
      }
    }
    const effective: {
      format: CustomFieldFormat;
      options: CustomFieldOption[];
    } = { format, options };
    if (input.defaultValue !== undefined && input.defaultValue !== null) {
      const result = validateFieldValue(effective, input.defaultValue);
      if (!result.ok)
        throw new HTTPException(400, {
          message: `Default value: ${result.message}`,
        });
    }
    if (input.sectionId !== undefined) {
      const [section] = await tx
        .select({ id: customFieldSectionTable.id })
        .from(customFieldSectionTable)
        .where(
          and(
            eq(customFieldSectionTable.id, input.sectionId),
            eq(customFieldSectionTable.workspaceId, workspaceId),
          ),
        );
      if (!section)
        throw new HTTPException(400, { message: "Unknown section" });
    }
    let condition: VisibilityCondition | null | undefined;
    if (input.visibilityCondition !== undefined) {
      const parsed = parseVisibilityCondition(input.visibilityCondition);
      if (parsed === "invalid")
        throw new HTTPException(400, {
          message: "Invalid visibility condition",
        });
      if (parsed) {
        const others = (await listFields(workspaceId, {}, tx)).filter(
          (field) => field.id !== id,
        );
        const refusal = conditionRefusal({ key: locked.key }, parsed, others);
        if (refusal) throw new HTTPException(400, { message: refusal });
      }
      condition = parsed;
    }
    const [updated] = await tx
      .update(customFieldTable)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.sectionId !== undefined
          ? { sectionId: input.sectionId }
          : {}),
        ...(input.options !== undefined ? { options } : {}),
        ...(input.defaultValue !== undefined
          ? { defaultValue: input.defaultValue }
          : {}),
        ...(input.helpText !== undefined ? { helpText: input.helpText } : {}),
        ...(input.customerVisible !== undefined
          ? { customerVisible: input.customerVisible }
          : {}),
        ...(condition !== undefined ? { visibilityCondition: condition } : {}),
        updatedAt: new Date(),
      })
      .where(eq(customFieldTable.id, id))
      .returning();
    if (!updated) return undefined;
    await auditIfRegistered(tx, {
      action: "custom_field.updated",
      workspaceId,
      entityType: "custom_field",
      entityId: id,
      actor,
      // The full attribute diff: a customer-visibility flip, an option, default, section or
      // condition change must leave a before/after trace, not only the name.
      before: fieldAttributes(locked),
      after: fieldAttributes(updated),
    });
    return getField(id, workspaceId, tx);
  });
}

/** How many work items hold each of `optionKeys` for a select / multi_select field. */
export async function optionUsage(
  executor: Executor,
  fieldId: string,
  format: CustomFieldFormat,
  optionKeys: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>(optionKeys.map((key) => [key, 0]));
  if (optionKeys.length === 0) return result;
  const rows = await executor
    .select({ value: customFieldValueTable.value })
    .from(customFieldValueTable)
    .where(eq(customFieldValueTable.customFieldId, fieldId));
  for (const row of rows) {
    const held =
      format === "multi_select" && Array.isArray(row.value)
        ? (row.value as unknown[])
        : [row.value];
    for (const key of optionKeys)
      if (held.includes(key)) result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

/** PUT /custom-fields/{id}/visibility: replaces the per-type grid (CF-2). */
export async function setFieldVisibility(
  id: string,
  workspaceId: string,
  rows: FieldVisibilityRow[],
  actor: CustomFieldActor,
) {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: customFieldTable.id })
      .from(customFieldTable)
      .where(
        and(
          eq(customFieldTable.id, id),
          eq(customFieldTable.workspaceId, workspaceId),
          isNull(customFieldTable.deletedAt),
        ),
      )
      .for("update");
    if (!locked) return undefined;
    await writeVisibility(tx, id, workspaceId, rows);
    await auditIfRegistered(tx, {
      action: "custom_field.updated",
      workspaceId,
      entityType: "custom_field",
      entityId: id,
      actor,
      after: {
        visibility: rows.map((row) => ({
          type: row.workItemTypeId,
          visible: row.visible,
          required: row.required,
        })),
      },
    });
    return getField(id, workspaceId, tx);
  });
}

/** Fields that name this field's key as their controller, for the delete refusal. */
export async function dependentFieldKeys(
  executor: Executor,
  workspaceId: string,
  field: { key: string; id: string },
): Promise<string[]> {
  const fields = await listFields(workspaceId, {}, executor);
  return fieldsConditionedOn(
    field.key,
    fields.filter((other) => other.id !== field.id),
  );
}

export async function restoreField(
  id: string,
  workspaceId: string,
  actor: CustomFieldActor,
) {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(customFieldTable)
      .where(
        and(
          eq(customFieldTable.id, id),
          eq(customFieldTable.workspaceId, workspaceId),
          isNotNull(customFieldTable.deletedAt),
        ),
      )
      .for("update");
    if (!locked) return undefined;
    if (
      locked.deletedAt &&
      Date.now() - locked.deletedAt.getTime() > CUSTOM_FIELD_RESTORE_WINDOW_MS
    )
      conflict("The 30 day restore window for this field has passed");
    await tx
      .update(customFieldTable)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(customFieldTable.id, id));
    await auditIfRegistered(tx, {
      action: "custom_field.restored",
      workspaceId,
      entityType: "custom_field",
      entityId: id,
      actor,
      after: { key: locked.key },
    });
    return getField(id, workspaceId, tx);
  });
}

export type ReorderFieldsInput = {
  sectionId: string;
  fieldIds: string[];
}[];

/** Section manager: order of fields within sections and moves between sections. */
export async function reorderFields(
  workspaceId: string,
  layout: ReorderFieldsInput,
) {
  await db.transaction(async (tx) => {
    const sections = await tx
      .select({ id: customFieldSectionTable.id })
      .from(customFieldSectionTable)
      .where(eq(customFieldSectionTable.workspaceId, workspaceId));
    const sectionIds = new Set(sections.map((section) => section.id));
    const rows = await tx
      .select({ id: customFieldTable.id })
      .from(customFieldTable)
      .where(
        and(
          eq(customFieldTable.workspaceId, workspaceId),
          isNull(customFieldTable.deletedAt),
        ),
      )
      .for("update");
    const known = new Set(rows.map((row) => row.id));
    const flat = layout.flatMap((entry) => entry.fieldIds);
    if (
      flat.length !== known.size ||
      new Set(flat).size !== flat.length ||
      flat.some((fieldId) => !known.has(fieldId)) ||
      layout.some((entry) => !sectionIds.has(entry.sectionId))
    )
      throw new HTTPException(400, {
        message: "Reorder must list every active field exactly once",
      });
    let position = 0;
    for (const entry of layout) {
      for (const fieldId of entry.fieldIds) {
        await tx
          .update(customFieldTable)
          .set({
            sectionId: entry.sectionId,
            position: position++,
            updatedAt: new Date(),
          })
          .where(eq(customFieldTable.id, fieldId));
      }
    }
  });
}

/**
 * The soft-delete the pending action executes (CF-8): values are retained for the 30 day window.
 */
export async function softDeleteField(
  tx: Executor,
  id: string,
  workspaceId: string,
  actor: CustomFieldActor,
) {
  const [row] = await tx
    .update(customFieldTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(customFieldTable.id, id),
        eq(customFieldTable.workspaceId, workspaceId),
        isNull(customFieldTable.deletedAt),
      ),
    )
    .returning({ id: customFieldTable.id, key: customFieldTable.key });
  if (!row) return false;
  await auditIfRegistered(tx, {
    action: "custom_field.deleted",
    workspaceId,
    entityType: "custom_field",
    entityId: id,
    actor,
    before: { key: row.key },
  });
  return true;
}

// ── values ───────────────────────────────────────────────────────────────────

/** Stored values for work items, keyed by field key (soft-deleted fields excluded). */
export async function loadValueMaps(
  executor: Executor,
  workItemIds: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  if (workItemIds.length === 0) return result;
  const rows = await executor
    .select({
      entityId: customFieldValueTable.entityId,
      key: customFieldTable.key,
      value: customFieldValueTable.value,
    })
    .from(customFieldValueTable)
    .innerJoin(
      customFieldTable,
      eq(customFieldTable.id, customFieldValueTable.customFieldId),
    )
    .where(
      and(
        inArray(customFieldValueTable.entityId, [...workItemIds]),
        eq(customFieldValueTable.entityType, "work_item"),
        isNull(customFieldTable.deletedAt),
      ),
    );
  for (const row of rows) {
    const map = result.get(row.entityId) ?? {};
    map[row.key] = row.value;
    result.set(row.entityId, map);
  }
  return result;
}

/** The `cf.<key>` map `field_required` workflow guards read (WF-15). */
export async function guardFieldValues(
  executor: Executor,
  workItemId: string,
): Promise<Record<string, unknown>> {
  const values = (await loadValueMaps(executor, [workItemId])).get(workItemId);
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [`cf.${key}`, value]),
  );
}

function visibilityForType(field: MaterializedField, typeId: string) {
  return field.visibility.find((row) => row.workItemTypeId === typeId);
}

function visibilityMap(
  fields: readonly MaterializedField[],
  typeId: string,
): Map<string, TypeVisibility> {
  const map = new Map<string, TypeVisibility>();
  for (const field of fields) {
    const row = visibilityForType(field, typeId);
    if (row)
      map.set(field.id, { visible: row.visible, required: row.required });
  }
  return map;
}

export type WorkItemCustomFieldView = {
  id: string;
  key: string;
  name: string;
  format: CustomFieldFormat;
  sectionId: string;
  sectionName: string;
  options: CustomFieldOption[];
  helpText: string | null;
  required: boolean;
  shown: boolean;
  customerVisible: boolean;
  visibilityCondition: VisibilityCondition | null;
  value: unknown;
};

/**
 * The fields that apply to one work item's type with its values, in section/position order:
 * what the properties panel and the create/edit forms render (CF-3: other fields are absent).
 */
export async function workItemCustomFields(
  executor: Executor,
  workItem: { id: string; workspaceId: string; typeId: string },
  options: { customerVisibleOnly?: boolean } = {},
): Promise<WorkItemCustomFieldView[]> {
  const fields = await listFields(workItem.workspaceId, {}, executor);
  if (fields.length === 0) return [];
  const sections = await executor
    .select({
      id: customFieldSectionTable.id,
      name: customFieldSectionTable.name,
      position: customFieldSectionTable.position,
    })
    .from(customFieldSectionTable)
    .where(eq(customFieldSectionTable.workspaceId, workItem.workspaceId));
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const values =
    (await loadValueMaps(executor, [workItem.id])).get(workItem.id) ?? {};
  const applicable = applicableFields(
    fields,
    visibilityMap(fields, workItem.typeId),
    values,
  ).filter((field) => !options.customerVisibleOnly || field.customerVisible);
  return applicable
    .sort((left, right) => {
      const a = sectionById.get(left.sectionId)?.position ?? 0;
      const b = sectionById.get(right.sectionId)?.position ?? 0;
      return a - b || left.position - right.position;
    })
    .map((field) => ({
      id: field.id,
      key: field.key,
      name: field.name,
      format: field.format as CustomFieldFormat,
      sectionId: field.sectionId,
      sectionName: sectionById.get(field.sectionId)?.name ?? "",
      options: field.options,
      helpText: field.helpText,
      required: field.required,
      shown: field.shown,
      customerVisible: field.customerVisible,
      visibilityCondition: field.visibilityCondition,
      value: values[field.key] ?? null,
    }));
}

export class CustomFieldValidationError extends HTTPException {
  constructor(public readonly problems: { key: string; message: string }[]) {
    super(400, {
      message: `Custom field values are invalid: ${problems
        .map((problem) => `${problem.key} (${problem.message})`)
        .join("; ")}`,
    });
  }
}

/**
 * Apply submitted `customFields` (key -> value) to a work item inside the caller's transaction:
 * validates each against the field's format and the item's type, writes or clears the value row,
 * and (CF-4) enforces required fields when `enforceRequired` is set (creation). On creation the
 * defaults (CF-5) fill every applicable field the caller left out.
 *
 * Returns the resulting key -> value map.
 */
/** One value that actually changed in an edit (`null` = unset), for the item's activity (CA-6). */
export type CustomFieldValueChange = {
  fieldId: string;
  key: string;
  name: string;
  customerVisible: boolean;
  from: unknown;
  to: unknown;
};

export async function applyWorkItemFieldValues(
  tx: Executor,
  workItem: {
    id: string;
    workspaceId: string;
    projectId: string;
    typeId: string;
  },
  submitted: Readonly<Record<string, unknown>> | undefined,
  mode: {
    create: boolean;
    enforceRequired: boolean | "submitted";
    /** Receives one entry per value that really changed, so the caller can write activity. */
    changes?: CustomFieldValueChange[];
  },
): Promise<Record<string, unknown>> {
  const fields = await listFields(workItem.workspaceId, {}, tx);
  const visibility = visibilityMap(fields, workItem.typeId);
  const applicableKeys = new Map(
    fields
      .filter((field) => visibility.get(field.id)?.visible)
      .map((field) => [field.key, field]),
  );
  const current =
    (await loadValueMaps(tx, [workItem.id])).get(workItem.id) ?? {};
  const next: Record<string, unknown> = { ...current };
  const problems: { key: string; message: string }[] = [];
  const writes = new Map<string, unknown>();

  for (const [key, raw] of Object.entries(submitted ?? {})) {
    const field = applicableKeys.get(key);
    if (!field) {
      problems.push({
        key,
        message: "Not available for this work item type",
      });
      continue;
    }
    const result = validateFieldValue(
      { format: field.format as CustomFieldFormat, options: field.options },
      raw,
    );
    if (!result.ok) {
      problems.push({ key, message: result.message });
      continue;
    }
    writes.set(field.id, result.value);
    next[key] = result.value;
  }
  if (mode.create) {
    for (const field of applicableKeys.values()) {
      if (writes.has(field.id) || (submitted && field.key in submitted))
        continue;
      const fallback = defaultValueFor(field);
      if (isValueSet(fallback)) {
        writes.set(field.id, fallback);
        next[field.key] = fallback;
      }
    }
  }
  if (problems.length > 0) throw new CustomFieldValidationError(problems);

  if (mode.enforceRequired) {
    // "submitted": an edit may leave an older gap alone (contract edge case: the requirement
    // applies on the next edit of that field), but never clears a required value it touches.
    const missing = missingRequiredFields(fields, visibility, next).filter(
      (key) => mode.enforceRequired === true || (submitted && key in submitted),
    );
    if (missing.length > 0)
      throw new CustomFieldValidationError(
        missing.map((key) => ({ key, message: "Required" })),
      );
  }

  if (mode.changes) {
    const byId = new Map(fields.map((field) => [field.id, field]));
    for (const [fieldId, value] of writes) {
      const field = byId.get(fieldId);
      if (!field) continue;
      const from = current[field.key] ?? null;
      const to = isValueSet(value) ? value : null;
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      mode.changes.push({
        fieldId,
        key: field.key,
        name: field.name,
        customerVisible: field.customerVisible,
        from,
        to,
      });
    }
  }

  for (const [fieldId, value] of writes) {
    if (!isValueSet(value)) {
      await tx
        .delete(customFieldValueTable)
        .where(
          and(
            eq(customFieldValueTable.customFieldId, fieldId),
            eq(customFieldValueTable.entityType, "work_item"),
            eq(customFieldValueTable.entityId, workItem.id),
          ),
        );
      continue;
    }
    await tx
      .insert(customFieldValueTable)
      .values({
        id: createId(),
        workspaceId: workItem.workspaceId,
        customFieldId: fieldId,
        entityType: "work_item",
        entityId: workItem.id,
        value: value as never,
        projectId: workItem.projectId,
      })
      .onConflictDoUpdate({
        target: [
          customFieldValueTable.customFieldId,
          customFieldValueTable.entityType,
          customFieldValueTable.entityId,
        ],
        set: {
          value: value as never,
          projectId: workItem.projectId,
          updatedAt: new Date(),
        },
      });
  }
  return next;
}

/**
 * CF-4 for a workflow transition: the keys of required, shown, empty fields that block entry to
 * a `started`/`completed` state. Empty when nothing is configured.
 */
export async function missingRequiredForTransition(
  executor: Executor,
  workItem: { id: string; workspaceId: string; typeId: string },
): Promise<string[]> {
  const fields = await listFields(workItem.workspaceId, {}, executor);
  if (fields.length === 0) return [];
  const values =
    (await loadValueMaps(executor, [workItem.id])).get(workItem.id) ?? {};
  return missingRequiredFields(
    fields,
    visibilityMap(fields, workItem.typeId),
    values,
  );
}

/**
 * GET /custom-fields/{id}/non-compliant-items: items of types where the field is required that
 * lack a value. Restricted to the projects the caller reaches.
 */
export async function nonCompliantItems(
  field: MaterializedField,
  workspaceId: string,
  reachableProjectIds: readonly string[],
  limit: number,
) {
  const requiredTypeIds = field.visibility
    .filter((row) => row.visible && row.required)
    .map((row) => row.workItemTypeId);
  if (requiredTypeIds.length === 0 || reachableProjectIds.length === 0)
    return [];
  // The "no value" test runs in SQL (`isValueSet` inverted), so the page is filled with items that
  // really lack a value instead of the first N items of which most may be compliant. Pages walk
  // (project, number) in order; only the visibility condition is still applied in memory.
  const value = customFieldValueTable.value;
  const emptyValue = sql`(
    ${value} IS NULL
    OR jsonb_typeof(${value}) = 'null'
    OR (jsonb_typeof(${value}) = 'string' AND (${value} #>> '{}') ~ '^\\s*$')
    OR (jsonb_typeof(${value}) = 'array' AND jsonb_array_length(${value}) = 0)
  )`;
  const pageSize = Math.max(limit * 2, 100);
  const scanBudget = 20_000;
  const found: {
    id: string;
    key: string;
    title: string;
    projectId: string;
  }[] = [];
  let after: { projectId: string; number: number } | null = null;
  for (let scanned = 0; scanned < scanBudget && found.length < limit; ) {
    const page: {
      id: string;
      key: string;
      title: string;
      projectId: string;
      number: number;
    }[] = await db
      .select({
        id: workItemTable.id,
        key: workItemTable.key,
        title: workItemTable.title,
        projectId: workItemTable.projectId,
        number: workItemTable.number,
      })
      .from(workItemTable)
      .leftJoin(
        customFieldValueTable,
        and(
          eq(customFieldValueTable.customFieldId, field.id),
          eq(customFieldValueTable.entityType, "work_item"),
          eq(customFieldValueTable.entityId, workItemTable.id),
        ),
      )
      .where(
        and(
          eq(workItemTable.workspaceId, workspaceId),
          inArray(workItemTable.typeId, requiredTypeIds),
          inArray(workItemTable.projectId, [...reachableProjectIds]),
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
          emptyValue,
          after
            ? sql`(${workItemTable.projectId}, ${workItemTable.number}) > (${after.projectId}, ${after.number})`
            : undefined,
        ),
      )
      .orderBy(asc(workItemTable.projectId), asc(workItemTable.number))
      .limit(pageSize);
    if (page.length === 0) break;
    scanned += page.length;
    let missing = page;
    if (field.visibilityCondition) {
      const controllerValues = await loadValueMaps(
        db,
        missing.map((row) => row.id),
      );
      missing = missing.filter((row) =>
        conditionSatisfied(
          field.visibilityCondition,
          controllerValues.get(row.id) ?? {},
        ),
      );
    }
    for (const row of missing) {
      if (found.length >= limit) break;
      found.push({
        id: row.id,
        key: row.key,
        title: row.title,
        projectId: row.projectId,
      });
    }
    const last = page[page.length - 1];
    if (!last || page.length < pageSize) break;
    after = { projectId: last.projectId, number: last.number };
  }
  return found;
}

export type { FieldDefinition };
