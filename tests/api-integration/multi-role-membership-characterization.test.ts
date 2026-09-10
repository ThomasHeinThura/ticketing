/**
 * Issue #82 — P0 SECURITY: "one workspace membership = exactly one role."
 *
 * Thomas's canonical rule: `workspace_member.role` must hold exactly one known role name.
 * `"admin,viewer"`, `"owner,admin"`, `"admin, viewer"` and `" admin"` are all invalid. There
 * is no union semantics and no comma-splitting, and malformed state must fail closed.
 *
 * THIS FILE IS THE ORACLE FOR #82. It arrived on `main` from PR #84 as a CHARACTERIZATION of
 * the defect — every assertion recorded what the code did on 2026-09-09, with no fix. The
 * remediation has since landed, so this file is now the EQUIVALENCE ORACLE PR #84's own header
 * said it would become: it asserts that the two evaluators AGREE, on every shape that used to
 * split them apart. The historical explanation is kept in full, because a test that says only
 * "this is refused" teaches the next reader nothing about why refusing is the whole point.
 *
 * Every assertion is driven over real HTTP against a real PostgreSQL and asserts on DATABASE
 * STATE and on BOTH evaluators — never on a response shape alone. Every `file:line` citation
 * was verified against **better-auth 1.6.30**, the version `pnpm-lock.yaml` pins, at
 * `node_modules/.pnpm/better-auth@1.6.30.../better-auth/dist/plugins/organization/**`. (An
 * earlier version of this header said `1.6.25`; both halves of that were wrong and were
 * corrected in #84. Getting the version of a security claim right matters more than usual —
 * an assertion verified against a version you do not ship proves nothing about what you ship.)
 *
 * ## THE DEFECT, AS IT WAS
 *
 * `apps/api/src/utils/require-workspace-permission.ts` does an EXACT-STRING lookup of
 * `workspace_member.role`. The still-mounted better-auth plugin route
 * `POST /api/auth/organization/update-member-role` accepted `role` as
 * `z.union([z.string(), z.array(z.string())])` (`crud-members.mjs:215`) and, given an array,
 * comma-joined it (`parseRoles`, `organization.mjs:18-20`) before persisting via
 * `adapter.updateMember`. The plugin's OWN evaluator then read that same column, split it back
 * apart on comma, and ORed across every piece (`permission.mjs:2-11`). So the two evaluators
 * disagreed about what a comma-joined value MEANS: one read a union, the other read an unknown
 * name.
 *
 * **The direction was NOT a harmless lockout.** `permission.mjs:5-8` short-circuits
 * `isCreator && allowCreatorsAllPermissions` to `true` BEFORE examining any specific
 * permission, and `crud-members.mjs:293-296` computes `isCreator` as
 * `member.role.split(",").includes("owner")`. Section C below measured the consequence: a
 * member whose role merely CONTAINED `owner` demoted the real workspace owner. That is a
 * privilege union, and it was reachable through an ordinary authorized request.
 *
 * ## THE THREE CONTROLS THAT CLOSE IT
 *
 *   1. `apps/api/src/utils/organization-plugin-role-guard.ts` — refuses to WRITE such a value
 *      through any organization route (400), and refuses to serve any organization route whose
 *      authorization would be decided FROM such a value (409), so the plugin's split-and-OR is
 *      never reached even for a row that predates the fix.
 *   2. `require-workspace-permission.ts` / `require-workspace-role-authority.ts` — refuse to
 *      READ such a value, explicitly and by name, through one shared resolution.
 *      `/api/capabilities` reports it as a distinguishable 409.
 *   3. Migration `0050` — repairs the unambiguously repairable rows, refuses to guess at the
 *      rest, and adds a CHECK constraint so the state cannot return through a path nobody
 *      anticipated.
 *
 * SECTION MAP:
 *   A. The write boundary — every shape that used to persist a union is now refused, and the
 *      single-role control still round-trips untouched.
 *   B. Whitespace variants, and legacy rows — what happens to a value the route never saw.
 *   C. The escalation, now closed — the same takeover sequence, refused at every step.
 *   D. The related, pre-existing comma-split in `account-deletion.ts`, and why it stays.
 *
 * The four behaviours PR #84 pinned as RED probes live in
 * `multi-role-membership-target.test.ts`, flipped to their target values.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CAPABILITY_CHECKS } from "../../apps/api/src/capabilities/capability-checks";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
  plantLegacyMembershipRole,
  signUpUser,
  updateMemberRoleViaPlugin,
} from "./helpers/organization-http";

type App = ReturnType<typeof createApp>["app"];

/**
 * The plugin's own evaluator, over real HTTP. Returns the raw response as well as the
 * verdict, because after #82 "the plugin refused to answer at all" (409) is a distinct and
 * important outcome from "the plugin answered false".
 */
