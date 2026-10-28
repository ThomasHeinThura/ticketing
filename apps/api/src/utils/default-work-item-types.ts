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
 * Pure catalogue data. Workspace bootstrap creates a validated, published default
 * workflow and attaches only builtin types that have no configured workflow. Existing
 * customer workflows and type configuration remain authoritative.
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
