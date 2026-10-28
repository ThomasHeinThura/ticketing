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
 *
 * SLA design (import-and-cutover.md "Timestamps preserved", feature-contracts-p2 SLA-8/WF-17):
 * an imported item never carries a live SLA clock. `createWorkItemInTransaction` is called with
 * `sla: "none"`, so no policy version is pinned and the SLA scan never evaluates, breaches or
 * escalates a historical item, open or closed. What is still recorded, so every reader sees the
 * item as the source had it, is the lifecycle the workflow would have written: entering the
 * `completed` group sets `resolved_at` (WF-17; the source resolved time, else the source
 * updated/created time, never later than the import) and `first_response_at` (no later than
 * `resolved_at`). `cancelled` is not resolved (WF-17: a cancelled item was never resolved), so
 * it keeps `resolved_at` NULL exactly like a native cancel; the state group alone closes it.
 * Agile progress and portal status read the state group and `resolved_at`; reopen reads
 * `resolved_at`.
 */
export async function applyImportedState(
  ctx: ImportWriterContext,
  input: { workItemId: string; record: ImportRecord },
) {
  const stateId = input.record.stateId;
  if (!stateId) return;
  const [state] = await ctx.tx
    .select({ id: STATE.id, group: schema.stateTemplateTable.group })
    .from(STATE)
    .innerJoin(
      schema.stateTemplateTable,
      eq(schema.stateTemplateTable.id, STATE.stateTemplateId),
    )
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
  const resolvedAt =
    state.group === "completed" ? importedResolvedAt(ctx, input.record) : null;
  await ctx.tx
    .update(WORK_ITEM)
    .set({
      stateId: state.id,
      version: sql`${WORK_ITEM.version} + 1`,
      ...(resolvedAt ? { resolvedAt, firstResponseAt: resolvedAt } : {}),
    })
    .where(
      and(
        eq(WORK_ITEM.id, input.workItemId),
        eq(WORK_ITEM.workspaceId, ctx.workspaceId),
      ),
    );
}

/** Source resolved time, else source updated, else source created, else now; never in the future. */
function importedResolvedAt(ctx: ImportWriterContext, record: ImportRecord) {
  for (const value of [
    record.sourceResolvedAt,
    record.sourceUpdatedAt,
    record.sourceCreatedAt,
  ]) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()))
      return parsed.getTime() > ctx.now.getTime() ? ctx.now : parsed;
  }
  return ctx.now;
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