async function pluginPermission(
  app: App,
  cookie: string,
  organizationId: string,
  permissions: Record<string, string[]>,
): Promise<{ status: number; success: boolean | null }> {
  const response = await app.request("/api/auth/organization/has-permission", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ organizationId, permissions }),
  });
  if (response.status !== 200)
    return { status: response.status, success: null };
  const body = (await response.json()) as { success: boolean };
  return { status: 200, success: body.success };
}

async function capabilitiesResponse(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Response> {
  return app.request(`/api/capabilities?workspaceId=${workspaceId}`, {
    headers: { cookie },
  });
}

async function getCapabilities(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Record<string, boolean>> {
  const response = await capabilitiesResponse(app, cookie, workspaceId);
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, boolean>;
}

async function getMemberRow(workspaceId: string, userId: string) {
  const [row] = await db
    .select({
      id: schema.workspaceUserTable.id,
      role: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("getMemberRow: no row for that workspace/user");
  return row;
}

/** Owner + a workspace + one invited member at `role`. The setup every section shares. */
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

beforeEach(async () => {
  await resetTestDatabase();
});

describe("#82 A -- the write boundary: no route may persist a multi-role value", () => {
  it("CONTROL: a single valid role string still round-trips unchanged, and both evaluators agree -- the remediation must not have broken the ordinary case", async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "viewer",
    );
    const memberRow = await getMemberRow(workspace.id, member.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      memberRow.id,
      "admin",
    );
    expect(response.status).toBe(200);
    expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
      "admin",
    );

    // admin has task:create (legacy-better-auth-access-control.ts:53-59), so both grant it.
    expect(
      (
        await pluginPermission(app, member.cookie, workspace.id, {
          task: ["create"],
        })
      ).success,
    ).toBe(true);
    expect(
      (await getCapabilities(app, member.cookie, workspace.id)).createTasks,
    ).toBe(true);
  });

  it('WAS THE REPRODUCTION: role: ["admin","viewer"] is now REFUSED (400) and nothing is persisted. It used to be accepted, and persisted the literal thirteen-character string "admin,viewer" (crud-members.mjs:215 accepts the array, :259 flattens/splits/trims, :322 parseRoles re-joins with ",", :342 adapter.updateMember writes it verbatim)', async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "viewer",
    );
    const memberRow = await getMemberRow(workspace.id, member.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      memberRow.id,
      ["admin", "viewer"],
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      "INVALID_ROLE_VALUE",
    );
    expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
      "viewer",
    );
  });

  it('"owner,admin" -- the highest-risk combination, since `owner` is the one role keeping a compiled fallback -- is refused at the same boundary and never reaches the column', async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "member",
    );
    const memberRow = await getMemberRow(workspace.id, member.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      memberRow.id,
      ["owner", "admin"],
    );
    expect(response.status).toBe(400);
    expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
      "member",
    );
  });

  it('every malformed shape is refused, not just the two-distinct-roles one: a trailing comma, a duplicate, an empty segment and a bare comma each name at most one role and are each still refused -- because better-auth SPLITS before reading, so "admin," is two pieces to it, and because a rule with exceptions is a rule nobody can check', async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "viewer",
    );
    const memberRow = await getMemberRow(workspace.id, member.user.id);

    for (const shape of ["admin,", ",admin", "admin,admin", ",", "admin, "]) {
      const response = await updateMemberRoleViaPlugin(
        app,
        owner.cookie,
        workspace.id,
        memberRow.id,
        shape,
      );
      expect(response.status, `role: ${JSON.stringify(shape)}`).toBe(400);
      expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
        "viewer",
      );
    }
  });

  it("the CHECK constraint from migration 0050 is the backstop under the guard: a direct database write of a comma-joined value is refused by PostgreSQL itself (SQLSTATE 23514), so a route nobody thought to guard -- including the native S7 role writes -- still cannot create the state", async () => {
    const { app } = createApp();
    const { workspace, member } = await workspaceWithMember(app, "viewer");

    // Drizzle wraps the driver error, so the constraint name and SQLSTATE live on `cause`
    // rather than in the thrown message. Asserted on both, because "it threw" alone would
    // also pass if the column had simply been dropped.
    const rejection = await db
      .update(schema.workspaceUserTable)
      .set({ role: "owner,admin" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, member.user.id),
        ),
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejection).not.toBeNull();
    const cause = (
      rejection as { cause?: { code?: string; constraint?: string } }
    ).cause;
    expect(cause?.code).toBe("23514"); // check_violation
    expect(cause?.constraint).toBe("workspace_member_role_single_value");

    expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
      "viewer",
    );
  });

  it("CONTROL, unchanged: an unknown single role name is still rejected by better-auth's own validation, with the guard passing it through untouched. The guard checks CARDINALITY; role EXISTENCE remains the plugin's (and the native evaluator's) question, and the two must not be conflated", async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "viewer",
    );
    const memberRow = await getMemberRow(workspace.id, member.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      memberRow.id,
      "superadmin-does-not-exist",
    );
    expect(response.status).toBe(400);
    expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
      "viewer",
    );
  });

  it("create-role can no longer mint a role NAME containing a comma -- a role that could only ever be referenced by a membership value the invariant forbids", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const response = await app.request("/api/auth/organization/create-role", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        organizationId: workspace.id,
        role: "admin,viewer",
        permission: { task: ["create"] },
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      "INVALID_ROLE_VALUE",
    );

    const rows = await db
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    expect(rows.map((row) => row.role)).not.toContain("admin,viewer");
  });
});

