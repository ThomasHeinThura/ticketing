import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { scanApprovalReminders } from "../../../apps/api/src/approval/reminder-scan";
import db, { schema } from "../../../apps/api/src/database";
import {
  buildTenant,
  createApproval,
  runTransition,
  setApproval,
} from "./approval-fixtures";
import { resetTestDatabase } from "./database";

/** Single-use and withdrawn-ignored gates, runnable under any process/database zone. */
export function defineApprovalGateTimeZoneSuite(label: string) {
  describe(`approval gate semantics (${label})`, () => {
    beforeEach(async () => {
      await resetTestDatabase();
    });

    it("an approval is spent by the transition it unlocked and a new one unlocks again", async () => {
      const t = await buildTenant(`tz-${label}`, { executable: true });
      await setApproval(t, (await createApproval(t)).id);
      expect((await runTransition(t, t.done.id)).status).toBe(200);
      expect((await runTransition(t, t.backlog.id)).status).toBe(200);
      expect((await runTransition(t, t.done.id)).status).toBe(422);
      await setApproval(t, (await createApproval(t)).id);
      expect((await runTransition(t, t.done.id)).status).toBe(200);
    });

    it("a run closes the other pending approvals of its transition", async () => {
      const t = await buildTenant(`tz-close-${label}`, { executable: true });
      const winner = await createApproval(t);
      const other = await createApproval(t);
      await setApproval(t, winner.id);
      expect((await runTransition(t, t.done.id)).status).toBe(200);
      const [closed] = await db
        .select()
        .from(schema.approvalTable)
        .where(eq(schema.approvalTable.id, other.id));
      expect(closed?.state).toBe("expired");
    });
  });
}

/** The reminder scan must compare UTC wall-clock columns with the UTC database clock. */
export function defineApprovalScanTimeZoneSuite(label: string) {
  describe(`approval reminder scan (${label})`, () => {
    beforeEach(async () => {
      await resetTestDatabase();
    });

    it("expires only overdue approvals, stamps the 50% reminder once, and leaves fresh ones alone", async () => {
      const t = await buildTenant(`scan-${label}`);
      const overdue = await createApproval(t);
      const halfway = await createApproval(t);
      const fresh = await createApproval(t);
      const sentOverdue = await createApproval(t);
      const ninety = await createApproval(t);
      const now = Date.now();
      const set = (id: string, createdAt: Date, expiresAt: Date) =>
        db
          .update(schema.approvalTable)
          .set({ createdAt, expiresAt })
          .where(eq(schema.approvalTable.id, id));
      await set(overdue.id, new Date(now - 3_600_000), new Date(now - 1000));
      await set(
        halfway.id,
        new Date(now - 3_600_000),
        new Date(now + 3_600_000),
      );
      await set(fresh.id, new Date(now), new Date(now + 86_400_000));
      // Only the due-row branch can select an overdue approval whose reminders already went out.
      await set(
        sentOverdue.id,
        new Date(now - 3_600_000),
        new Date(now - 1000),
      );
      await db
        .update(schema.approvalTable)
        .set({
          reminder50SentAt: new Date(now - 1800_000),
          reminder90SentAt: new Date(now - 900_000),
        })
        .where(eq(schema.approvalTable.id, sentOverdue.id));
      // 95% elapsed with the 50% reminder sent: only the 90% branch can select it.
      await set(
        ninety.id,
        new Date(now - 95 * 60_000),
        new Date(now + 5 * 60_000),
      );
      await db
        .update(schema.approvalTable)
        .set({ reminder50SentAt: new Date(now - 1800_000) })
        .where(eq(schema.approvalTable.id, ninety.id));

      const outcome = await scanApprovalReminders();
      expect(outcome.expired).toBe(2);
      expect(outcome.reminded).toBe(2);

      const rows = await db.select().from(schema.approvalTable);
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(overdue.id)?.state).toBe("expired");
      expect(byId.get(sentOverdue.id)?.state).toBe("expired");
      expect(byId.get(ninety.id)?.state).toBe("pending");
      expect(byId.get(ninety.id)?.reminder90SentAt).not.toBeNull();
      expect(byId.get(halfway.id)?.state).toBe("pending");
      expect(byId.get(halfway.id)?.reminder50SentAt).not.toBeNull();
      expect(byId.get(halfway.id)?.reminder90SentAt).toBeNull();
      expect(byId.get(fresh.id)?.state).toBe("pending");
      expect(byId.get(fresh.id)?.reminder50SentAt).toBeNull();

      // A second scan is idempotent.
      const again = await scanApprovalReminders();
      expect(again.expired + again.reminded).toBe(0);
    });
  });
}
