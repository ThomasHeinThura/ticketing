import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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
