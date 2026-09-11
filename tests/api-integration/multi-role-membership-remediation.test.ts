/**
 * Issue #82 — the remediation surfaces that the oracle and the four flipped probes do not
 * reach on their own.
 *
 * `multi-role-membership-characterization.test.ts` proves the two evaluators AGREE, and
 * `multi-role-membership-target.test.ts` holds the four behaviours PR #84 pinned. This file
 * covers the rest of issue #82's scope list:
 *
 *   §1  the native evaluator on an ORDINARY route — not just `/api/capabilities`, so the
 *       refusal is shown where the product actually enforces authorization;
 *   §2  `requireWorkspaceRoleAuthority` — the instance-admin twin of the same rule;
 *   §3  every remaining role-bearing write on the mounted plugin, not only
 *       `update-member-role`;
 *   §4  the RECOVERY strategy — migration `0050`'s own SQL, executed against real rows: it
 *       repairs what has one meaning and refuses to guess at what does not.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveMembershipRole } from "../../apps/api/src/utils/workspace-member-roles";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
  plantLegacyMembershipRole,
  signUpUser,
} from "./helpers/organization-http";

type App = ReturnType<typeof createApp>["app"];

/**
 * Consumes the instance-admin slot.
 *
 * `auth.ts:708-712` promotes the FIRST user in an empty database to instance admin, and
 * `resetTestDatabase()` empties it before every test — so without this, every workspace owner
 * in this file would also be an instance admin and would take `hasWorkspacePermission`'s
 * bypass before any membership row was read. That would make several assertions below pass or
 * fail for a reason other than the one they name.
 */
async function burnInstanceAdminSlot(app: App): Promise<void> {
  await signUpUser(app);
}

async function workspaceWithMember(app: App, role: string) {
  const owner = await signUpUser(app);
  const created = await createWorkspaceViaPlugin(app, owner.cookie);
  const workspace = (await created.json()) as { id: string };
  const member = await inviteAndAcceptAsNewMember(
    app,
    owner.cookie,
    workspace.id,
    role,
  );
  return { owner, workspace, member };
}

/**
 * Drops the CHECK constraint so a section that is testing the MIGRATION can create the
 * pre-migration state the migration exists to clean up, then leaves it dropped for that
 * section to re-add by running the migration's own SQL.
 */
async function withoutRoleConstraint(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "workspace_member" DROP CONSTRAINT IF EXISTS "workspace_member_role_single_value"`,
  );
}

async function restoreRoleConstraint(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "workspace_member" DROP CONSTRAINT IF EXISTS "workspace_member_role_single_value"`,
  );
  // Mirrors the CHECK migration 0050 actually ships -- two-argument `btrim` over
  // space/tab/newline/CR/FF/VT, matching JS `trim()`'s ASCII shapes (see Finding 3 fix).
  // Built with `chr()` rather than a `\t`-style literal so this JS template string cannot
  // have its own escaping silently reinterpret what reaches Postgres.
  await db.execute(
    sql`ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_role_single_value" CHECK (position(',' in "role") = 0 AND "role" = btrim("role", chr(32) || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) AND btrim("role", chr(32) || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) <> '') NOT VALID`,
  );
}

