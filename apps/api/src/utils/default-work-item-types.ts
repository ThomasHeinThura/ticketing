/**
 * The default `work_item_type` rows every workspace is seeded with, exactly as
 * `docs/03-features/work-items.md` § "Default types" names them: "Seeded per workspace,
 * all editable."
 *
 *   | Category | Types |
 *   | --- | --- |
 *   | Service  | Incident · Service Request · Change · Problem |
 *   | Delivery | Epic · Story · Task · Bug · Sub-task |
 *
 * Pure data, no I/O -- issue #309 (PR-17). `workflowId`/`slaPolicyId` are deliberately
 * left unset: `work_item_type.workflow_id`/`.sla_policy_id` are plain nullable columns
 * with NO foreign key yet (`workflow` and `sla_policy` are P2/P5 scope and do not exist
 * in this schema -- `schema.ts`'s own comment on `workItemTypeTable`). "A type carries
 * its workflow" (issue #309's own framing) therefore has nothing to point at today; there
 * is no default workflow to invent, and none is created here. `WI-4`'s own comment in
 * `create-work-item.ts` already flags the "leaveable state" validation this implies as a
 * TODO for the future workflow-engine slice, not an omission in this one.
 */
export type DefaultWorkItemTypeCategory = "service" | "delivery";

export type DefaultWorkItemType = {
  /** Unique per workspace (`work_item_type_workspace_key_unique`). */
  key: string;
  name: string;
  category: DefaultWorkItemTypeCategory;
  isEpic?: boolean;
  isChange?: boolean;
};

export const DEFAULT_WORK_ITEM_TYPES: readonly DefaultWorkItemType[] = [
  { key: "incident", name: "Incident", category: "service" },
  { key: "service-request", name: "Service Request", category: "service" },
  // `is_change` "drives CAB rules -- never matched by type name" (data-model.md §4).
  { key: "change", name: "Change", category: "service", isChange: true },
  { key: "problem", name: "Problem", category: "service" },
  { key: "epic", name: "Epic", category: "delivery", isEpic: true },
  { key: "story", name: "Story", category: "delivery" },
  { key: "task", name: "Task", category: "delivery" },
  { key: "bug", name: "Bug", category: "delivery" },
  { key: "sub-task", name: "Sub-task", category: "delivery" },
] as const;
