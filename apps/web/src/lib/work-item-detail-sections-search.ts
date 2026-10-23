import { isWorkItemHierarchyKey } from "./work-item-hierarchy-search";

export type WorkItemDetailSection = "sla" | "approvals" | "attachments";
export type WorkItemDetailSectionsSearch = {
  sections?: { itemKey: string; open: WorkItemDetailSection[] };
};
const SECTIONS = ["sla", "approvals", "attachments"] as const;

/** Item-scoped, bounded disclosure state for canonical Kaneo task extensions. */
export function parseWorkItemDetailSectionsSearch(
  raw: unknown,
): WorkItemDetailSectionsSearch {
  if (!raw || typeof raw !== "object") return {};
  let value = (raw as Record<string, unknown>).sections;
  if (typeof value === "string") {
    if (value.length > 1024) return {};
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  if (
    !isWorkItemHierarchyKey(input.itemKey) ||
    !Array.isArray(input.open) ||
    input.open.length > 3 ||
    input.open.some(
      (section) => !SECTIONS.includes(section as WorkItemDetailSection),
    )
  )
    return {};
  const open = [...new Set(input.open)] as WorkItemDetailSection[];
  return open.length ? { sections: { itemKey: input.itemKey, open } } : {};
}