describe("#82 B -- whitespace variants, and legacy rows the route never sanitised", () => {
  it('role: "admin, viewer" (one string, embedded comma and space) is refused. It used to be split/trimmed/rejoined by crud-members.mjs:259 and persisted as "admin,viewer" -- identically to the array form, which is why the guard must not treat the string shape as the safe one', async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "viewer",
    );
    const memberRow = await getMemberRow(workspace.id, member.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      memberRow.id,
      "admin, viewer",
    );
    expect(response.status).toBe(400);
    expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
      "viewer",
    );
  });

  it('role: " admin" (leading space, no comma) is ALSO refused now, and this is a deliberate tightening rather than a consequence: better-auth would have trimmed it to a perfectly valid "admin" (crud-members.mjs:259 trims unconditionally), so the write was harmless in 1.6.30. It is refused anyway, because relying on a dependency\'s normalisation to maintain a TaskDesk invariant is the exact reasoning that produced this issue', async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "viewer",
    );
    const memberRow = await getMemberRow(workspace.id, member.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      memberRow.id,
      " admin",
    );
    expect(response.status).toBe(400);
    expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
      "viewer",
    );
  });

  it('A LEGACY ROW, which is the shape that still matters: role = "admin, viewer" written before the fix. The two evaluators now AGREE -- the plugin route refuses to answer (409) instead of splitting and ORing "admin" in, and /api/capabilities refuses distinguishably (409). This is the equivalence the whole issue was about', async () => {
    const { app } = createApp();
    const { workspace, member } = await workspaceWithMember(app, "viewer");
    await plantLegacyMembershipRole(
      workspace.id,
      member.user.id,
      "admin, viewer",
    );

    const plugin = await pluginPermission(app, member.cookie, workspace.id, {
      task: ["create"],
    });
    expect(plugin.status).toBe(409);
    expect(plugin.success).toBeNull(); // never answered "true" -- the union is unreachable

    const native = await capabilitiesResponse(app, member.cookie, workspace.id);
    expect(native.status).toBe(409);
    const body = (await native.json()) as { error: string; problem: string };
    expect(body.error).toBe("MALFORMED_MEMBERSHIP_ROLE");
    expect(body.problem).toBe("multi-valued");
  });

  it('A LEGACY ROW with pure whitespace corruption and NO comma (role = " admin"): both evaluators refuse, and the native side now says WHY. Before, both merely denied every check with a 200 -- the failure was uniform but invisible, indistinguishable from a role that legitimately lacks the capability', async () => {
    const { app } = createApp();
    const { workspace, member } = await workspaceWithMember(app, "viewer");
    await plantLegacyMembershipRole(workspace.id, member.user.id, " admin");

    const plugin = await pluginPermission(app, member.cookie, workspace.id, {
      task: ["create"],
    });
    expect(plugin.status).toBe(409);

    const native = await capabilitiesResponse(app, member.cookie, workspace.id);
    expect(native.status).toBe(409);
    expect(((await native.json()) as { problem: string }).problem).toBe(
      "untrimmed",
    );
  });

  it("a coherent member in the SAME workspace is unaffected by another member's corrupt row -- the refusal is scoped to the caller whose own membership is malformed, not to the workspace", async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "viewer",
    );
    const healthy = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "admin",
    );
    await plantLegacyMembershipRole(
      workspace.id,
      member.user.id,
      "owner,admin",
    );

    const capabilities = await getCapabilities(
      app,
      healthy.cookie,
      workspace.id,
    );
    expect(capabilities.createTasks).toBe(true);
    expect(
      (
        await pluginPermission(app, healthy.cookie, workspace.id, {
          task: ["create"],
        })
      ).success,
    ).toBe(true);
  });

  it('and the corrupt member is denied EVERY capability rather than granted the union -- the native evaluator refuses the value by name, it does not comma-split to match the plugin (issue #82: "do NOT implement comma-splitting")', async () => {
    const { app } = createApp();
    const { workspace, member } = await workspaceWithMember(app, "viewer");
    await plantLegacyMembershipRole(
      workspace.id,
      member.user.id,
      "owner,admin",
    );

    // The 409 body carries no capability keys at all, so there is nothing to grant. Asserted
    // explicitly against the full check list so a future response shape cannot quietly start
    // returning a true.
    const response = await capabilitiesResponse(
      app,
      member.cookie,
      workspace.id,
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as Record<string, unknown>;
    for (const name of Object.keys(CAPABILITY_CHECKS)) {
      expect(
        body[name],
        `capability "${name}" must not be present`,
      ).toBeUndefined();
    }
  });
});

