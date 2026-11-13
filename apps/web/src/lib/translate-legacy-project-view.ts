import { parseLegacyProjectViewSearch } from "./legacy-project-view";
import { routes } from "./routes";
import { parseWorkItemFilterText } from "./work-item-filter";
import {
  isValidWorkItemKeyParam,
  parseWorkItemListSearch,
} from "./work-item-list-search";

/** Translate only equivalent controls; callers must acknowledge every unsupported one. */
export function translateLegacyProjectView(
  raw: unknown,
  projectKey: string,
  view: "board" | "backlog",
) {
  const legacy = parseLegacyProjectViewSearch(raw);
  const search = parseWorkItemListSearch({
    ...legacy,
    layout: legacy.layout ?? "board",
    sort: legacy.sort === "number" ? "key" : (legacy.sort ?? "position"),
  });
  const unsupported: string[] = [];
  for (const key of ["q", "status", "assignee", "labels", "dueDate"] as const) {
    if (legacy[key]?.length) unsupported.push(key);
  }
  if (legacy.sort === "createdAt") unsupported.push("sort");
  if (legacy.priority?.length) {
    if (
      legacy.priority.every((value) =>
        ["low", "medium", "high", "urgent"].includes(value),
      )
    ) {
      const priority = `priority:in(${legacy.priority.join(",")})`;
      try {
        if (search.filter) parseWorkItemFilterText(search.filter);
        const combined = search.filter
          ? `AND(${search.filter},${priority})`
          : priority;
        if (combined.length <= 8192) search.filter = combined;
        else unsupported.push("priority");
      } catch {
        unsupported.push("priority");
      }
    } else unsupported.push("priority");
  }
  const selected = search.item;
  for (const name of ["hierarchy", "relations"] as const) {
    if (search[name] && selected && search[name]?.itemKey !== selected)
      delete search[name];
  }
  const href = routes.workItemList.build({ projectKey }, search);
  return {
    href: view === "backlog" ? href.replace(/\/work\?/u, "/backlog?") : href,
    unsupported,
    legacyTaskId:
      legacy.taskId && !isValidWorkItemKeyParam(legacy.taskId)
        ? legacy.taskId
        : undefined,
  };
}