/** The statements of migration 0050, from the file that actually ships. */
async function migrationStatements(): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(
    here,
    "../../apps/api/drizzle/0050_enforce_single_role_membership.sql",
  );
  const source = await readFile(path, "utf8");
  return source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("#82 §1 -- the native evaluator refuses a malformed membership on an ORDINARY route", () => {
  it('a member whose row holds "admin,viewer" is denied a real native write route (403), not merely reported as capability-less -- `/api/capabilities` is a read of the same evaluator, so proving it there alone would not prove enforcement', async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "admin",
    );

    // Control: as a genuine admin, the member may create a project.
    const allowed = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({
        workspaceId: workspace.id,
        name: `Project ${randomUUID()}`,
        slug: `p-${randomUUID().slice(0, 8)}`,
        icon: "Layout",
      }),
    });
    expect([200, 201]).toContain(allowed.status);

    // Corrupt the row to a value whose comma-split CONTAINS the very role that just
    // succeeded. The plugin would OR "admin" back in; the native evaluator must not.
    await plantLegacyMembershipRole(
      workspace.id,
      member.user.id,
      "admin,viewer",
    );

    // Pin the MECHANISM, not just the status code. `"admin,viewer"` also names no row in
    // `workspace_role`, so an accidental deny -- the exact-match lookup finding nothing --
    // would ALSO return 403 with the malformed-role check deleted entirely, and the
    // assertion below on `refused.status` would not notice the difference. Assert directly
    // on the resolution `hasWorkspacePermission` actually consults, which is the one thing
    // that distinguishes "refused because malformed" from "refused because no such role".
    const resolution = await resolveMembershipRole(
      db,
      workspace.id,
      member.user.id,
    );
    expect(resolution).toEqual({
      ok: false,
      reason: "malformed-role",
      problem: "multi-valued",
    });

    const refused = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({
        workspaceId: workspace.id,
        name: `Project ${randomUUID()}`,
        slug: `p-${randomUUID().slice(0, 8)}`,
        icon: "Layout",
      }),
    });
    expect(refused.status).toBe(403);

    // And the owner is untouched -- the refusal is per-membership, not per-workspace.
    const ownerStillWorks = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        workspaceId: workspace.id,
        name: `Project ${randomUUID()}`,
        slug: `p-${randomUUID().slice(0, 8)}`,
        icon: "Layout",
      }),
    });
    expect([200, 201]).toContain(ownerStillWorks.status);
  });

  it('an OWNER combination ("owner,admin") does not restore owner authority through the compiled fallback -- `owner` is the one role whose statements stay compiled-in (retrofit R5), so a value merely CONTAINING it is the highest-risk shape and must not match `role === "owner"`', async () => {
    const { app } = createApp();
    await burnInstanceAdminSlot(app);
    const { owner, workspace } = await workspaceWithMember(app, "viewer");

    await plantLegacyMembershipRole(workspace.id, owner.user.id, "owner,admin");

    const response = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { problem: string };
    expect(body.problem).toBe("multi-valued");
  });

  it("PINS THE ONE DELIBERATE EXCEPTION: an INSTANCE ADMIN with the same corrupt row still gets a 200 capability map, because `hasWorkspacePermission` short-circuits on `isInstanceAdmin` before it reads any membership row. That bypass is Thomas's 2026-09-08 decision and #82 does not re-open it -- an instance admin already holds the authority a corrupt row could confer, so the malformed value adds them no privilege. What #82 DOES require is that `/api/capabilities` and the evaluator make the same call, which they do because both route through `callerMembershipResolution`. The narrower guard that refuses this caller anyway is `requireWorkspaceRoleAuthority` -- see §2", async () => {
    const { app } = createApp();
    // No burnInstanceAdminSlot: this owner IS the first user, therefore the instance admin,
    // which is also the single most common real-world shape (the operator who set the
    // instance up and created the first workspace).
    const { owner, workspace } = await workspaceWithMember(app, "viewer");

    await plantLegacyMembershipRole(workspace.id, owner.user.id, "owner,admin");

    const response = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { deleteWorkspace: boolean }).deleteWorkspace,
    ).toBe(true);
  });
});

describe("#82 §2 -- requireWorkspaceRoleAuthority applies the same rule to an instance admin", () => {
  it("an instance admin whose OWN membership row is malformed is refused the workspace mutation routes that guard runs on -- the instance-admin bypass must not stand in for a workspace role that cannot be read", async () => {
    const { app } = createApp();
    const { workspace, member } = await workspaceWithMember(app, "admin");

    // Promote the member to instance admin (`user.role = "admin"`, read by isInstanceAdmin).
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, member.user.id));

    // Control: as an instance admin with a coherent workspace role, the rename succeeds.
    const before = await app.request(`/api/workspace/${workspace.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({ name: "Renamed By Instance Admin" }),
    });
    expect(before.status).toBe(200);

    await plantLegacyMembershipRole(
      workspace.id,
      member.user.id,
      "owner,admin",
    );

    const after = await app.request(`/api/workspace/${workspace.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({ name: "Renamed Again" }),
    });
    expect(after.status).toBe(403);

    const [row] = await db
      .select({ name: schema.workspaceTable.name })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));
    expect(row?.name).toBe("Renamed By Instance Admin");
  });
});

