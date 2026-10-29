import { normalizeCanonicalWorkItemSelection } from "./normalize-canonical-work-item-selection";
import { parseProjectViewSearch } from "./project-board-search";
import { parseWorkItemQueryState } from "./work-item-list-search";

export function parseLegacyProjectViewSearch(raw: unknown) {
  const normalized = normalizeCanonicalWorkItemSelection(raw);
  return {
    ...parseProjectViewSearch(raw),
    ...parseWorkItemQueryState(normalized),
  };
}
