/**
 * Issue #118 — `workspace_role` has no `UNIQUE (workspace_id, role)`.
 *
 * The twin of `workspace-membership-duplicate-rows.test.ts`, one table over. That file
 * pins the `workspace_member` half (#88); this one pins `workspace_role`, which nobody
 * audited because until S7 there is no native write path to it.
 *
 * Two probes, and they answer different questions:
 *
 *   P1  REACHABILITY — the schema really does permit a second row for one
 *       `(workspace_id, role)` pair, with a DIFFERENT `permission` payload. If this probe
 *       ever starts failing, the `UNIQUE` constraint has landed and P2 becomes unreachable
 *       through this route; say so rather than deleting P2, because the evaluator-side
 *       refusal is still the control for rows written before the constraint existed.
 *
 *   P2  FAIL-CLOSED — with two such rows, the capability evaluator DENIES. It does not pick
 *       one arbitrarily. Before #118's fix both evaluators read the row with an unordered
 *       `.limit(1)`, so the answer was whichever tuple a sequential scan produced first —
 *       and an ordinary `UPDATE` elsewhere can reverse that, because PostgreSQL MVCC
 *       appends the updated tuple to the end of the heap.
 *
 * NON-VACUITY. P2 depends on exactly one production line: the `if (rows.length !== 1)
 * return null;` in `workspaceRolePermission` (`apps/api/src/utils/workspace-member-roles.ts`).
 * Restore the old `.limit(1)` read, or change that check to `rows.length < 1`, and P2's
 * grant/deny assertion flips. Verified that way rather than asserted.
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { requireWorkspacePermission } from "../../apps/api/src/utils/require-workspace-permission";
import { resetTestDatabase } from "./helpers/database";
import {
  inviteAndAcceptAsNewMember,
  signUpUser,
} from "./helpers/organization-http";
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

/** The seeded row for one role, duplicated with a deliberately DIFFERENT payload. */
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

describe("#118 P1 reachability: the schema permits a second workspace_role row for one (workspace, role) pair", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a direct insert of a second row for an already-seeded role SUCCEEDS, with a different payload", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "P1 dup role");

    // `admin` is seeded by `seedDefaultWorkspaceRoles` (DEFAULT_ROLE_NAMES).
    expect(await roleRowCount(workspaceId, "admin")).toBe(1);

    await plantDuplicateRoleRow(
      workspaceId,
      "admin",
      JSON.stringify({ project: ["read"] }),
    );

    // No UNIQUE (workspace_id, role) exists, so this is a state the database allows.
    expect(await roleRowCount(workspaceId, "admin")).toBe(2);
  });
});

describe("#118 P2 fail-closed: a duplicated role definition is refused, not guessed", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a member holding a role with TWO conflicting workspace_role rows is DENIED", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "P2 dup role");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // Control: one coherent row, and the member is allowed.
    expect(await roleRowCount(workspaceId, "admin")).toBe(1);
    expect((await probe(workspaceId, member.user.id)).status).toBe(200);

    // Now the role has two definitions that disagree about `project`.
    await plantDuplicateRoleRow(
      workspaceId,
      "admin",
      JSON.stringify({ organization: ["delete"] }),
    );
    expect(await roleRowCount(workspaceId, "admin")).toBe(2);

    // The evaluator must refuse rather than resolve by scan order. Fail-closed: 403.
    expect((await probe(workspaceId, member.user.id)).status).toBe(403);
  });
});
