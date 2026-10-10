import { beforeEach, describe, expect, it } from "vitest";
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
  });
}