describe("#82 C -- the escalation, now closed at every step", () => {
  // Every one of the plugin's still-mounted mutation routes gates ITSELF on
  // `hasPermission({ role: member.role, ... })` where `member.role` is the ACTING caller's
  // own role, never split/validated first. Confirmed call sites: crud-org.mjs:207, :269;
  // crud-invites.mjs:95, :434; crud-team.mjs:85,167,284,591,683;
  // crud-access-control.mjs:79,186,319,385,484; crud-members.mjs:185. `hasPermissionFn`
  // (permission.mjs:2-11) splits that actor role on comma and ORs across every piece. That
  // logic is still there -- this remediation does not fix better-auth, it removes the inputs
  // on which better-auth and TaskDesk disagree. S10 removes the plugin outright.
  it('a member holding "member,admin" can no longer reach the plugin\'s invite-member route at all. It used to succeed there -- invitation:create is denied to plain "member" (memberAc.statements) and granted by "admin" (adminAc.statements, access/statement.mjs:24-43), so the OR handed the actor a capability neither TaskDesk nor their real role gave them', async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "member",
    );

    // The state can no longer be created through the route at all...
    const memberRow = await getMemberRow(workspace.id, member.user.id);
    expect(
      (
        await updateMemberRoleViaPlugin(
          app,
          owner.cookie,
          workspace.id,
          memberRow.id,
          ["member", "admin"],
        )
      ).status,
    ).toBe(400);

    // ...and even planted as legacy data, it buys nothing: the invite is refused 409.
    await plantLegacyMembershipRole(
      workspace.id,
      member.user.id,
      "member,admin",
    );
    const invite = await app.request("/api/auth/organization/invite-member", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: member.cookie },
      body: JSON.stringify({
        organizationId: workspace.id,
        email: `escalation-${randomUUID()}@example.com`,
        role: "viewer",
      }),
    });
    expect(invite.status).toBe(409);

    // A plain "member" is denied the same route on the ordinary path, as the control.
    const plainMember = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "member",
    );
    expect(
      (
        await pluginPermission(app, plainMember.cookie, workspace.id, {
          invitation: ["create"],
        })
      ).success,
    ).toBe(false);
  });

  it('THE TAKEOVER, refused: a role string that merely CONTAINS "owner" no longer reaches update-member-role\'s creator gate. It used to grant FULL creator authority via `allowCreatorAllPermissions: true` (crud-members.mjs:293-296 `.split(",").includes(creatorRole)`, :310-317, permission.mjs:5-8 short-circuiting to true BEFORE any specific permission is checked) -- enough to demote the REAL owner to viewer, which is the measurement that makes this a privilege union and not a lockout', async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "member",
    );
    const ownerRow = await getMemberRow(workspace.id, owner.user.id);
    expect(ownerRow.role).toBe("owner");

    // Planted as legacy data -- the strongest form of the test, since it grants the attacker
    // the state the write boundary would have denied them and shows it still does not work.
    await plantLegacyMembershipRole(
      workspace.id,
      member.user.id,
      "member,owner",
    );

    const demote = await updateMemberRoleViaPlugin(
      app,
      member.cookie,
      workspace.id,
      ownerRow.id,
      "viewer",
    );
    expect(demote.status).toBe(409);

    expect((await getMemberRow(workspace.id, owner.user.id)).role).toBe(
      "owner",
    );
  });

  it("and the real owner keeps working throughout -- the guard refuses the corrupt actor, not the workspace, so ownership stays recoverable rather than becoming unmovable", async () => {
    const { app } = createApp();
    const { owner, workspace, member } = await workspaceWithMember(
      app,
      "member",
    );
    await plantLegacyMembershipRole(
      workspace.id,
      member.user.id,
      "member,owner",
    );

    // The owner can still repair the corrupt member: a single valid role is accepted.
    const memberRow = await getMemberRow(workspace.id, member.user.id);
    const repair = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      memberRow.id,
      "viewer",
    );
    expect(repair.status).toBe(200);
    expect((await getMemberRow(workspace.id, member.user.id)).role).toBe(
      "viewer",
    );

    // And the repaired member is a normal member again on both surfaces.
    expect(
      (await getCapabilities(app, member.cookie, workspace.id)).createTasks,
    ).toBe(false);
    expect(
      (
        await pluginPermission(app, member.cookie, workspace.id, {
          task: ["create"],
        })
      ).success,
    ).toBe(false);
  });
});

describe('#82 D -- the related, PRE-EXISTING comma-split in apps/api itself: account-deletion.ts\'s "hasOwnerRole"', () => {
  // `apps/api/src/user/account-deletion.ts` implements comma-split-OR semantics deliberately,
  // and it STAYS. It is the inclusive half of the asymmetry documented at length in
  // `workspace-member-roles.ts`: "is this member an owner?" wants the inclusive reading,
  // because a false `isOwner` SKIPS the last-owner block and orphans the workspace, while
  // "how many owners are there?" wants the exact one, because over-counting also skips it.
  // One predicate cannot serve both questions. #82's "no comma-splitting" rule governs the
  // AUTHORIZATION evaluators — what a role permits — not this safety net, which asks only
  // whether a value mentions owner at all, and which is strictly safer for mentioning it.
  it('hasOwnerRole("member,owner") is still true, and that is correct rather than a leftover -- with the invariant now enforced this predicate only ever meets legacy rows, which is exactly the case it exists to catch', async () => {
    const { hasOwnerRole } = await import(
      "../../apps/api/src/user/account-deletion"
    );
    expect(hasOwnerRole("member,owner")).toBe(true);
    expect(hasOwnerRole("admin,viewer")).toBe(false);
  });
});
