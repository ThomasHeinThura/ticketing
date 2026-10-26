import { and, eq, isNull, sql } from "drizzle-orm";
import {
  applyWorkItemFieldValues,
  CustomFieldValidationError,
} from "../../custom-field/repository";
import { schema } from "../../database";
import type { ImportRecord } from "../schema";
import { type ImportWriterContext, recordLoss } from "./types";

const WORK_ITEM = schema.workItemTable;
const STATE = schema.stateTable;

/**
 * Put a newly imported item into the operator-mapped state (first import only, so a rerun never
 * undoes progress made in TaskDesk). The state must belong to the target project and be live; an
 * unknown or archived one is reported (`state_unmapped`) and the item keeps its default state.
 * No workflow transition runs: an import places history, it does not replay a workflow.
 */
export async function applyImportedState(
  ctx: ImportWriterContext,
  input: { workItemId: string; record: ImportRecord },
) {
  const stateId = input.record.stateId;
  if (!stateId) return;
  const [state] = await ctx.tx
    .select({ id: STATE.id })
    .from(STATE)
    .where(
      and(
        eq(STATE.id, stateId),
        eq(STATE.projectId, ctx.projectId),
        isNull(STATE.archivedAt),
      ),
    )
    .limit(1);
  if (!state) {
    recordLoss(ctx, {
      code: "state_unmapped",
      sourceType: input.record.sourceType,
      sourceId: input.record.sourceId,
      entity: "work_item",
    });
    return;
  }
  await ctx.tx
    .update(WORK_ITEM)
    .set({ stateId: state.id, version: sql`${WORK_ITEM.version} + 1` })
    .where(
      and(
        eq(WORK_ITEM.id, input.workItemId),
        eq(WORK_ITEM.workspaceId, ctx.workspaceId),
      ),
    );
}

/**
 * Write custom field values through the same routine as the native route
 * (`applyWorkItemFieldValues`): a value is accepted only for a field that applies to the item's
 * type, validated by the field's format, and the stored row is exactly what the native write
 * produces. One field at a time in its own savepoint, so a value that does not fit is reported
 * (`custom_field_unmapped` when the key is unknown or not available for the type,
 * `custom_field_invalid` when the value is wrong) and the rest still import. Used on first import
 * only, so a rerun never overwrites an edit made in TaskDesk.
 */
export async function applyImportedCustomFields(
  ctx: ImportWriterContext,
  input: { workItemId: string; record: ImportRecord },
) {
  const { record } = input;
  const entries = record.customFields ?? [];
  if (!entries.length) return;
  const [item] = await ctx.tx
    .select({ typeId: WORK_ITEM.typeId })
    .from(WORK_ITEM)
    .where(eq(WORK_ITEM.id, input.workItemId))
    .limit(1);
  if (!item) return;
  for (const entry of entries) {
    try {
      await ctx.tx.transaction(async (savepoint) => {
        await applyWorkItemFieldValues(
          savepoint,
          {
            id: input.workItemId,
            workspaceId: ctx.workspaceId,
            projectId: ctx.projectId,
            typeId: item.typeId,
          },
          { [entry.key]: entry.value },
          { create: false, enforceRequired: false },
        );
      });
    } catch (error) {
      const unavailable =
        error instanceof CustomFieldValidationError &&
        error.problems.some((problem) =>
          problem.message.startsWith("Not available"),
        );
      recordLoss(ctx, {
        code: unavailable ? "custom_field_unmapped" : "custom_field_invalid",
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "custom_field",
        entitySourceId: entry.key,
      });
    }
  }
}
