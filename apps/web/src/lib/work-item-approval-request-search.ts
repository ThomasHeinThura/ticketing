import { isWorkItemHierarchyKey } from "./work-item-hierarchy-search";

export type ApprovalRequestUrlState = {
  itemKey: string;
  open: true;
  kind?: "customer" | "cab";
  transitionId?: string;
  query?: string;
};
export type WorkItemApprovalRequestSearch = {
  approvalRequest?: ApprovalRequestUrlState;
};
export function parseWorkItemApprovalRequestSearch(
  raw: unknown,
): WorkItemApprovalRequestSearch {
  if (!raw || typeof raw !== "object") return {};
  let input = (raw as Record<string, unknown>).approvalRequest;
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
    value.open !== true ||
    Object.keys(value).some((key) =>
      ["__proto__", "constructor", "prototype"].includes(key),
    )
  )
    return {};
  const safe = (text: unknown, max: number): text is string =>
    typeof text === "string" &&
    text.length > 0 &&
    text.length <= max &&
    Array.from(text).every(
      (character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    );
  return {
    approvalRequest: {
      itemKey: value.itemKey,
      open: true,
      ...(value.kind === "customer" || value.kind === "cab"
        ? { kind: value.kind }
        : {}),
      ...(safe(value.transitionId, 256)
        ? { transitionId: value.transitionId }
        : {}),
      ...(safe(value.query, 200) ? { query: value.query } : {}),
    },
  };
}