describe("#82 §3 -- every role-bearing write on the mounted plugin, not just update-member-role", () => {
  it("invite-member cannot invite someone INTO a multi-role value -- the invitation stores the role, so an unguarded invite would simply defer the defect to acceptance time", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const response = await app.request("/api/auth/organization/invite-member", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        organizationId: workspace.id,
        email: `invitee-${randomUUID()}@example.com`,
        role: ["admin", "viewer"],
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      "INVALID_ROLE_VALUE",
    );

    const invitations = await db
      .select({ role: schema.invitationTable.role })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.workspaceId, workspace.id));
    expect(invitations.map((row) => row.role)).not.toContain("admin,viewer");
  });

  it("update-role cannot RENAME an existing role into a comma-bearing name, including through its nested `data` object -- a rename is a write the top-level field check would miss", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const response = await app.request("/api/auth/organization/update-role", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        organizationId: workspace.id,
        roleName: "viewer",
        data: { roleName: "viewer,admin" },
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; field: string };
    expect(body.error).toBe("INVALID_ROLE_VALUE");
    expect(body.field).toBe("data.roleName");

    const roles = await db
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    expect(roles.map((row) => row.role)).not.toContain("viewer,admin");
    expect(roles.map((row) => row.role)).toContain("viewer");
  });

  it("a one-element array is NOT refused -- it names exactly one role and is not a union, and refusing it would break a client that legitimately sends the array shape better-auth documents", async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "viewer",
    );
    const [memberRow] = await db
      .select({ id: schema.workspaceUserTable.id })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, member.user.id),
        ),
      );

    const response = await app.request(
      "/api/auth/organization/update-member-role",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          memberId: memberRow?.id,
          role: ["admin"],
        }),
      },
    );
    expect(response.status).toBe(200);

    const [after] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, member.user.id),
        ),
      );
    expect(after?.role).toBe("admin");
  });
});

