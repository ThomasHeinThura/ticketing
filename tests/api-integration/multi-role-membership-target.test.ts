/**
 * Issue #82 -- RED PROBES for the TARGET behaviour, not yet implemented.
 *
 * These are NOT regressions and NOT placeholders: every test below is GREEN today, on
 * purpose, because each one asserts the CURRENT WRONG ANSWER. `pnpm check:skips` forbids
 * `.skip`/`.only`/`xit`/etc. on any test file, so "expected to fail until #82 lands" is
 * expressed the only way that stays enforceable: each `it()` name starts with `RED --`, each
 * body is a normal passing assertion, and a `// TARGET:` comment immediately above the
 * assertion says exactly what it must become. Flipping one of these tests once #82's fix
 * lands is a one-line change: replace the asserted value with the one the TARGET comment
 * names. When every test in this file has been flipped, delete this file's RED framing (or
 * fold the flipped assertions back into `multi-role-membership-characterization.test.ts`,
 * which is the equivalence oracle from that point on).
 *
 * Do not add coverage here beyond the four target behaviours issue #82's own scope list
 * names. Anything else belongs in the characterization file.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
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

describe("#82 RED -- update-member-role must reject a multi-role write at the boundary", () => {
  it('RED -- TODAY: role: ["admin","viewer"] is ACCEPTED (200) and persists "admin,viewer". TARGET (issue #82, scope item "native evaluator fails closed... do not implement comma-splitting to match the plugin", and "S7 write routes must never create a multi-role value, enforced at the route"): this must be REJECTED before persisting -- expect(response.status).toBe(400) and the row must be unchanged from its prior single-role value.', async () => {
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
    // TARGET: expect(response.status).toBe(400);
    expect(response.status).toBe(200);

    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    // TARGET: expect(targetMemberAfter.role).toBe("viewer"); // unchanged, write refused
    expect(targetMemberAfter.role).toBe("admin,viewer");
  });

  it('RED -- TODAY: role: "admin,viewer" sent as ONE STRING (not an array) is likewise accepted -- crud-members.mjs:259 splits any string on comma before validating each piece, so the array-vs-string distinction in the body schema buys nothing. TARGET: a single string containing a raw "," must be rejected the same way the array is, at the same boundary.', async () => {
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
    // TARGET: expect(response.status).toBe(400);
    expect(response.status).toBe(200);
    const targetMemberAfter = await getMemberRow(workspace.id, target.user.id);
    // TARGET: expect(targetMemberAfter.role).toBe("viewer");
    expect(targetMemberAfter.role).toBe("admin,viewer");
  });
});

describe("#82 RED -- a malformed row must be reported distinguishably, not silently indistinguishable from a low-privilege real role", () => {
  it('RED -- TODAY: /api/capabilities for a member whose role is "admin,viewer" (malformed) returns the EXACT SAME shape -- same 200 status, same plain `Record<string, boolean>`, every key false -- as a coherent member correctly assigned "viewer" and correctly denied the same checks. An operator (or the caller) cannot tell "your membership row is corrupt" from "your role legitimately lacks this". TARGET (issue #82 scope item: the evaluator must fail closed "and does so DISTINGUISHABLY, so an operator can tell \'malformed membership row\' from \'role has no such capability\'"): the malformed case must differ observably -- e.g. a non-200 status, or an explicit error/flag field -- from the coherent-viewer case.', async () => {
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
    const malformedMemberBefore = await getMemberRow(
      workspace.id,
      malformedTarget.user.id,
    );
    await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      malformedMemberBefore.id,
      ["admin", "viewer"],
    );

    const coherentResponse = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
      { headers: { cookie: coherentViewer.cookie } },
    );
    const malformedResponse = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
      { headers: { cookie: malformedTarget.cookie } },
    );

    // TARGET: expect(malformedResponse.status).not.toBe(coherentResponse.status);
    expect(malformedResponse.status).toBe(coherentResponse.status);

    const coherentBody = (await coherentResponse.json()) as Record<
      string,
      unknown
    >;
    const malformedBody = (await malformedResponse.json()) as Record<
      string,
      unknown
    >;
    // TARGET: expect(Object.keys(malformedBody).sort()).not.toEqual(Object.keys(coherentBody).sort());
    // -- e.g. the malformed response gains an explicit error/flag key the coherent one lacks.
    expect(Object.keys(malformedBody).sort()).toEqual(
      Object.keys(coherentBody).sort(),
    );
    // Every capability denied, identically, in both cases -- the "false" is real, and it is
    // indistinguishable from a role that legitimately has no such capability.
    for (const key of Object.keys(coherentBody)) {
      expect(malformedBody[key]).toBe(coherentBody[key]);
    }
  });
});

describe("#82 RED -- creator authority must require an EXACT single-value match, not \"the comma-split contains 'owner'\"", () => {
  it('RED -- TODAY: a role string that merely CONTAINS "owner" after a naive comma-split ("member,owner") is treated as full creator authority by update-member-role\'s own gate (crud-members.mjs:293-296 `.split(",").includes(creatorRole)`, :310-317 `allowCreatorAllPermissions: true`) -- enough to demote the REAL owner. TARGET (issue #82\'s own flag: "owner is the one role that keeps a compiled fallback, so a combination naming it is the highest-risk shape"): creator status must require role === "owner" EXACTLY (or, once cardinality is enforced at the write boundary above, this state can never arise at all -- either fix closes this probe).', async () => {
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

    await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      targetMemberBefore.id,
      ["member", "owner"],
    );

    const demote = await updateMemberRoleViaPlugin(
      app,
      target.cookie,
      workspace.id,
      ownerMemberBefore.id,
      "viewer",
    );
    // TARGET: expect(demote.status).toBe(403);
    expect(demote.status).toBe(200);

    const ownerMemberAfter = await getMemberRow(workspace.id, owner.user.id);
    // TARGET: expect(ownerMemberAfter.role).toBe("owner"); // unchanged -- demotion refused
    expect(ownerMemberAfter.role).toBe("viewer");
  });
});
