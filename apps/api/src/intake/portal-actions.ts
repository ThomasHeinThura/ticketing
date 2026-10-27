/**
 * Customer lifecycle actions on a portal submission (`CP-7`, `CP-8`, `CP-9`). Every action is
 * REQUESTER-ONLY: the submission is looked up by `requester_id`, so a colleague, a participant or
 * another organisation's customer receives the same constant-shape 404 as an unknown reference
 * (`CP-2`, `CP-16`). Failures are plain-text `HTTPException`s whose message starts with a stable
 * machine code (`cannot_deescalate: ...`, `not_reopenable: ...`) so the web client can branch on
 * the prefix without parsing prose.
 */
import {
  parseSubmissionReference,
  transitionSubmission,
} from "@taskdesk/domain";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { publishEvent } from "../events";
import { resolveWorkItemEventRecipients } from "../notification/work-item-recipients";
import {
  diffWorkItemFieldChanges,
  recordWorkItemActivity,
  resolveVisibility,
} from "../work-item/activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../work-item/assert-work-item-live";
import {
  publishWorkItemHint,
  recordWorkItemEvent,
} from "../work-item/native-event";
import {
  findReopenWindowDays,
  isWithinReopenWindow,
  requestCustomerReopen,
} from "../workflow/customer-reopen";
import { appendIntakeAudit } from "./audit";
import { judgeEscalation, type PortalPriority } from "./portal-priority";

function code(name: string, message: string): never {
  throw new HTTPException(name === "cannot_deescalate" ? 403 : 409, {
    message: `${name}: ${message}`,
  });
}

function submissionNumber(ref: string): number {
  const number = parseSubmissionReference(ref);
  if (number === null)
    throw new HTTPException(404, { message: "Submission not found" });
  return number;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The requester's own submission, locked; anything else is the constant 404. */
async function lockOwnSubmission(tx: Tx, number: number, personId: string) {
  const [row] = await tx
    .select({
      submission: schema.submissionTable,
      workspaceId: schema.requestTypeTable.workspaceId,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(schema.submissionTable.number, number),
        eq(schema.submissionTable.requesterId, personId),
      ),
    )
    .for("update", { of: schema.submissionTable })
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Submission not found" });
  return row;
}

async function lockLinkedWorkItem(tx: Tx, workItemId: string) {
  const [item] = await tx
    .select()
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, workItemId))
    .for("update")
    .limit(1);
  assertWorkItemStillLive(item, "Submission not found");
  await assertProjectStillLive(tx, item.projectId, "Submission not found");
  return item;
}

/**
 * `CP-7`: raise the linked work item's priority. A decrease is refused 403, an equal value 409,
 * and a resolved request cannot be escalated (reopen it first). The change writes the standard
 * `updated`/`priority` activity row (so field history stays reconstructable), the audit row and
 * the `work_item.escalated` event whose recipients are the assignee and unmuted watchers.
 * The contract sets no once-per-window rule, so none is applied.
 */
