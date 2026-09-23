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

/**
 * The wire shape of `GET /api/work-items/{key}` -- the same shape as a list row plus the
 * display fields the detail route resolves server-side
 * (`apps/api/src/work-item/controllers/get-work-item.ts`, same names/semantics as the
 * list route's resolution): `stateName`, `stateCategory` and `assigneeName`.
 * `assigneeName` is null when the item is unassigned, when the assignee is a placeholder
 * person with no linked user, or when the assignee's user is not a member of this work
 * item's workspace -- in every case the raw `assigneeId` is still present, so this
 * screen can tell "assigned, name not resolvable" apart from "unassigned".
 */
export type WorkItemDetail = InferResponseType<
  (typeof client)["work-items"][":key"]["$get"],
  200
>;

export type WorkItemDetailField =
  | "key"
  | "title"
  | "priority"
  | "dueDate"
  | "stateName";

export type WorkItemDetailRow = WorkItemDetail & {
  unavailableFields: WorkItemDetailField[];
};

/**
 * Validates one raw `GET /api/work-items/{key}` response against the fields the detail
 * page displays, marking any that fail as unavailable rather than throwing -- the same
 * boundary principle `parseWorkItemRow` applies to list rows (see its own comment for
 * why this validation exists rather than trusting `InferResponseType`). `stateName`
 * joins the list's four fields for the same reason they are checked there: the header
 * renders it, and a blank state name would otherwise render as an indistinct empty
 * badge rather than a visible "Unavailable".
 */
export function parseWorkItemDetailRow(raw: WorkItemDetail): WorkItemDetailRow {
  const unavailableFields: WorkItemDetailField[] = [];

  const validKey = hasValidKey(raw.key, raw.number);
  if (!validKey) unavailableFields.push("key");

  const validTitle = hasValidTitle(raw.title);
  if (!validTitle) unavailableFields.push("title");

  const validPriority = hasValidPriority(raw.priority);
  if (!validPriority) unavailableFields.push("priority");

  const validDueDate = hasValidDueDate(raw.dueDate);
  if (!validDueDate) unavailableFields.push("dueDate");

  const validStateName =
    typeof raw.stateName === "string" && raw.stateName.trim().length > 0;
  if (!validStateName) unavailableFields.push("stateName");

  return {
    ...raw,
    key: validKey ? raw.key : "",
    title: validTitle ? raw.title : "",
    priority: validPriority ? raw.priority : null,
    dueDate: validDueDate ? raw.dueDate : null,
    unavailableFields,
  };
}

/**
 * What the detail page can render for `work_item.description`.
 *
 * `work_item.description` is opaque `jsonb` (`apps/api/src/work-item/schema.ts`): today
 * that means `null`, a plain string, or a Tiptap document (the document shape the task
 * description editor writes elsewhere in this app). Full rich-text rendering is a later
 * slice; this extracts a document's text so the description is readable now -- with the
 * honest `unsupported` outcome for a shape this function cannot read, rather than
 * silently rendering "No description" for a description that exists.
 */
export type DescriptionContent =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "unsupported" };

function collectDocumentText(node: unknown, out: string[]): boolean {
  if (node === null || node === undefined) return true;
  if (typeof node !== "object") return false;

  const record = node as Record<string, unknown>;
  if (typeof record.text === "string") {
    out.push(record.text);
    return true;
  }

  const content = record.content;
  if (content === undefined) {
    // A structural node with no text of its own (e.g. an image, a hard break).
    return true;
  }
  if (!Array.isArray(content)) return false;

  for (const child of content) {
    if (!collectDocumentText(child, out)) return false;
    // Block separation -- a paragraph ends where the next one begins.
    out.push("\n");
  }
  return true;
}

function isDocumentLike(value: Record<string, unknown>): boolean {
  return typeof value.type === "string" || Array.isArray(value.content);
}

export function extractDescription(description: unknown): DescriptionContent {
  if (description === null || description === undefined) {
    return { kind: "none" };
  }

  if (typeof description === "string") {
    return description.trim().length === 0
      ? { kind: "none" }
      : { kind: "text", text: description };
  }

  if (typeof description !== "object" || Array.isArray(description)) {
    return { kind: "unsupported" };
  }

  const record = description as Record<string, unknown>;
  if (!isDocumentLike(record)) return { kind: "unsupported" };

  const parts: string[] = [];
  if (!collectDocumentText(record, parts)) return { kind: "unsupported" };

  const text = parts.join("").trim();
  return text.length === 0 ? { kind: "none" } : { kind: "text", text };
}
