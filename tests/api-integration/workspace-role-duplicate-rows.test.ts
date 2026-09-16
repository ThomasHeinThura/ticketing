/**
 * Issue #118 — `workspace_role` has no `UNIQUE (workspace_id, role)`.
 *
 * The twin of `workspace-membership-duplicate-rows.test.ts`, one table over. That file
 * pins the `workspace_member` half (#88); this one pins `workspace_role`, which nobody
 * audited because until S7 there is no native write path to it.
 *
 * UPDATED 2026-09-15: this file used to carry two probes — P1 (reachability: a plain
 * insert of a second row succeeds) and P2 (fail-closed: the evaluator denies). PR #122
 * landed migration `0051`, adding the real `UNIQUE (workspace_id, role)` constraint. P1 is
 * now **superseded**, not merely obsolete: `tests/api-integration/workspace-role-uniqueness.test.ts`
 * already covers both the pre-constraint reachable state and the post-constraint refusal,
 * on the migration's own terms. Deleted here rather than left to bit-rot as a duplicate.
 *
 * P2 is KEPT and still matters, for the reason the original comment gave: the DB
 * constraint stops new duplicates, but it does not retroactively fix a row written before
 * the constraint existed, and — per #122's own migration — a deployment that already has a
 * conflicting duplicate pair cannot even apply the constraint (the migration RAISES and
 * refuses to proceed) until an operator resolves it by hand. The evaluator's own
 * fail-closed refusal is the only protection during that window, so it needs its own,
 * independent test — not one that happens to also prove the DB constraint works. To set up
 * that scenario now that the constraint exists, `plantDuplicateRoleRow` drops the
 * constraint immediately before inserting and restores it immediately after, inside the
 * same test — simulating exactly the "legacy data, constraint not yet enforced" state the
 * evaluator-level refusal exists for, without weakening the constraint for any other test.
 *
 * NON-VACUITY. P2 depends on exactly one production line: the `if (rows.length !== 1)
 * return null;` in `workspaceRolePermission` (`apps/api/src/utils/workspace-member-roles.ts`).
 * Restore the old `.limit(1)` read, or change that check to `rows.length < 1`, and P2's
 * grant/deny assertion flips. Verified that way rather than asserted.
 */

import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { requireWorkspacePermission } from "../../apps/api/src/utils/require-workspace-permission";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

async function createWorkspace(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  name: string,
): Promise<string> {
  const created = await createWorkspaceNative(app, cookie, { name });
  if (created.status !== 200) {
    throw new Error(`create failed: ${created.status} ${await created.text()}`);
  }
  return ((await created.json()) as { id: string }).id;
}

/**
 * `requireWorkspacePermission` exercised directly as middleware, the same shape
 * `workspace-membership-duplicate-rows.test.ts` uses for `requireWorkspaceCapability`:
 * it isolates the evaluator from whatever a real route also happens to check.
 */
function probe(workspaceId: string, userId: string) {
  const app = new Hono<{ Variables: { userId: string; workspaceId: string } }>()
    .use("*", async (c, next) => {
      c.set("workspaceId", c.req.header("x-workspace-id") ?? "");
      c.set("userId", c.req.header("x-user-id") ?? "");
      return next();
    })
    .get("/probe", requireWorkspacePermission({ project: ["read"] }), (c) =>
      c.json({ ok: true }),
    );
  return app.request("/probe", {
    headers: { "x-workspace-id": workspaceId, "x-user-id": userId },
  });
}

const UNIQUE_CONSTRAINT = "workspace_role_workspace_id_role_unique";

/**
 * Migration `0051` (#122) added `UNIQUE (workspace_id, role)`, so planting a conflicting
 * duplicate now needs the constraint out of the way first — and re-adding a UNIQUE
 * constraint validates existing data, so it cannot be restored while the planted duplicate
 * is still present. Callers must: drop, plant, assert, delete the planted row, restore —
 * in a `finally` so a failed assertion still leaves the constraint enforced for every other
 * test in the suite. See the P2 test below for the exact sequence.
 */
async function dropUniqueConstraint(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "workspace_role" DROP CONSTRAINT ${sql.identifier(UNIQUE_CONSTRAINT)}`,
  );
}

async function restoreUniqueConstraint(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "workspace_role" ADD CONSTRAINT ${sql.identifier(UNIQUE_CONSTRAINT)} UNIQUE ("workspace_id", "role")`,
  );
}

/**
 * The seeded row for one role, duplicated with a deliberately DIFFERENT payload. Requires
 * the `UNIQUE (workspace_id, role)` constraint to already be dropped — see
 * `dropUniqueConstraint`.
 */
async function plantDuplicateRoleRow(
  workspaceId: string,
  role: string,
  permission: string,
): Promise<void> {
  await db.insert(schema.workspaceRoleTable).values({
    id: `dup-${workspaceId}-${role}`,
    workspaceId,
    role,
    permission,
  });
}

async function roleRowCount(
  workspaceId: string,
  role: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.workspaceRoleTable.id })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
  return rows.length;
}

describe("#118 P2 fail-closed: a duplicated role definition is refused, not guessed", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a member holding a role with TWO conflicting workspace_role rows is DENIED", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "P2 dup role");
    const member = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // Control: one coherent row, and the member is allowed.
    expect(await roleRowCount(workspaceId, "admin")).toBe(1);
    expect((await probe(workspaceId, member.user.id)).status).toBe(200);

    // Simulate a row that predates migration 0051's constraint (or a deployment that
    // cannot yet apply it — 0051 itself refuses to add the constraint while a conflicting
    // pair exists). Constraint is out of the way only for the duration of this block.
    await dropUniqueConstraint();
    try {
      // Now the role has two definitions that disagree about `project`.
      await plantDuplicateRoleRow(
        workspaceId,
        "admin",
        JSON.stringify({ organization: ["delete"] }),
      );
      expect(await roleRowCount(workspaceId, "admin")).toBe(2);

      // The evaluator must refuse rather than resolve by scan order. Fail-closed: 403.
      expect((await probe(workspaceId, member.user.id)).status).toBe(403);
    } finally {
      // Remove the planted duplicate before restoring the constraint — ADD CONSTRAINT
      // UNIQUE validates existing data, so it cannot be restored while a violation exists.
      // In a finally: a failed assertion above must not leave the constraint dropped for
      // every other test that runs after this one in the same process.
      await db
        .delete(schema.workspaceRoleTable)
        .where(eq(schema.workspaceRoleTable.id, `dup-${workspaceId}-admin`));
      await restoreUniqueConstraint();
    }
  });
});
