import type db from "../database";
import { type Executor, executorOrDefault } from "../database/executor";
import { DEFAULT_STATE_TEMPLATES } from "./default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "./default-work-item-types";
import { seedDefaultWorkflowInTransaction } from "./seed-default-workflow";
import { lockWorkspaceDefaults } from "./seed-default-workflow.repository";
import {
  insertDefaultStateTemplateRows,
  insertDefaultWorkItemTypeRows,
} from "./seed-defaults.repository";

/**
 * Seeds only the default `work_item_type` rows (issue #309, `work-items.md` § "Default
 * types"). Split out from `seedWorkspaceDefaults` below for issue #316's backfill, which
 * needs to seed this kind independently of `state_template` -- a workspace may already
 * have its own custom types but no templates, or vice versa, and #316's acceptance
 * criteria say never to add defaults of a kind the workspace already has any row of.
 *
 * Idempotent via `work_item_type_workspace_key_unique` plus `onConflictDoNothing` --
 * calling this twice for the same workspace inserts nothing the second time. That index
 * only protects each ROW; it does nothing for a caller that inserts types and templates
 * as two separate statements outside a shared transaction and crashes in between -- see
 * `seedWorkspaceDefaults`'s own comment for why every caller must pass a `tx` that also
 * covers the sibling `seedDefaultStateTemplates` call.
 */
export async function seedDefaultWorkItemTypes(
  workspaceId: string,
  dbOrTx: Pick<typeof db, "insert"> = executorOrDefault(),
): Promise<void> {
  await insertDefaultWorkItemTypeRows(
    dbOrTx,
    DEFAULT_WORK_ITEM_TYPES.map((type) => ({
      workspaceId,
      key: type.key,
      name: type.name,
      category: type.category,
      isEpic: type.isEpic ?? false,
      isChange: type.isChange ?? false,
    })),
  );
}

/**
 * Seeds only the default `state_template` rows (issue #309, `work-items.md` §
 * "Default types", `PR-17`). See `seedDefaultWorkItemTypes`'s own comment for why this
 * is split out separately, and `seedWorkspaceDefaults`'s for the atomicity requirement
 * that applies to both.
 *
 * Idempotent via `state_template_workspace_key_unique` plus `onConflictDoNothing`.
 */
export async function seedDefaultStateTemplates(
  workspaceId: string,
  dbOrTx: Pick<typeof db, "insert"> = executorOrDefault(),
): Promise<void> {
  await insertDefaultStateTemplateRows(
    dbOrTx,
    DEFAULT_STATE_TEMPLATES.map((template) => ({
      workspaceId,
      key: template.key,
      name: template.name,
      group: template.group,
    })),
  );
}

/** Seeds templates, builtin types and their validated default workflow atomically.
 * The workspace lock serializes bootstrap/repair; configured customer rows are preserved.
 * An existing transaction receives a savepoint; standalone calls get a real transaction.
 */
export async function seedWorkspaceDefaults(
  workspaceId: string,
  dbOrTx: Executor = executorOrDefault(),
): Promise<void> {
  await dbOrTx.transaction(async (tx) => {
    // One lock order covers concurrent bootstrap and explicit default-workflow repair.
    await lockWorkspaceDefaults(tx, workspaceId);
    await seedDefaultStateTemplates(workspaceId, tx);
    await seedDefaultWorkItemTypes(workspaceId, tx);
    await seedDefaultWorkflowInTransaction(workspaceId, tx);
  });
}

export default seedWorkspaceDefaults;
