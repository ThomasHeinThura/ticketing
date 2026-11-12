import { isValidWorkItemKeyParam } from "./work-item-list-search";

/** A schedule selection is a permanent key; a legacy UUID is never treated as one. */
export function normalizeCanonicalWorkItemSelection(raw: unknown) {
  const candidate =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return !isValidWorkItemKeyParam(candidate.item) &&
    isValidWorkItemKeyParam(candidate.taskId)
    ? { ...candidate, item: candidate.taskId }
    : candidate;
}