describe("#82 §4 -- the recovery strategy: migration 0050's own SQL, against real rows", () => {
  it("REPAIRS every value that has only one meaning -- duplicates, a trailing comma, a leading comma and padding all collapse to the single role they name, because that repair decides nobody's privileges", async () => {
    const { app } = createApp();
    const { owner, workspace } = await workspaceWithMember(app, "viewer");

    const shapes = [
      { raw: "admin,admin", repaired: "admin" },
      { raw: "admin,", repaired: "admin" },
      { raw: ",admin", repaired: "admin" },
      { raw: " admin ", repaired: "admin" },
      { raw: "admin, admin", repaired: "admin" },
      // Finding 3: a one-argument `btrim` strips only the space character, so it would
      // have left these two BYTE-IDENTICAL to `raw` -- no repair at all -- and the CHECK
      // below would then have accepted the untrimmed value as well-formed. The
      // two-argument `btrim` this migration now uses must actually strip the tab/newline.
      { raw: "\tadmin", repaired: "admin" },
      { raw: "admin\n", repaired: "admin" },
      { raw: "\u00a0admin", repaired: "admin" },
      { raw: "admin\ufeff", repaired: "admin" },
    ];

    const [repair] = await migrationStatements();
    if (!repair) throw new Error("migration 0050 has no statements");

    for (const shape of shapes) {
      await withoutRoleConstraint();
      const member = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspace.id,
        "viewer",
      );
      await db.execute(
        sql`UPDATE "workspace_member" SET "role" = ${shape.raw} WHERE "workspace_id" = ${workspace.id} AND "user_id" = ${member.user.id}`,
      );

      await db.execute(sql.raw(repair));

      const [row] = await db
        .select({ role: schema.workspaceUserTable.role })
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspace.id),
            eq(schema.workspaceUserTable.userId, member.user.id),
          ),
        );
      expect(row?.role, `raw: ${JSON.stringify(shape.raw)}`).toBe(
        shape.repaired,
      );
    }

    await restoreRoleConstraint();
  });

  it("REFUSES to guess at a genuine union, naming the offending row -- keeping the higher role would grant privileges nobody granted, keeping the lower one would silently demote, and choosing by position is arbitrary, so the deployment stops and an operator decides", async () => {
    const { app } = createApp();
    const { workspace, member } = await workspaceWithMember(app, "viewer");

    await withoutRoleConstraint();
    await db.execute(
      sql`UPDATE "workspace_member" SET "role" = 'owner,admin' WHERE "workspace_id" = ${workspace.id} AND "user_id" = ${member.user.id}`,
    );

    const [repair, refuse] = await migrationStatements();
    if (!repair || !refuse)
      throw new Error("migration 0050 is missing statements");

    // The repair pass leaves a two-distinct-role value alone rather than picking one.
    await db.execute(sql.raw(repair));
    const [afterRepair] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, member.user.id),
        ),
      );
    expect(afterRepair?.role).toBe("owner,admin");

    // And the refusal pass stops the migration, naming the row.
    // Drizzle wraps the driver error; the RAISE text is on `cause`, not the outer message.
    const failure = await db.execute(sql.raw(refuse)).then(
      () => null,
      (error: unknown) => error as { cause?: { message?: string } },
    );
    expect(failure).not.toBeNull();
    const raised = failure?.cause?.message ?? "";
    expect(raised).toMatch(/#82/);
    expect(raised).toMatch(/owner,admin/);
    expect(raised).toContain(member.user.id);

    await restoreRoleConstraint();
  });

  it.each(["\t", "\n", "\u00a0", "\ufeff"])(
    "REFUSES a value that is whitespace-only (%j) rather than silently accepting it -- a one-argument `btrim` strips only the space character, so this value would previously have satisfied `role = btrim(role)` and slipped past both the repair and the CHECK as if it were already a well-formed role",
    async (raw) => {
      const { app } = createApp();
      const { workspace, member } = await workspaceWithMember(app, "viewer");

      await withoutRoleConstraint();
      await db.execute(
        sql`UPDATE "workspace_member" SET "role" = ${raw} WHERE "workspace_id" = ${workspace.id} AND "user_id" = ${member.user.id}`,
      );

      const [repair, refuse] = await migrationStatements();
      if (!repair || !refuse)
        throw new Error("migration 0050 is missing statements");

      // Whitespace-only has no non-empty comma-segment at all, so the repair pass must
      // leave it untouched -- there is nothing here for it to collapse to.
      await db.execute(sql.raw(repair));
      const [afterRepair] = await db
        .select({ role: schema.workspaceUserTable.role })
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspace.id),
            eq(schema.workspaceUserTable.userId, member.user.id),
          ),
        );
      expect(afterRepair?.role).toBe(raw);

      // And the refusal pass must catch it as empty-after-trim, the same way it already
      // catches a literal `""`. Drizzle wraps the driver error; the RAISE text is on
      // `cause`, not the outer message.
      const failure = await db.execute(sql.raw(refuse)).then(
        () => null,
        (error: unknown) => error as { cause?: { message?: string } },
      );
      expect(failure, `raw: ${JSON.stringify(raw)}`).not.toBeNull();
      const raised = failure?.cause?.message ?? "";
      expect(raised).toMatch(/#82/);
      expect(raised).toContain(member.user.id);

      await restoreRoleConstraint();
    },
  );

  it("passes silently when every row is already canonical -- the migration must be a no-op on a healthy deployment, or nobody can deploy it", async () => {
    const { app } = createApp();
    await workspaceWithMember(app, "viewer");

    const statements = await migrationStatements();
    const [repair, refuse] = statements;
    if (!repair || !refuse)
      throw new Error("migration 0050 is missing statements");

    await db.execute(sql.raw(repair));
    await expect(db.execute(sql.raw(refuse))).resolves.toBeDefined();

    // Three statements: repair, refuse, constrain. The third is asserted separately by the
    // oracle's CHECK-constraint test; it is named here so a future edit that adds or removes
    // a statement fails this test rather than silently changing what the other two are.
    expect(statements).toHaveLength(3);
    expect(statements[2]).toContain("workspace_member_role_single_value");
  });
});
