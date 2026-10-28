export const HIERARCHY_URL_MAX_LENGTH = 8192;
export const HIERARCHY_URL_MAX_ENTRIES = 32;
export const HIERARCHY_AUTO_RESTORE_PAGES = 3;

/** URL state for the existing work-item detail's inline hierarchy, including side panes. */
export type HierarchyUrlState = {
  itemKey: string;
  collapsed?: true;
  mode?: "tree";
  expanded?: string[];
  pages?: Record<string, number>;
};
export type WorkItemHierarchySearch = { hierarchy?: HierarchyUrlState };
export const isWorkItemHierarchyKey = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= HIERARCHY_URL_MAX_LENGTH &&
  Array.from(value).every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  }) &&
  /^.+-[1-9]\d*$/u.test(value);

export function parseWorkItemHierarchySearch(
  raw: unknown,
): WorkItemHierarchySearch {
  if (!raw || typeof raw !== "object") return {};
  let input = (raw as Record<string, unknown>).hierarchy;
  if (typeof input === "string") {
    if (input.length > HIERARCHY_URL_MAX_LENGTH) return {};
    try {
      input = JSON.parse(input);
    } catch {
      return {};
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  try {
    if (JSON.stringify(input).length > HIERARCHY_URL_MAX_LENGTH) return {};
  } catch {
    return {};
  }
  if (
    Object.getPrototypeOf(input) !== Object.prototype &&
    Object.getPrototypeOf(input) !== null
  )
    return {};
  const value = input as Record<string, unknown>;
  if (
    !isWorkItemHierarchyKey(value.itemKey) ||
    Object.keys(value).some((k) =>
      ["__proto__", "constructor", "prototype"].includes(k),
    )
  )
    return {};
  if (
    Array.isArray(value.expanded) &&
    value.expanded.length > HIERARCHY_URL_MAX_ENTRIES
  )
    return {};
  if (value.pages && typeof value.pages === "object") {
    if (
      Array.isArray(value.pages) ||
      Object.keys(value.pages).length > HIERARCHY_URL_MAX_ENTRIES ||
      (Object.getPrototypeOf(value.pages) !== Object.prototype &&
        Object.getPrototypeOf(value.pages) !== null) ||
      Object.keys(value.pages).some((k) =>
        ["__proto__", "constructor", "prototype"].includes(k),
      )
    )
      return {};
  }
  const expanded =
    Array.isArray(value.expanded) &&
    value.expanded.every(isWorkItemHierarchyKey)
      ? [...new Set(value.expanded)]
      : undefined;
  const pages =
    value.pages &&
    typeof value.pages === "object" &&
    !Array.isArray(value.pages)
      ? Object.fromEntries(
          Object.entries(value.pages).filter(
            ([k, n]) =>
              isWorkItemHierarchyKey(k) &&
              typeof n === "number" &&
              Number.isSafeInteger(n) &&
              n > 1,
          ),
        )
      : undefined;
  return {
    hierarchy: {
      itemKey: value.itemKey,
      ...(value.mode === "tree" ? { mode: "tree" as const } : {}),
      ...(value.collapsed === true ? { collapsed: true } : {}),
      ...(expanded ? { expanded } : {}),
      ...(pages && Object.keys(pages).length
        ? { pages: pages as Record<string, number> }
        : {}),
    },
  };
}
