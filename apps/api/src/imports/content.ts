import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "../database";
import type { Transaction } from "../database/executor";
import type { ImportItem } from "./schema";

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, member]) => [key, canonicalValue(member)]),
    );
  }
  return value;
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

export function normalizeImportItem(
  item: ImportItem,
  defaultAssigneeId: string | null,
) {
  return {
    typeId: item.typeId,
    title: item.title,
    description: item.description ?? null,
    priority: item.priority ?? null,
    startDate: item.startDate?.toISOString() ?? null,
    dueDate: item.dueDate?.toISOString() ?? null,
    labelIds: [...(item.labelIds ?? [])].sort(),
    assigneeId: item.assigneeId ?? defaultAssigneeId,
  };
}

export async function readWorkItemContentHash(
  tx: Transaction,
  input: { workspaceId: string; projectId: string; targetId: string },
): Promise<{
  hash: string;
  row: typeof schema.workItemTable.$inferSelect;
  labelIds: string[];
} | null> {
  const [row] = await tx
    .select()
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.id, input.targetId),
        eq(schema.workItemTable.workspaceId, input.workspaceId),
        eq(schema.workItemTable.projectId, input.projectId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!row) return null;
  const labels = await tx
    .select({ id: schema.labelTable.id })
    .from(schema.workItemLabelTable)
    .innerJoin(
      schema.labelTable,
      eq(schema.labelTable.id, schema.workItemLabelTable.labelId),
    )
    .where(eq(schema.workItemLabelTable.workItemId, row.id))
    .orderBy(schema.labelTable.id);
  const labelIds = labels.map((label) => label.id);
  const hash = sha256Canonical({
    typeId: row.typeId,
    title: row.title,
    description: row.description,
    priority: row.priority,
    startDate: row.startDate,
    dueDate: row.dueDate,
    labelIds,
    assigneeId: row.assigneeId,
  });
  return { hash, row, labelIds };
}

export function normalizeImportItemAgainstCurrent(
  item: ImportItem,
  current: {
    row: typeof schema.workItemTable.$inferSelect;
    labelIds: string[];
  },
) {
  return {
    typeId: item.typeId,
    title: item.title,
    description:
      item.description === undefined
        ? current.row.description
        : (item.description ?? null),
    priority:
      item.priority === undefined ? current.row.priority : item.priority,
    startDate:
      item.startDate === undefined
        ? current.row.startDate
        : (item.startDate?.toISOString() ?? null),
    dueDate:
      item.dueDate === undefined
        ? current.row.dueDate
        : (item.dueDate?.toISOString() ?? null),
    labelIds:
      item.labelIds === undefined
        ? current.labelIds
        : [...item.labelIds].sort(),
    assigneeId:
      item.assigneeId === undefined ? current.row.assigneeId : item.assigneeId,
  };
}
