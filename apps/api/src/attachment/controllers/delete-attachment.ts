import { and, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../../database";
import type { PendingActionTransaction } from "../../pending-action/service";
import { dbClockUtc } from "../../utils/db-time";
import { recordWorkItemActivity } from "../../work-item/activity";

/** Executor-only soft deletion. The PA engine owns fresh authority and exact locked target validation. */
export async function deleteAttachmentInTransaction(
  tx: PendingActionTransaction,
  attachment: typeof schema.attachmentTable.$inferSelect,
  item: typeof schema.workItemTable.$inferSelect,
  actorId: string,
  actorType: "person" | "api_key",
) {
  if (attachment.state === "deleted") return attachment;
  const [updated] = await tx
    .update(schema.attachmentTable)
    .set({ state: "deleted", deletedAt: dbClockUtc() })
    .where(
      and(
        eq(schema.attachmentTable.id, attachment.id),
        ne(schema.attachmentTable.state, "deleted"),
      ),
    )
    .returning();
  if (!updated)
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  await recordWorkItemActivity(tx, [
    {
      workspaceId: item.workspaceId,
      workItemId: item.id,
      actorId,
      actorType,
      verb: "attachment.deleted",
      payload: { attachmentId: attachment.id, filename: attachment.filename },
    },
  ]);
  return updated;
}
