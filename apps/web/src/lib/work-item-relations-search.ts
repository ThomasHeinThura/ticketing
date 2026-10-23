import { isWorkItemHierarchyKey } from "./work-item-hierarchy-search";

export const RELATION_PICKER_TYPES = [
  "relates",
  "blocks",
  "blocked_by",
  "duplicates",
  "duplicated_by",
  "precedes",
  "follows",
  "requires",
  "required_by",
] as const;
export type RelationPickerType = (typeof RELATION_PICKER_TYPES)[number];
export type RelationsUrlState = {
  itemKey: string;
  collapsed?: true;
  picker?: true;
  query?: string;
  type?: RelationPickerType;
};
export type WorkItemRelationsSearch = { relations?: RelationsUrlState };
export function parseWorkItemRelationsSearch(
  raw: unknown,
): WorkItemRelationsSearch {
  if (!raw || typeof raw !== "object") return {};
  let input = (raw as Record<string, unknown>).relations;
  if (typeof input === "string") {
    if (input.length > 2048) return {};
    try {
      input = JSON.parse(input);
    } catch {
      return {};
    }
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return {};
  const value = input as Record<string, unknown>;
  if (
    !isWorkItemHierarchyKey(value.itemKey) ||
    Object.keys(value).some((key) =>
      ["__proto__", "constructor", "prototype"].includes(key),
    )
  )
    return {};
  return {
    relations: {
      itemKey: value.itemKey,
      ...(value.collapsed === true ? { collapsed: true } : {}),
      ...(value.picker === true ? { picker: true } : {}),
      ...(typeof value.query === "string" &&
      value.query.length <= 200 &&
      Array.from(value.query).every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      }) &&
      value.query
        ? { query: value.query }
        : {}),
      ...(typeof value.type === "string" &&
      RELATION_PICKER_TYPES.includes(value.type as RelationPickerType)
        ? { type: value.type as RelationPickerType }
        : {}),
    },
  };
}
