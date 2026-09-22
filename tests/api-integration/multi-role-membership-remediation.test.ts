/**
 * Issue #82 — the remediation surfaces that the oracle and the four flipped probes do not
 * reach on their own.
 *
 * `multi-role-membership-characterization.test.ts` used to prove the two evaluators AGREE, and
 * `multi-role-membership-target.test.ts` held the four behaviours PR #84 pinned -- both deleted
 * in S10 (issue #6) along with the organization() plugin they characterized. This file covers
 * the rest of issue #82's scope list:
 *
 *   §1  the native evaluator on an ORDINARY route — not just `/api/capabilities`, so the
 *       refusal is shown where the product actually enforces authorization;
 *   §2  `requireWorkspaceRoleAuthority` — the instance-admin twin of the same rule;
 *   §4  the RECOVERY strategy — migration `0050`'s own SQL, executed against real rows: it
 *       repairs what has one meaning and refuses to guess at what does not.
 *
 * §3 (every remaining role-bearing write on the mounted plugin, not only `update-member-role`)
 * is gone with the plugin (S10): it proved the now-deleted role guard blocked a comma-bearing
 * value on `invite-member`, `update-role` and `update-member-role`. No native replacement is
 * needed -- native's role-name Zod validation doesn't explicitly reject a comma either, but
 * native's evaluator (`workspaceRolePermission`, `apps/api/src/utils/workspace-member-roles.ts`)
 * is always an exact-string match against `workspace_role.role`, never a comma-split-then-union
 * the way the plugin's evaluator was, so a role literally named with a comma would just be
 * evaluated as one oddly-named role, not exploited as a union of two. The vulnerability class
 * §3 guarded against has no native analog, comma or not.
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
  plantLegacyMembershipRole,
  signUpInstanceAdmin,
  signUpUser,
} from "./helpers/organization-http";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type App = ReturnType<typeof createApp>["app"];

/**
 * Consumes the instance-admin slot.
 *
 * #18: `signUpUser` can no longer become instance admin by accident (a zero-user
 * instance now refuses to promote anyone without a valid setup token), so this is
 * belt-and-suspenders rather than load-bearing -- kept so the intent stays literal
 * rather than merely implied, and so a future reader does not have to rediscover why
 * it is here.
 */
async function burnInstanceAdminSlot(app: App): Promise<void> {
  await signUpUser(app);
}

