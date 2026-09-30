import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { userPreferenceTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { assertCanReadView } from "../assert-can-read-view";

const PINNED_VIEWS_KEY = "pinned_view_ids";
// Serialize pin-set read/modify/write operations for one person. The transaction-scoped
// lock is taken before reading the preference so the absent-row/first-insert case is
// protected too; SELECT FOR UPDATE cannot lock a row that does not exist yet.
const SAVED_VIEW_PIN_LOCK_NAMESPACE = 5_465_424;

// SV-20: "Views can be pinned to the sidebar, per user." `POST /api/views/{id}/pin` is
// `self (kind 2 -- the caller's own user_preference row)` per search-and-saved-views.md's
// API table -- a toggle, not a body-carrying mutation: calling it again on an already-
// pinned view unpins it. Stored as one `user_preference` row per (person, workspace),
// `key = 'pinned_view_ids'`, `value` a plain string array -- the table's own shape is
// generic (see `userPreferenceTable`'s schema.ts comment), this is the one concrete use
// this PR wires up.
async function pinView(viewId: string, personId: string, userId: string) {
  const view = await db.query.savedViewTable.findFirst({
    where: (savedView, { eq }) => eq(savedView.id, viewId),
  });

  if (!view) {
    throw new HTTPException(404, { message: "Saved view not found" });
  }

  await assertCanReadView(view, personId, userId);

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${SAVED_VIEW_PIN_LOCK_NAMESPACE}, hashtext(${personId}))`,
    );

    const [existing] = await tx
      .select()
      .from(userPreferenceTable)
      .where(
        and(
          eq(userPreferenceTable.personId, personId),
          eq(userPreferenceTable.scope, "workspace"),
          eq(userPreferenceTable.scopeId, view.workspaceId),
          eq(userPreferenceTable.key, PINNED_VIEWS_KEY),
        ),
      )
      .limit(1);

    const currentIds = Array.isArray(existing?.value)
      ? (existing.value as unknown[]).filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];

    const pinned = currentIds.includes(viewId);
    const nextIds = pinned
      ? currentIds.filter((entry) => entry !== viewId)
      : [...currentIds, viewId];

    if (existing) {
      await tx
        .update(userPreferenceTable)
        .set({ value: nextIds })
        .where(eq(userPreferenceTable.id, existing.id));
    } else {
      await tx.insert(userPreferenceTable).values({
        personId,
        scope: "workspace",
        scopeId: view.workspaceId,
        key: PINNED_VIEWS_KEY,
        value: nextIds,
      });
    }

    await appendAuditLog(tx, {
      actorId: personId,
      actorType: "person",
      workspaceId: view.workspaceId,
      action: "saved_view.pinned",
      entityType: "saved_view",
      entityId: viewId,
      before: { pinned },
      after: { pinned: !pinned },
    });

    return { pinnedViewIds: nextIds };
  });

  await publishEvent("saved_view.pinned", {
    savedViewId: viewId,
    workspaceId: view.workspaceId,
    userId,
    pinned: result.pinnedViewIds.includes(viewId),
  });

  return result;
}

export default pinView;
