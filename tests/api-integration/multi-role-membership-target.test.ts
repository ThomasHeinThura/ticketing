/**
 * Issue #82 -- the four TARGET behaviours, now GREEN.
 *
 * This file arrived on `main` from PR #84 as four RED probes: each `it()` was named
 * `RED -- ...`, each body asserted the CURRENT WRONG ANSWER, and a `// TARGET:` comment
 * above each assertion named the value it must become once the remediation landed. That
 * shape existed because `pnpm check:skips` forbids `.skip`, so "expected to fail until #82
 * lands" could not be expressed as a skipped test.
 *
 * **#82's remediation has landed, and every one of the four has been flipped to its TARGET
 * value.** The `RED --` prefix is gone from each name for the same reason it was there: it
 * described the assertion's relationship to the fix, and that relationship has changed.
 * Each test below records, in its name, both what it now asserts and what it used to.
 *
 * WHERE THE FOUR BEHAVIOURS ARE ENFORCED:
 *
 *   1 + 2 (write boundary, array and string form)
 *       `apps/api/src/utils/organization-plugin-role-guard.ts`, half 1 -- refuses any
 *       organization-route body whose role field is not exactly one role, before the
 *       better-auth handler runs. Backstopped by the CHECK constraint from migration
 *       `0050`, so a write path nobody anticipated still cannot persist a union.
 *   3   (distinguishable failure)
 *       `apps/api/src/capabilities/index.ts` -- 409 `MALFORMED_MEMBERSHIP_ROLE`, computed
 *       from the evaluator's OWN resolution (`callerMembershipResolution`) so the endpoint
 *       and `hasWorkspacePermission` cannot drift apart.
 *   4   (creator authority requires an exact match)
 *       closed by 1 + 2, which is the resolution the probe itself sanctioned: "or, once
 *       cardinality is enforced at the write boundary above, this state can never arise at
 *       all -- either fix closes this probe". The state is now unreachable, so the demotion
 *       it enabled is refused by better-auth's own creator gate instead.
 *
 * ONE SETUP CHANGED, AND IT IS WORTH BEING EXPLICIT ABOUT. Probe 3 used to manufacture its
 * malformed row by asking the plugin for one. That route now returns 400, so the row is
 * planted directly instead, via `plantLegacyMembershipRole` -- which is not a weakening of
 * the probe but a correction of it: after the write boundary, a malformed row can ONLY
 * originate as legacy data written before the fix, and legacy data is precisely what the
 * read-side remediation exists to handle. The probe still asserts the same target.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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

describe("#82 TARGET 1+2 -- update-member-role rejects a multi-role write at the boundary", () => {
  it('role: ["admin","viewer"] is REJECTED (400) and the row keeps its prior single-role value (was: accepted 200, persisted "admin,viewer")', async () => {
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
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; field: string };
    expect(body.error).toBe("INVALID_ROLE_VALUE");
    expect(body.field).toBe("role");

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("viewer"); // unchanged, write refused
  });

  it('role: "admin,viewer" sent as ONE STRING is rejected the same way and at the same boundary -- crud-members.mjs:259 splits any string on comma before validating each piece, so the array-vs-string distinction in the body schema buys nothing and the guard must not rely on it (was: accepted 200, persisted "admin,viewer")', async () => {
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
      "admin,viewer",
    );
    expect(response.status).toBe(400);

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(targetMemberAfter.role).toBe("viewer");
  });
});

describe("#82 TARGET 3 -- a malformed row is reported DISTINGUISHABLY, not silently indistinguishable from a low-privilege real role", () => {
  it('/api/capabilities for a member whose row holds "admin,viewer" differs OBSERVABLY from a coherent "viewer" correctly denied the same checks -- different status and different body keys (was: same 200, same sixteen-key all-false map, so an operator could not tell "your membership row is corrupt" from "your role legitimately lacks this")', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const coherentViewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const malformedTarget = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    // Planted rather than written through the plugin: that route now returns 400. See the
    // file header -- after the write boundary this row can only be legacy data.
    await plantLegacyMembershipRole(
      workspace.id,
      malformedTarget.user.id,
      "admin,viewer",
    );

    const coherentResponse = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
      { headers: { cookie: coherentViewer.cookie } },
    );
    const malformedResponse = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
      { headers: { cookie: malformedTarget.cookie } },
    );

    expect(coherentResponse.status).toBe(200);
    expect(malformedResponse.status).toBe(409);
    expect(malformedResponse.status).not.toBe(coherentResponse.status);

    const coherentBody = (await coherentResponse.json()) as Record<
      string,
      unknown
    >;
    const malformedBody = (await malformedResponse.json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(malformedBody).sort()).not.toEqual(
      Object.keys(coherentBody).sort(),
    );
    expect(malformedBody.error).toBe("MALFORMED_MEMBERSHIP_ROLE");
    expect(malformedBody.problem).toBe("multi-valued");

    // And the coherent viewer's denial is still a plain, correct denial -- the new status
    // must not have swallowed the ordinary case.
    expect(coherentBody.createTasks).toBe(false);
    expect(coherentBody.deleteWorkspace).toBe(false);
  });
});

describe('#82 TARGET 4 -- creator authority can no longer be obtained by a role string that merely CONTAINS "owner"', () => {
  it('the "member,owner" state is unreachable, so the demotion of the REAL owner it used to enable is refused with 403 and the owner row is unchanged (was: the write was accepted, and crud-members.mjs:293-296 `.split(",").includes("owner")` plus `allowCreatorAllPermissions: true` let that member demote the workspace creator to viewer)', async () => {
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

    const escalate = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      ["member", "owner"],
    );
    expect(escalate.status).toBe(400);
    const stillPlainMember = await getMemberRow(workspace.id, target.user.id);
    expect(stillPlainMember.role).toBe("member");

    const demote = await updateMemberRoleViaPlugin(
      app,
      target.cookie,
      workspace.id,
      ownerMemberBefore.id,
      "viewer",
    );
    expect(demote.status).toBe(403);

    const ownerMemberAfter = await getMemberRow(workspace.id, owner.user.id);
    expect(ownerMemberAfter.role).toBe("owner"); // unchanged -- demotion refused
  });

  it('AND the legacy row cannot be used to get there either: a member whose row ALREADY holds "member,owner" is refused 409 on the plugin\'s own update-member-role route, so the plugin never reaches its `.split(",").includes("owner")` creator gate', async () => {
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

    await plantLegacyMembershipRole(
      workspace.id,
      target.user.id,
      "member,owner",
    );

    const demote = await updateMemberRoleViaPlugin(
      app,
      target.cookie,
      workspace.id,
      ownerMemberBefore.id,
      "viewer",
    );
    expect(demote.status).toBe(409);

    const ownerMemberAfter = await getMemberRow(workspace.id, owner.user.id);
    expect(ownerMemberAfter.role).toBe("owner");
  });
});
