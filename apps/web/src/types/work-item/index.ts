import type { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";

/**
 * One row's wire shape from `GET /api/projects/{projectId}/work-items`
 * (`apps/api/src/work-item/response.ts`'s `workItemListItemSchema`). #310 changed the
 * route's response from a bare array to `{ data, page, meta }` (cursor pagination) and
 * added `stateName`/`stateCategory`/`assigneeName` alongside the raw `stateId`/
 * `assigneeId` -- this type now reads `["data"][number]`, and the two "raw foreign key,
 * no resolved name" gaps this comment used to flag are closed: `stateName`/
 * `stateCategory` are always present, and `assigneeName` is `null` exactly when
 * `assigneeId` is `null` OR the assignee has no linked display name (`response.ts`'s own
 * comment). This screen (`components/work-item/work-item-list.tsx`) does not switch its
 * State/Assignee columns over to the resolved names in this change -- out of scope here,
 * left for a follow-up -- it only needed this type to keep compiling against the new
 * envelope.
 */
export type WorkItem = InferResponseType<
  (typeof client)["projects"][":projectId"]["work-items"]["$get"],
  200
>["data"][number];

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
 *
 * `key` is also validated, not just trusted: every row link (`work-item-list.tsx`)
 * navigates using `item.key`, so an invalid key must not silently produce a broken or
 * misleading link. The API's own documented shape (`apps/api/src/work-item/index.ts`,
 * `claim-work-item-number.ts`'s `WI-2`) is `{project.slug}-{number}`, so a row's key is
 * checked against that shape AND cross-checked against that same row's own `number`
 * field -- a key whose trailing number doesn't match `row.number` is exactly as
 * untrustworthy as one with no trailing number at all.
 */
export type WorkItemField = "key" | "title" | "priority" | "dueDate";

export type WorkItemRow = WorkItem & {
  unavailableFields: WorkItemField[];
};

const KEY_SHAPE = /^(.+)-(\d+)$/;

function hasValidKey(key: unknown, number: unknown): key is string {
  if (typeof key !== "string") return false;
  const match = KEY_SHAPE.exec(key);
  if (!match) return false;
  if (typeof number !== "number" || !Number.isFinite(number)) return false;
  return Number(match[2]) === number;
}

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

  const validKey = hasValidKey(raw.key, raw.number);
  if (!validKey) unavailableFields.push("key");

  const validTitle = hasValidTitle(raw.title);
  if (!validTitle) unavailableFields.push("title");

  const validPriority = hasValidPriority(raw.priority);
  if (!validPriority) unavailableFields.push("priority");

  const validDueDate = hasValidDueDate(raw.dueDate);
  if (!validDueDate) unavailableFields.push("dueDate");

  return {
    ...raw,
    key: validKey ? raw.key : "",
    title: validTitle ? raw.title : "",
    priority: validPriority ? raw.priority : null,
    dueDate: validDueDate ? raw.dueDate : null,
    unavailableFields,
  };
}
