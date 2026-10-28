/**
 * Destination facts the pure resolver needs (`resolveRecord`): custom field keys by id, the state to
 * use for each mapped state group, and the email of each mapped target person. Loaded once per run
 * step (a dry run, a chunk) so a page of records resolves with no per-record queries.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "../../database";
import type { Executor } from "../../database/executor";
import { customFieldTable } from "../../database/migration-schema";
import { STATE_GROUPS, type StateGroup } from "./adapter";
import type { MappingEntry, ResolveContext } from "./mapping";

export async function loadResolveContext(
  executor: Executor,
  run: { workspaceId: string; projectId: string },
  entries: readonly MappingEntry[],
): Promise<Required<ResolveContext>> {
  const targetIds = (domain: MappingEntry["domain"]) => [
    ...new Set(
      entries.flatMap((entry) =>
        entry.domain === domain &&
        entry.status === "confirmed" &&
        entry.target?.kind === "target"
          ? [entry.target.id]
          : [],
      ),
    ),
  ];

  const customFieldKeyById = new Map<string, string>();
  const fieldIds = targetIds("custom_field");
  if (fieldIds.length) {
    const rows = await executor
      .select({ id: customFieldTable.id, key: customFieldTable.key })
      .from(customFieldTable)
      .where(
        and(
          eq(customFieldTable.workspaceId, run.workspaceId),
          eq(customFieldTable.entityType, "work_item"),
          isNull(customFieldTable.deletedAt),
          inArray(customFieldTable.id, fieldIds),
        ),
      );
    for (const row of rows) customFieldKeyById.set(row.id, row.key);
  }

  const personEmailById = new Map<string, string>();
  const personIds = targetIds("person");
  if (personIds.length) {
    const rows = await executor
      .select({ id: schema.personTable.id, email: schema.userTable.email })
      .from(schema.personTable)
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .where(inArray(schema.personTable.id, personIds));
    for (const row of rows) personEmailById.set(row.id, row.email);
  }

  const stateIdByGroup = new Map<StateGroup, string>();
  const needsStates = entries.some(
    (entry) =>
      entry.domain === "state" &&
      entry.status === "confirmed" &&
      entry.target?.kind === "group",
  );
  if (needsStates) {
    const rows = await executor
      .select({
        id: schema.stateTable.id,
        group: schema.stateTemplateTable.group,
      })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(
        and(
          eq(schema.stateTable.projectId, run.projectId),
          isNull(schema.stateTable.archivedAt),
        ),
      )
      .orderBy(
        desc(schema.stateTable.isDefault),
        asc(schema.stateTable.position),
        asc(schema.stateTable.createdAt),
        asc(schema.stateTable.id),
      );
    for (const row of rows)
      if (
        (STATE_GROUPS as readonly string[]).includes(row.group) &&
        !stateIdByGroup.has(row.group as StateGroup)
      )
        stateIdByGroup.set(row.group as StateGroup, row.id);
  }
  return { customFieldKeyById, personEmailById, stateIdByGroup };
}
