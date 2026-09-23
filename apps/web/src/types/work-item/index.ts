import type { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";

/**
 * The wire shape of `GET /api/projects/{projectId}/work-items`
 * (`apps/api/src/work-item/response.ts`'s `workItemSchema`). Note what it does NOT carry,
 * relevant to this screen: `stateId` and `assigneeId` are raw foreign keys, not resolved
 * names -- there is no join/lookup here for a human-readable state label or assignee
 * display name. Flagged as an API gap in this pull request rather than guessed at.
 */
export type WorkItem = InferResponseType<
  (typeof client)["projects"][":projectId"]["work-items"]["$get"],
  200
>[number];

export type WorkItemPriority = "low" | "medium" | "high" | "urgent";

const VALID_PRIORITIES: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "urgent",
]);

/**
 * The fields this screen validates per row, beyond what `InferResponseType` already
 * guarantees at compile time. `InferResponseType` is a type assertion, not a runtime
 * check -- nothing actually validates that `response.json()` matches `workItemSchema`
 * at the wire boundary today, so a row with a blank title, an out-of-range priority
 * string or an unparseable `dueDate` would otherwise render silently wrong (an empty
 * link, "Invalid Date") rather than being visibly flagged.
 *
 * This is the "partial" state for this list (G6 / design-principles.md principle 7).
 * The list API returns every row or a single error for the whole request -- no
 * pagination, no per-row status (`fetchers/work-item/get-work-items.ts`) -- so a batch
 * response with "some records resolve, others error" isn't a real shape this API can
 * produce, and mocking one would invent an API this screen doesn't have. What genuinely
 * can happen per row is this: the row arrives, but one of the fields this screen
 * displays fails validation at this fetcher/type boundary. Each affected row still
 * renders with its valid fields; only the invalid ones are marked unavailable, rather
 * than the whole request being treated as failed.
 */
export type WorkItemField = "title" | "priority" | "dueDate";

export type WorkItemRow = WorkItem & {
  unavailableFields: WorkItemField[];
};

function hasValidTitle(title: unknown): title is string {
  return typeof title === "string" && title.trim().length > 0;
}

function hasValidPriority(
  priority: unknown,
): priority is WorkItemPriority | null {
  return (
    priority === null ||
    (typeof priority === "string" && VALID_PRIORITIES.has(priority))
  );
}

function hasValidDueDate(dueDate: unknown): dueDate is string | null {
  if (dueDate === null) return true;
  return typeof dueDate === "string" && !Number.isNaN(Date.parse(dueDate));
}

/**
 * Validates one raw row from `GET /api/projects/{projectId}/work-items` against the
 * fields this screen actually displays, marking any that fail as unavailable rather
 * than throwing or dropping the row. Pure -- never mutates its input.
 */
export function parseWorkItemRow(raw: WorkItem): WorkItemRow {
  const unavailableFields: WorkItemField[] = [];

  const validTitle = hasValidTitle(raw.title);
  if (!validTitle) unavailableFields.push("title");

  const validPriority = hasValidPriority(raw.priority);
  if (!validPriority) unavailableFields.push("priority");

  const validDueDate = hasValidDueDate(raw.dueDate);
  if (!validDueDate) unavailableFields.push("dueDate");

  return {
    ...raw,
    title: validTitle ? raw.title : "",
    priority: validPriority ? raw.priority : null,
    dueDate: validDueDate ? raw.dueDate : null,
    unavailableFields,
  };
}
