import db, { schema } from "../database";
import { DEFAULT_STATE_TEMPLATES } from "./default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "./default-work-item-types";

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
  dbOrTx: Pick<typeof db, "insert"> = db,
): Promise<void> {
  await dbOrTx
    .insert(schema.workItemTypeTable)
    .values(
      DEFAULT_WORK_ITEM_TYPES.map((type) => ({
        workspaceId,
        key: type.key,
        name: type.name,
        category: type.category,
        isEpic: type.isEpic ?? false,
        isChange: type.isChange ?? false,
      })),
    )
    .onConflictDoNothing({
      target: [
        schema.workItemTypeTable.workspaceId,
        schema.workItemTypeTable.key,
      ],
    });
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
  dbOrTx: Pick<typeof db, "insert"> = db,
): Promise<void> {
  await dbOrTx
    .insert(schema.stateTemplateTable)
    .values(
      DEFAULT_STATE_TEMPLATES.map((template) => ({
        workspaceId,
        key: template.key,
        name: template.name,
        group: template.group,
      })),
    )
    .onConflictDoNothing({
      target: [
        schema.stateTemplateTable.workspaceId,
        schema.stateTemplateTable.key,
      ],
    });
}

/**
 * Seeds a freshly created workspace's default `work_item_type` AND `state_template`
 * rows together (issue #309, `work-items.md` § "Default types", `PR-17`). Without this,
 * no work item can ever be created in a fresh workspace -- `WI-1` requires a
 * `work_item_type` and `WI-4` requires a project default `state`, and nothing else
 * creates either one.
 *
 * Called from `create-workspace.ts`'s own transaction, so the seed rows commit or roll
 * back together with the workspace itself -- exactly like the default `workspace_role`
 * rows and default team it already seeds in the same place, and for the same reason
 * (that function's own doc comment). **`dbOrTx` must be a transaction whenever this
 * function's own two inserts need to succeed or fail together** -- `onConflictDoNothing`
 * on each table's `unique(workspace_id, key)` index only makes EACH insert idempotent on
 * its own; it does nothing to stop a crash between the two inserts from committing types
 * without templates (or the reverse) when `dbOrTx` is the plain, autocommitting `db`.
 * `create-workspace.ts` already passes its own `tx` for exactly this reason. Issue #316's
 * backfill originally called this with the default `db` and reproduced that half-seeded
 * state live under an injected failure -- see `backfill-workspace-project-defaults.ts`'s
 * own comment for how its per-workspace transaction now covers this.
 *
 * Idempotent via each table's existing `unique(workspace_id, key)` index plus
 * `onConflictDoNothing` -- calling this twice for the same workspace, inside the SAME
 * transaction both times (or as two separate calls that each commit), inserts nothing
 * the second time. No new migration is needed: both constraints already exist.
 *
 * Takes an optional `dbOrTx` (defaulting to the module's own `db`), the same shape
 * `ensureInternalOrganisation` uses, so a caller already inside a transaction can pass
 * its `tx` and get these inserts covered by the same commit/rollback boundary.
 */
export async function seedWorkspaceDefaults(
  workspaceId: string,
  dbOrTx: Pick<typeof db, "insert"> = db,
): Promise<void> {
  await seedDefaultWorkItemTypes(workspaceId, dbOrTx);
  await seedDefaultStateTemplates(workspaceId, dbOrTx);
}

export default seedWorkspaceDefaults;
