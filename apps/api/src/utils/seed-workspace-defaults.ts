import db, { schema } from "../database";
import { DEFAULT_STATE_TEMPLATES } from "./default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "./default-work-item-types";

/**
 * Seeds a freshly created workspace's default `work_item_type` and `state_template`
 * rows (issue #309, `work-items.md` § "Default types", `PR-17`). Without this, no work
 * item can ever be created in a fresh workspace -- `WI-1` requires a `work_item_type`
 * and `WI-4` requires a project default `state`, and nothing else creates either one.
 *
 * Called from `create-workspace.ts`'s own transaction, so the seed rows commit or roll
 * back together with the workspace itself -- exactly like the default `workspace_role`
 * rows and default team it already seeds in the same place, and for the same reason
 * (that function's own doc comment).
 *
 * Idempotent via each table's existing `unique(workspace_id, key)` index
 * (`work_item_type_workspace_key_unique`, `state_template_workspace_key_unique`) plus
 * `onConflictDoNothing` -- calling this twice for the same workspace inserts nothing the
 * second time. No new migration is needed: both constraints already exist.
 *
 * Takes an optional `dbOrTx` (defaulting to the module's own `db`), the same shape
 * `ensureInternalOrganisation` uses, so a caller already inside a transaction can pass
 * its `tx` and get these inserts covered by the same commit/rollback boundary.
 */
export async function seedWorkspaceDefaults(
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

export default seedWorkspaceDefaults;