export async function escalatePortalPriority(input: {
  ref: string;
  personId: string;
  userId: string;
  priority: PortalPriority;
}): Promise<void> {
  const number = submissionNumber(input.ref);
  const committed = await db.transaction(async (tx) => {
    const row = await lockOwnSubmission(tx, number, input.personId);
    if (row.submission.state !== "accepted" || !row.submission.workItemId)
      code("not_escalatable", "this request is not in progress yet");
    const item = await lockLinkedWorkItem(tx, row.submission.workItemId);
    if (item.resolvedAt)
      code("not_escalatable", "this request is already resolved");
    const verdict = judgeEscalation(item.priority, input.priority);
    if (verdict === "lower")
      code("cannot_deescalate", "priority can only be raised");
    if (verdict === "same")
      code("no_change", `the priority is already ${input.priority}`);
    const [updated] = await tx
      .update(schema.workItemTable)
      .set({
        priority: input.priority,
        version: sql`${schema.workItemTable.version} + 1`,
      })
      .where(
        and(
          eq(schema.workItemTable.id, item.id),
          eq(schema.workItemTable.version, item.version),
        ),
      )
      .returning({ id: schema.workItemTable.id });
    if (!updated) code("conflict", "the request changed; reload and try again");
    const rows = diffWorkItemFieldChanges(
      { priority: item.priority },
      { priority: input.priority },
      {
        workspaceId: item.workspaceId,
        workItemId: item.id,
        actorId: input.userId,
        actorType: "person",
      },
    ).map((activity) => ({ ...activity, payload: { source: "portal" } }));
    await recordWorkItemActivity(tx, rows);
    await appendIntakeAudit(tx, {
      actorId: input.personId,
      actorType: "person",
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      organisationId: row.submission.organisationId,
      action: "work_item.escalated",
      entityType: "work_item",
      entityId: item.id,
      before: { priority: item.priority },
      after: { priority: input.priority, source: "portal" },
    });
    const event = await recordWorkItemEvent(tx, {
      kind: "work_item.escalated",
      workItemId: item.id,
      key: item.key,
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      actorId: input.userId,
      actorType: "person",
      customerVisible: true,
      payload: {
        workItemId: item.id,
        key: item.key,
        url: `/agent/work-items/${encodeURIComponent(item.key)}`,
        fromPriority: item.priority,
        toPriority: input.priority,
      },
      notify: { resolveRecipients: resolveWorkItemEventRecipients },
    });
    // The canonical priority-change events (same shape `updateWorkItem` emits) so webhooks,
    // automations, realtime and activity history see a customer escalation like any edit.
    const changes = rows
      .filter((row) => row.verb === "updated" && typeof row.field === "string")
      .map((row) => ({
        field: row.field as string,
        from: row.oldValue,
        to: row.newValue,
        visibility: resolveVisibility(row),
      }));
    const updatedEvent = await recordWorkItemEvent(tx, {
      kind: "work_item.updated",
      workItemId: item.id,
      key: item.key,
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      actorId: input.userId,
      actorType: "person",
      customerVisible: changes.some((change) => change.visibility === "public"),
      payload: {
        key: item.key,
        url: `/agent/work-items/${encodeURIComponent(item.key)}`,
        changes,
      },
    });
    return { event, updatedEvent, item, changes };
  });
  await publishWorkItemHint(committed.event, {
    kind: "work_item.escalated",
    key: committed.item.key,
    projectId: committed.item.projectId,
    customerVisible: true,
  });
  await publishEvent("work_item.updated", {
    workItemId: committed.item.id,
    key: committed.item.key,
    workspaceId: committed.item.workspaceId,
    projectId: committed.item.projectId,
    changes: committed.changes,
    actorId: input.userId,
    actorType: "person",
  });
  await publishWorkItemHint(committed.updatedEvent, {
    kind: "work_item.updated",
    key: committed.item.key,
    projectId: committed.item.projectId,
    customerVisible: committed.changes.some(
      (change) => change.visibility === "public",
    ),
  });
}

/**
 * `CP-8` / `IQ-15`: the customer reopens their own request.
 *
 * - an AUTO-DECLINED submission goes back to `new` through the domain `reopen` transition
 *   (`submission.auto_declined_at` marks it; a staff decline is final, `not_reopenable`);
 * - a RESOLVED request is reopened through the shared system-actor `is_reopen` workflow edge
 *   (`requestCustomerReopen`, `WF-21`), only within `instance_setting.reopen_window_days`.
 *
 * Eligibility is checked BEFORE the shared helper so a refused button press never writes the
 * staff-facing `reopen_requested` warning flag. If the workflow itself cannot reopen (no
 * `is_reopen` edge, blocked, no executor), the helper has already raised that flag for staff and
 * the customer is told `reopen_pending_review`.
 */
