/**
 * Issue #82 — P0 SECURITY: "one workspace membership = exactly one role."
 *
 * Thomas's canonical rule: `workspace_member.role` must hold exactly one known role name.
 * `"admin,viewer"`, `"owner,admin"`, `"admin, viewer"` and `" admin"` are all invalid. There
 * is no union semantics and no comma-splitting, and malformed state must fail closed.
 *
 * THIS FILE IS THE ORACLE FOR #82, in the style of
 * `organization-plugin-characterization.test.ts` (S1): every assertion below is derived from
 * reading the actual file the assertion is about, driven over real HTTP against a real
 * PostgreSQL, and asserting on DATABASE STATE and on BOTH evaluators -- never on a response
 * shape alone. It is not investigation-only prose; every number and every file:line citation
 * in the comments was re-verified against the tree this file was written against
 * (`node_modules/.pnpm/better-auth@1.6.25.../better-auth/dist/plugins/organization/**`,
 * pinned by the lockfile) before being written down.
 *
 * WHY THIS EXISTS, and why it does not fix anything. `apps/api/src/utils/
 * require-workspace-permission.ts` does an EXACT-STRING lookup of `workspace_member.role`
 * (`role in builtInRoles`, or an exact `eq(workspaceRoleTable.role, role)`). The still-mounted
 * better-auth plugin route `POST /api/auth/organization/update-member-role` accepts `role` as
 * `z.union([z.string(), z.array(z.string())])` (crud-members.mjs:215) and, when given an
 * array, comma-joins it (`parseRoles`, organization.mjs:18-20) before persisting via
 * `adapter.updateMember` (adapter.mjs:194-202, `update: { role }`). The plugin's OWN
 * `/organization/has-permission` then reads that same column and splits it back apart on
 * comma, ORing across every piece (`permission.mjs:2-11`, `const roles = input.role.split(",")`).
 * The two evaluators therefore disagree about what a comma-joined value means: one splits
 * and ORs, the other requires an exact match and finds none.
 *
 * SECTION MAP:
 *   A. Primary reproduction -- the array persists comma-joined; the two evaluators diverge.
 *   B. Whitespace variants -- what the route itself does to whitespace, and what happens when
 *      a whitespace-carrying value lands in the column some other way (a legacy row).
 *   C. Escalation, not just lockout -- the still-mounted plugin's OWN mutation routes gate
 *      themselves on `hasPermission({ role: <the ACTOR's own possibly-malformed role> })`,
 *      which is the SAME split-and-OR function. A malformed actor role grants the actor the
 *      UNION of every named role's permissions on those routes, even though the native
 *      surface denies them everything. Section D goes further: a role string that merely
 *      CONTAINS "owner" gets full creator authority on `update-member-role`'s own gate,
 *      independent of the specific permission requested.
 *   D. related, pre-existing comma-split logic in `apps/api` itself (account-deletion.ts).
 *
 * RED PROBES (target behaviour for #82, not yet implemented) live in
 * `multi-role-membership-target.test.ts`, clearly marked there, not `.skip`ped.
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
  signUpUser,
  updateMemberRoleViaPlugin,
} from "./helpers/organization-http";

type App = ReturnType<typeof createApp>["app"];

async function checkPluginPermission(
  app: App,
  cookie: string,
  organizationId: string,
  permissions: Record<string, string[]>,
): Promise<boolean> {
  const response = await app.request("/api/auth/organization/has-permission", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ organizationId, permissions }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { success: boolean };
  return body.success;
}

async function getCapabilities(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Record<string, boolean>> {
  const response = await app.request(
    `/api/capabilities?workspaceId=${workspaceId}`,
    { headers: { cookie } },
  );
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

beforeEach(async () => {
  await resetTestDatabase();
});

describe("#82 A -- primary reproduction: the array form persists comma-joined, and the two evaluators diverge", () => {
  it("CONTROL: a single valid role string round-trips unchanged, and both evaluators agree", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      "admin",
    );
    expect(response.status).toBe(200);

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("admin");

    // Both evaluators agree for a coherent single-role value: admin has
    // task:create (legacy-better-auth-access-control.ts:53-59), so both grant it.
    expect(
      await checkPluginPermission(app, target.cookie, workspace.id, {
        task: ["create"],
      }),
    ).toBe(true);
    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.createTasks).toBe(true);
  });

  it('THE REPRODUCTION: role: ["admin","viewer"] persists as the literal text "admin,viewer" (crud-members.mjs:215 accepts the array, :259 flattens/splits/trims each element on comma, :322 parseRoles/organization.mjs:18-20 re-joins with ",", :342 adapter.updateMember writes it verbatim)', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      ["admin", "viewer"],
    );
    expect(response.status).toBe(200);
    // updateMemberRole's own handler returns `ctx.json(updatedMember)` directly
    // (crud-members.mjs:343) -- the member row itself, not wrapped in `{ member }`.
    const body = (await response.json()) as { role: string };
    // The plugin's own response already shows it: not an array, not "admin, viewer" --
    // the literal thirteen-character string "admin,viewer".
    expect(body.role).toBe("admin,viewer");

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("admin,viewer");
  });

  it('DIVERGENCE, side 1: the plugin\'s own has-permission splits "admin,viewer" on comma and ORs -- it grants task:create because the "admin" component authorizes it (permission.mjs:2-11)', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);
    await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      ["admin", "viewer"],
    );

    expect(
      await checkPluginPermission(app, target.cookie, workspace.id, {
        task: ["create"],
      }),
    ).toBe(true);
  });

  it('DIVERGENCE, side 2 -- and the direction: native /api/capabilities does an EXACT-STRING lookup and finds no role literally named "admin,viewer" -- it denies EVERY ONE of the 16 checks (fail-closed, a LOCKOUT of a member who holds a real "admin" role among the joined pieces, not an escalation) (require-workspace-permission.ts:108-131: `role in builtInRoles` fails, `customRoleStatements`\'s `eq(workspaceRoleTable.role, role)` finds no row either)', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);
    await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      ["admin", "viewer"],
    );

    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    for (const name of Object.keys(CAPABILITY_CHECKS)) {
      expect(capabilities[name], `capability "${name}" should be denied`).toBe(
        false,
      );
    }
  });

  it('"owner,admin" also persists verbatim, and the row still fails closed on the exact-match evaluators (require-workspace-permission.ts and require-workspace-role-authority.ts:79-82 both compare `=== "owner"` / do an exact DB lookup, and "owner,admin" matches neither)', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "member",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      ["owner", "admin"],
    );
    expect(response.status).toBe(200);

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("owner,admin");

    // require-workspace-permission.ts: `"owner,admin" in builtInRoles` is false, and
    // no workspace_role row is named "owner,admin" either -- statements is null, denied.
    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.deleteWorkspace).toBe(false);
  });

  it('CONTROL: an unknown role name is REJECTED by the route itself and never persisted -- the existing validation checks each element\'s NAME against known roles, it does not check the array\'s LENGTH. That is the precise shape of the gap: "admin,viewer" sails through because both "admin" and "viewer" individually validate', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      "superadmin-does-not-exist",
    );
    expect(response.status).toBe(400);

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("viewer");
  });
});

describe("#82 B -- whitespace variants", () => {
  it('ROUTE-LEVEL NORMALIZATION: role: "admin, viewer" (one string, embedded comma+space) is split/trimmed/rejoined the SAME as the array form and persists as "admin,viewer" -- no space (crud-members.mjs:259 `.flatMap(r => r.split(",")).map(r => r.trim())` runs whether ctx.body.role arrived as a string or an array)', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      "admin, viewer",
    );
    expect(response.status).toBe(200);

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("admin,viewer");
  });

  it('ROUTE-LEVEL NORMALIZATION: role: " admin" (leading space, no comma at all) still persists as "admin" -- the trim runs unconditionally, on every element, comma or not', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);

    const response = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      " admin",
    );
    expect(response.status).toBe(200);

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("admin");
  });

  it('A LEGACY ROW (route bypassed -- direct DB write, simulating a value the route\'s own sanitizer never saw): role = "admin, viewer" verbatim (comma, then a space) STILL diverges the same way as the clean "admin,viewer" case -- the plugin\'s split (permission.mjs:4, no .trim()) matches "admin" exactly and ORs it in; native denies on the exact string', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );

    await db
      .update(schema.workspaceUserTable)
      .set({ role: "admin, viewer" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, target.user.id),
        ),
      );

    expect(
      await checkPluginPermission(app, target.cookie, workspace.id, {
        task: ["create"],
      }),
    ).toBe(true);
    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.createTasks).toBe(false);
  });

  it('A LEGACY ROW with pure whitespace corruption and NO comma (role = " admin" verbatim) is denied by BOTH evaluators -- no divergence. This is the contrast that isolates the real defect: a malformed SINGLE value locks out uniformly (both sides agree); it is specifically the MULTI-value comma-joined shape that splits the two evaluators apart', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );

    await db
      .update(schema.workspaceUserTable)
      .set({ role: " admin" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, target.user.id),
        ),
      );

    expect(
      await checkPluginPermission(app, target.cookie, workspace.id, {
        task: ["create"],
      }),
    ).toBe(false);
    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.createTasks).toBe(false);
  });
});

describe("#82 C -- escalation IS reachable, via the still-mounted plugin's OWN mutation routes (not just lockout)", () => {
  // Every one of the plugin's other still-mounted mutation routes gates ITSELF on
  // `hasPermission({ role: member.role, ... })` where `member.role` is the ACTING caller's
  // own (possibly malformed) role -- never split/validated first. Confirmed call sites:
  // crud-org.mjs:207 (update), :269 (delete); crud-invites.mjs:95 (invite-member), :434
  // (cancel-invitation); crud-team.mjs:85,167,284,591,683 (create/update/delete team,
  // add/remove team member); crud-access-control.mjs:79,186,319,385,484 (create/delete/
  // read/update org role); crud-members.mjs:185 (remove-member). `hasPermissionFn`
  // (permission.mjs:2-11) splits that actor role on comma and ORs across every piece, so an
  // actor whose OWN role is comma-joined gets the UNION of every named role's permissions on
  // ALL of these routes -- a real escalation, confined to the plugin's surface (native routes
  // built on `requireWorkspacePermission` independently deny the same actor everything, per
  // section A), but live today because the plugin is still mounted.
  it('a member holding "member,admin" (an admin-granted, comma-joined role) succeeds on the plugin\'s OWN invite-member route (requires invitation:create, which plain "member" lacks per memberAc.statements but "admin" grants per adminAc.statements, access/statement.mjs:24-43) -- while /api/capabilities.inviteUsers denies the SAME actor', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "member",
    );
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);
    await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      ["member", "admin"],
    );

    // Plain "member" cannot invite -- confirmed here as a control before trusting the
    // escalation below means anything: memberAc.statements gives invitation: [].
    const inviteAsPlainMember = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "member",
    );
    expect(
      await checkPluginPermission(
        app,
        inviteAsPlainMember.cookie,
        workspace.id,
        {
          invitation: ["create"],
        },
      ),
    ).toBe(false);

    // The escalated actor DOES succeed at the plugin's real invite-member route.
    const inviteResponse = await app.request(
      "/api/auth/organization/invite-member",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: target.cookie,
        },
        body: JSON.stringify({
          organizationId: workspace.id,
          email: `escalation-${randomUUID()}@example.com`,
          role: "viewer",
        }),
      },
    );
    expect(inviteResponse.status).toBe(200);

    // Yet the native, exact-match surface denies the same actor the same capability.
    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.inviteUsers).toBe(false);
  });

  it('THE HIGHEST-RISK SHAPE (issue #82\'s own flag): a role string that merely CONTAINS "owner" -- "member,owner" -- gets FULL CREATOR AUTHORITY on update-member-role\'s own gate via `allowCreatorAllPermissions: true` (crud-members.mjs:293-296 `updaterIsCreator = member.role.split(",").includes(creatorRole)`, :310-317 the hasPermission call passes `allowCreatorAllPermissions: true`, permission.mjs:5-8 `isCreator && allowCreatorsAllPermissions` short-circuits to true BEFORE any specific permission is checked) -- enough to demote the REAL owner', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "member",
    );
    const ownerMemberBefore = await getMemberRow(workspace.id, owner.user.id);
    const targetMemberBefore = await getMemberRow(workspace.id, target.user.id);
    expect(ownerMemberBefore.role).toBe("owner");

    await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      ["member", "owner"],
    );
    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("member,owner");

    // Confirm the native surface still denies this actor member:update (manageTeam) --
    // the bifurcation this whole section is about.
    const capabilitiesBefore = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilitiesBefore.manageTeam).toBe(false);

    // The takeover: the escalated actor demotes the REAL owner to "viewer" through the
    // plugin's own update-member-role route.
    const demote = await updateMemberRoleViaPlugin(
      app,
      target.cookie,
      workspace.id,
      ownerMemberBefore.id,
      "viewer",
    );
    expect(demote.status).toBe(200);

    const ownerMemberAfter = await getMemberRow(workspace.id, owner.user.id);
    expect(ownerMemberAfter.role).toBe("viewer");
  });
});

describe('#82 D -- a related, PRE-EXISTING comma-split in apps/api itself: account-deletion.ts\'s "hasOwnerRole"', () => {
  // apps/api/src/user/account-deletion.ts:15-20 already implements comma-split-OR
  // semantics -- `role.split(",").map(trim().toLowerCase()).includes("owner")` -- and it is
  // DELIBERATE, already asserted by tests/api/user/account-deletion.test.ts's "matches owner
  // inside a comma separated role list". It exists so the account-deletion safety net (do
  // not let the last owner of a shared workspace delete their account) does not silently
  // MISS an embedded owner in a malformed row. It is not a new defect this file is
  // reporting -- it is flagged here because it is the one place in apps/api that already
  // treats a comma-joined role as a set, which is in direct tension with #82's canonical
  // rule ("no union semantics, no comma splitting", stated with no stated exception). The
  // recommendation section of the #82 report raises whether this carve-out should be kept,
  // bounded more explicitly, or reconciled once the evaluator enforces single-role rows.
  it('hasOwnerRole("member,owner") is true today -- this file is not asserting it is a bug, only that this exists and disagrees with the canon', async () => {
    const { hasOwnerRole } = await import(
      "../../apps/api/src/user/account-deletion"
    );
    expect(hasOwnerRole("member,owner")).toBe(true);
    expect(hasOwnerRole("admin,viewer")).toBe(false);
  });
});
