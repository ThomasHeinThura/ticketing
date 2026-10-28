/**
 * NO-21 keyset cursor precision (review-p2-r2 S7). Written, NOT YET RUN: needs the
 * integration database (coordinator runs it).
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  listVisibleNotificationRows,
  markReadableNotificationsRead,
} from "../../apps/api/src/notification/inbox.repository";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

describe("inbox keyset cursor with microsecond created_at", () => {
  beforeEach(async () => resetTestDatabase());

  it("mark-all-read and the list do not skip rows sharing the boundary millisecond", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    // 230 rows inside ONE millisecond (distinct microseconds): the 100-row candidate page
    // boundary falls inside the tie, which a raw microsecond comparison against a
    // millisecond cursor would skip.
    await db.execute(sql`
      INSERT INTO notification (id, user_id, title, content, type, resource_id, resource_type, event_data, created_at, updated_at)
      SELECT 'ntf-cursor-' || g, ${admin.user.id}, 'x', 'x', 'audit_write_failed', 'singleton', 'instance',
             '{}'::jsonb,
             timestamptz '2026-01-01 00:00:00.123000+00' + (g || ' microseconds')::interval,
             timestamptz '2026-01-01 00:00:00.123000+00'
      FROM generate_series(1, 230) AS g`);
    const listed = await listVisibleNotificationRows({
      userId: admin.user.id,
      credentialCanReadTask: true,
    });
    expect(listed.length).toBeGreaterThan(0);
    await markReadableNotificationsRead(admin.user.id);
    const unread = await db
      .select({ id: schema.notificationTable.id })
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.userId, admin.user.id),
          eq(schema.notificationTable.isRead, false),
        ),
      );
    expect(unread).toHaveLength(0);
  });
});