export async function reopenPortalSubmission(input: {
  ref: string;
  personId: string;
}): Promise<void> {
  const number = submissionNumber(input.ref);
  const plan = await db.transaction(async (tx) => {
    const row = await lockOwnSubmission(tx, number, input.personId);
    const before = row.submission;
    if (before.state === "declined") {
      const result = transitionSubmission(
        {
          number,
          state: before.state as never,
          claimedBy: before.claimedBy,
          claimedAt: before.claimedAt,
          clarifyingSince: null,
          staffMessageCount: 0,
          autoDeclined: before.autoDeclinedAt !== null,
        },
        { action: "reopen", actor: "customer", now: new Date() },
      );
      if (!result.ok)
        code(
          "not_reopenable",
          "this request was closed by our team and cannot be reopened; please submit a new request",
        );
      const [updated] = await tx
        .update(schema.submissionTable)
        .set({
          state: "new",
          autoDeclinedAt: null,
          clarifyingSince: null,
          version: before.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.submissionTable.id, before.id),
            eq(schema.submissionTable.version, before.version),
          ),
        )
        .returning({ id: schema.submissionTable.id });
      if (!updated)
        code("conflict", "the request changed; reload and try again");
      await appendIntakeAudit(tx, {
        actorId: input.personId,
        actorType: "person",
        workspaceId: row.workspaceId,
        organisationId: before.organisationId,
        action: "submission.reopened",
        entityType: "submission",
        entityId: before.id,
        before: { state: "declined" },
        after: { number, state: "new", auto: true },
      });
      return { kind: "submission" as const };
    }
    if (before.state !== "accepted" || !before.workItemId)
      code("not_reopenable", "this request cannot be reopened");
    const item = await lockLinkedWorkItem(tx, before.workItemId);
    if (!item.resolvedAt) code("not_reopenable", "this request is not closed");
    const windowDays = await findReopenWindowDays(tx);
    if (!isWithinReopenWindow(item.resolvedAt, new Date(), windowDays))
      code(
        "not_reopenable",
        `requests can be reopened within ${windowDays} days of being resolved`,
      );
    return {
      kind: "work_item" as const,
      workItemId: item.id,
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      organisationId: before.organisationId,
    };
  });
  if (plan.kind === "submission") return;
  const outcome = await requestCustomerReopen({
    workItemId: plan.workItemId,
    source: "portal_reopen",
  });
  if (outcome.kind === "not_closed")
    code("not_reopenable", "this request is not closed");
  // The audit row names the customer who asked, whether the reopen ran or was flagged. A
  // repeat press on an already-flagged refusal adds no second audit row or staff flag.
  if (outcome.kind === "reopened" || !outcome.duplicate)
    await appendIntakeAudit(db, {
      actorId: input.personId,
      actorType: "person",
      workspaceId: plan.workspaceId,
      projectId: plan.projectId,
      organisationId: plan.organisationId,
      action: "submission.reopen_requested",
      entityType: "work_item",
      entityId: plan.workItemId,
      after: {
        number,
        outcome: outcome.kind === "reopened" ? "reopened" : outcome.reason,
      },
    });
  if (outcome.kind === "reopened") return;
  code(
    "reopen_pending_review",
    "this request could not be reopened automatically; our team has been asked to review it",
  );
}

/**
 * `CP-9`: rate (or re-rate) a resolution, once per request. The requester is the only rater, so
 * `(work_item_id, person_id)` uniqueness is one rating per request; a second call changes it.
 * A first rating needs the request to be resolved; a CHANGE is allowed within
 * `instance_setting.reopen_window_days` of the resolution, after which the rating is final.
 */
export async function ratePortalSubmission(input: {
  ref: string;
  personId: string;
  rating: number;
  comment?: string;
}): Promise<void> {
  const number = submissionNumber(input.ref);
  await db.transaction(async (tx) => {
    const row = await lockOwnSubmission(tx, number, input.personId);
    if (row.submission.state !== "accepted" || !row.submission.workItemId)
      code("not_rateable", "only a resolved request can be rated");
    const item = await lockLinkedWorkItem(tx, row.submission.workItemId);
    if (!item.resolvedAt)
      code("not_rateable", "only a resolved request can be rated");
    const [existing] = await tx
      .select({ id: schema.satisfactionRatingTable.id })
      .from(schema.satisfactionRatingTable)
      .where(
        and(
          eq(schema.satisfactionRatingTable.workItemId, item.id),
          eq(schema.satisfactionRatingTable.personId, input.personId),
        ),
      )
      .limit(1);
    if (existing) {
      const windowDays = await findReopenWindowDays(tx);
      if (!isWithinReopenWindow(item.resolvedAt, new Date(), windowDays))
        code(
          "rating_locked",
          `a rating can be changed within ${windowDays} days of the resolution`,
        );
    }
    const now = new Date();
    await tx
      .insert(schema.satisfactionRatingTable)
      .values({
        workItemId: item.id,
        personId: input.personId,
        score: input.rating,
        comment: input.comment ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.satisfactionRatingTable.workItemId,
          schema.satisfactionRatingTable.personId,
        ],
        set: {
          score: input.rating,
          comment: input.comment ?? null,
          updatedAt: now,
        },
      });
    await appendIntakeAudit(tx, {
      actorId: input.personId,
      actorType: "person",
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      organisationId: row.submission.organisationId,
      action: "satisfaction.rated",
      entityType: "work_item",
      entityId: item.id,
      after: { score: input.rating, changed: Boolean(existing) },
    });
  });
}