async function workspaceWithMember(
  app: App,
  role: string,
  options?: { ownerIsInstanceAdmin?: boolean },
) {
  const owner = options?.ownerIsInstanceAdmin
    ? await signUpInstanceAdmin(app)
    : await signUpUser(app);
  const created = await createWorkspaceNative(app, owner.cookie);
  const workspace = (await created.json()) as { id: string };
  const member = await inviteAndAcceptAsNewMemberNative(
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
    // #18: instance-admin bootstrap now requires a valid setup token, so this owner
    // is deliberately signed up through the real bootstrap flow (`ownerIsInstanceAdmin`)
    // rather than relying on "first user in an empty database" the way this test used
    // to -- that is also the single most common real-world shape (the operator who set
    // the instance up and created the first workspace).
    const { owner, workspace } = await workspaceWithMember(app, "viewer", {
      ownerIsInstanceAdmin: true,
    });

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

describe("#82 §4 -- the recovery strategy: migration 0050's own SQL, against real rows", () => {
  it("REPAIRS a comma-bearing value only when every raw piece is ALREADY the exact same well-formed byte string -- CORRECTED after formal review R1 (see the dedicated regression below): no trimming is ever performed to reach agreement, only to confirm a piece that already agrees is not itself malformed", async () => {
    const { app } = createApp();
    const { owner, workspace } = await workspaceWithMember(app, "viewer");

    const shapes = [
      { raw: "admin,admin", repaired: "admin" },
      { raw: "admin,", repaired: "admin" },
      { raw: ",admin", repaired: "admin" },
      { raw: "admin,,admin", repaired: "admin" },
    ];

    const [repair] = await migrationStatements();
    if (!repair) throw new Error("migration 0050 has no statements");

    for (const shape of shapes) {
      await withoutRoleConstraint();
      const member = await inviteAndAcceptAsNewMemberNative(
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

      await restoreRoleConstraint();
    }
  });

  it("REGRESSION (formal review R1) -- REFUSES rather than repairs a no-comma padded value, or a comma-bearing value whose raw pieces are not byte-identical, and leaves the row completely unchanged", async () => {
    const { app } = createApp();
    const { owner, workspace } = await workspaceWithMember(app, "viewer");

    // Every one of these was, under the ORIGINAL (pre-review) grouping rule, collapsed to
    // "admin" the same way "admin,admin" is -- because that rule grouped by DISTINCT
    // TRIMMED segment, not by "already byte-identical raw piece". Six of these seven shapes
    // used to live in the REPAIR test above with `repaired: "admin"`. Finding 3's
    // tab/NBSP/BOM padding cases are included here rather than removed, because the
    // corrected rule changes their classification (repair -> refuse), not their coverage.
    const shapes = [
      " admin",
      " admin ",
      "admin, admin",
      " admin,admin",
      "\tadmin",
      "admin\n",
      "\u00a0admin",
      "admin\ufeff",
    ];

    const [repair, refuse] = await migrationStatements();
    if (!repair || !refuse)
      throw new Error("migration 0050 is missing statements");

    for (const raw of shapes) {
      await withoutRoleConstraint();
      const member = await inviteAndAcceptAsNewMemberNative(
        app,
        owner.cookie,
        workspace.id,
        "viewer",
      );
      await db.execute(
        sql`UPDATE "workspace_member" SET "role" = ${raw} WHERE "workspace_id" = ${workspace.id} AND "user_id" = ${member.user.id}`,
      );

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
      expect(afterRepair?.role, `raw: ${JSON.stringify(raw)}`).toBe(raw); // UNCHANGED

      const failure = await db.execute(sql.raw(refuse)).then(
        () => null,
        (error: unknown) => error as { cause?: { message?: string } },
      );
      expect(failure, `raw: ${JSON.stringify(raw)}`).not.toBeNull();
      const raised = failure?.cause?.message ?? "";
      expect(raised, `raw: ${JSON.stringify(raw)}`).toMatch(/#82/);
      expect(raised, `raw: ${JSON.stringify(raw)}`).toContain(member.user.id);

      await restoreRoleConstraint();
    }
  });

  it("REGRESSION (formal review R1) -- a legacy ' owner' row grants NOTHING today, the repair leaves it untouched rather than manufacturing full owner authority, and the member never obtains that authority through the running application at any point in the sequence", async () => {
    const { app } = createApp();
    await burnInstanceAdminSlot(app);
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    await withoutRoleConstraint();
    await db.execute(
      sql`UPDATE "workspace_member" SET "role" = ' owner' WHERE "workspace_id" = ${workspace.id} AND "user_id" = ${owner.user.id}`,
    );

    // PRE-FIX CONTROL: today, before any migration statement runs, this padded value grants
    // this member NOTHING under the real evaluator -- traced against the actual installed
    // better-auth, `" owner".split(",")` = `[" owner"]`, and neither the creator check nor
    // any `acRoles` lookup matches the padded string, so the plugin denies too. This is not
    // "not yet repaired" -- it is genuinely zero authority right now.
    const before = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(before.status).toBe(409);
    expect(((await before.json()) as { problem: string }).problem).toBe(
      "untrimmed",
    );

    // HISTORICAL, NOT PRODUCTION CODE. The ORIGINAL version of the migration's repair rule
    // grouped by DISTINCT TRIMMED segment, so it collapsed a lone padded piece exactly the
    // way it collapsed a genuine comma-duplicate. Reimplemented inline, once, ONLY to prove
    // what that defect would have computed for this exact row -- never reinstated as a real
    // code path. This is the RED half of the RED/GREEN proof.
    function historicalPreReviewRepairRule(value: string): string | null {
      const segments = [
        ...new Set(
          value
            .split(",")
            .map((piece) => piece.trim())
            .filter((piece) => piece.length > 0),
        ),
      ];
      return segments.length === 1 ? (segments[0] ?? null) : null;
    }
    expect(historicalPreReviewRepairRule(" owner")).toBe("owner");

    const [repair, refuse] = await migrationStatements();
    if (!repair || !refuse)
      throw new Error("migration 0050 is missing statements");

    // GREEN: the actual shipped repair statement leaves the row untouched -- not "owner".
    await db.execute(sql.raw(repair));
    const [afterRepair] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, owner.user.id),
        ),
      );
    expect(afterRepair?.role).toBe(" owner");

    // And the refusal pass stops the migration, naming the row well enough for an operator
    // to find and fix it -- exactly as it would for a genuine two-role conflict.
    const failure = await db.execute(sql.raw(refuse)).then(
      () => null,
      (error: unknown) => error as { cause?: { message?: string } },
    );
    expect(failure).not.toBeNull();
    const raised = failure?.cause?.message ?? "";
    expect(raised).toMatch(/#82/);
    expect(raised).toContain(owner.user.id);

    // End to end: this member never obtained owner authority through the running
    // application at any point in this sequence.
    const stillNoAuthority = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(stillNoAuthority.status).toBe(409);

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
