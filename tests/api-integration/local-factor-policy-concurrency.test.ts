import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

async function setupRole() {
  await db.insert(schema.roleTable).values({
    id: "factor-policy-race-role",
    scope: "instance",
    workspaceId: null,
    key: "factor-race",
    name: "Factor race",
    rank: 10,
    capabilities: [],
  });
}

describe("local-factor role deletion invariant", () => {
  it("serializes a policy write before a concurrent role deletion", async () => {
    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 2,
    });
    const writer = await pool.connect();
    const deleter = await pool.connect();
    try {
      await setupRole();
      const pidResult = await deleter.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const deletePid = pidResult.rows[0]!.pid;
      await writer.query("begin");
      await writer.query("select id from role where id = $1 for key share", [
        "factor-policy-race-role",
      ]);
      await deleter.query("begin");
      let deleteFinished = false;
      let observedLockWait = false;
      const deletion = deleter
        .query("delete from role where id = $1", ["factor-policy-race-role"])
        .then(() => {
          deleteFinished = true;
          return { ok: true as const };
        })
        .catch((error: unknown) => {
          deleteFinished = true;
          return { ok: false as const, error };
        });
      for (let attempt = 0; attempt < 100 && !deleteFinished; attempt += 1) {
        const row = (
          await writer.query<{ waiting: boolean }>(
            "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
            [deletePid],
          )
        ).rows[0];
        if (row?.waiting) {
          observedLockWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedLockWait).toBe(true);

      await writer.query(
        "select id from instance_setting where id = 'singleton' for update",
      );
      await writer.query(
        'update instance_setting set local_factor_policy = \'{"mode":"required_role","requiredRoleId":"factor-policy-race-role"}\'::jsonb where id = \'singleton\'',
      );
      await writer.query("commit");
      const deletionResult = await deletion;
      expect(deletionResult.ok).toBe(false);
      await deleter.query("rollback");
      const policyRow = (
        await writer.query<{
          policy: { mode: string; requiredRoleId: string | null };
        }>(
          "select local_factor_policy as policy from instance_setting where id = 'singleton'",
        )
      ).rows[0];
      const role = await writer.query("select id from role where id = $1", [
        "factor-policy-race-role",
      ]);
      expect(policyRow?.policy).toEqual({
        mode: "required_role",
        requiredRoleId: "factor-policy-race-role",
      });
      expect(role.rowCount).toBe(1);
    } finally {
      writer.release();
      deleter.release();
      await pool.end();
    }
  });

  it("serializes a role deletion before a concurrent policy write", async () => {
    const pool = new Pool({
      connectionString: process.env.TASKDESK_DATABASE_URL,
      max: 2,
    });
    const writer = await pool.connect();
    const deleter = await pool.connect();
    try {
      await setupRole();
      const pidResult = await deleter.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const deletePid = pidResult.rows[0]!.pid;
      await db
        .update(schema.instanceSettingTable)
        .set({
          localFactorPolicy: {
            mode: "required_role",
            requiredRoleId: "factor-policy-race-role",
          },
        })
        .where(eq(schema.instanceSettingTable.id, "singleton"));
      await writer.query("begin");
      await writer.query(
        "select id from instance_setting where id = 'singleton' for update",
      );
      await deleter.query("begin");
      let deleteFinished = false;
      let observedLockWait = false;
      const deletion = deleter
        .query("delete from role where id = $1", ["factor-policy-race-role"])
        .then(() => {
          deleteFinished = true;
          return { ok: true as const };
        })
        .catch((error: unknown) => {
          deleteFinished = true;
          return { ok: false as const, error };
        });
      for (let attempt = 0; attempt < 100 && !deleteFinished; attempt += 1) {
        const row = (
          await writer.query<{ waiting: boolean }>(
            "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
            [deletePid],
          )
        ).rows[0];
        if (row?.waiting) {
          observedLockWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedLockWait).toBe(true);

      await writer.query(
        'update instance_setting set local_factor_policy = \'{"mode":"optional","requiredRoleId":null}\'::jsonb where id = \'singleton\'',
      );
      await writer.query("commit");
      const deletionResult = await deletion;
      expect(deletionResult.ok).toBe(true);
      await deleter.query("commit");
      const policyRow = (
        await writer.query<{
          policy: { mode: string; requiredRoleId: string | null };
        }>(
          "select local_factor_policy as policy from instance_setting where id = 'singleton'",
        )
      ).rows[0];
      const role = await writer.query("select id from role where id = $1", [
        "factor-policy-race-role",
      ]);
      expect(policyRow?.policy).toEqual({
        mode: "optional",
        requiredRoleId: null,
      });
      expect(role.rowCount).toBe(0);
    } finally {
      writer.release();
      deleter.release();
      await pool.end();
    }
  });
});
