/**
 * Issue #82 — the read half must not be steerable, and the way it stops being steerable is by
 * asking a question with no target in it.
 *
 * ## Three versions of this control, two of them bypassed
 *
 * Half 2 of `organization-plugin-role-guard.ts` refuses a request when the caller's own
 * `workspace_member.role` is malformed, because better-auth's evaluator comma-SPLITS that
 * column and ORs the parts (`permission.mjs:4-8`) — so `"owner,admin"` grants the union of
 * both roles while TaskDesk's evaluator matches exactly and denies.
 *
 * To do that it first had to decide *which* workspace the request was about, and every way of
 * deciding was steerable, because the answer lives inside better-auth and differs per route:
 *
 *   v1  body → query → session-active, first hit wins.
 *       `update-member-role` never reads the query, so `?organizationId=<any id>` aimed the
 *       guard at a workspace the caller held no row in while the handler acted on the
 *       session-active one. **Control 409, steered 200, the write landed.**
 *
 *   v2  check ALL of body, query and session-active.
 *       `cancel-invitation` derives its workspace from `invitation.organizationId` — a fourth
 *       source none of those three name. Unset the session's active workspace (`set-active`
 *       with `null`, which is EXEMPT and therefore reachable while holding the malformed row)
 *       and all three candidates are empty, the guard returns early, and the plugin reads
 *       `"owner,admin"` and ORs it. **Control 409, steered 200, the invitation was canceled.**
 *       `update-team` was the same shape through `body.data.organizationId` — and pointedly,
 *       `roleWriteProblems` in that same file already walked `body.data` for role fields, so
 *       the omission was an internal inconsistency rather than a judgement call.
 *
 *   v3  don't resolve a target at all. Ask whether the CALLER holds a malformed role
 *       anywhere (`firstMalformedMembershipRole`). No request shape can steer a question with
 *       no target in it, and there is no empty-candidate case to fall through.
 *
 * This file is the regression suite for v3, written from v2's demonstrated exploit. Every
 * probe asserts the **row**, not the status code: the v2 escalation returned `200` and moved
 * the invitation to `canceled`, so a probe reading only the response would have called it a
 * pass.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  invitationStatus,
  inviteAndAcceptAsNewMember,
  organizationActionViaPlugin,
  plantLegacyMembershipRole,
  signUpUser,
} from "./helpers/organization-http";

type App = ReturnType<typeof createApp>["app"];

async function pendingInvitationIn(
  app: App,
  cookie: string,
  workspaceId: string,
) {
  const response = await organizationActionViaPlugin(
    app,
    cookie,
    "invite-member",
    {
      organizationId: workspaceId,
      email: `target-${Date.now()}@invite.test`,
      role: "member",
    },
  );
  expect(response.status).toBe(200);
  const [row] = await db
    .select({ id: schema.invitationTable.id })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.status, "pending"),
      ),
    )
    .limit(1);
  if (!row)
    throw new Error("pendingInvitationIn: no pending invitation was created");
  return row.id;
}

/**
 * An actor owning workspace B with a pending invitation in it, plus a second healthy
 * workspace A they also own — so a probe can name A while the malformed row is in B.
 *
 * `auth.ts` promotes the first user in an empty database to instance admin and
 * `resetTestDatabase()` empties it before each test, so a throwaway user takes that slot
 * first; otherwise the actor would also be an instance admin and take a different
 * authorization branch than a plain workspace owner.
 */
async function scenario(app: App) {
  await signUpUser(app); // consumes the instance-admin slot
  const actor = await signUpUser(app);
  const createdA = await createWorkspaceViaPlugin(app, actor.cookie);
  const workspaceA = ((await createdA.json()) as { id: string }).id;
  const createdB = await createWorkspaceViaPlugin(app, actor.cookie);
  const workspaceB = ((await createdB.json()) as { id: string }).id;
  const invitationId = await pendingInvitationIn(app, actor.cookie, workspaceB);
  return { actor, workspaceA, workspaceB, invitationId };
}

/** `set-active` with `null` — exempt from the read check, so reachable while malformed. */
async function unsetActiveWorkspace(app: App, cookie: string) {
  const response = await organizationActionViaPlugin(
    app,
    cookie,
    "set-active",
    {
      organizationId: null,
    },
  );
  expect(response.status).toBe(200);
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("#82 B-1 — cancel-invitation cannot be steered by emptying every candidate", () => {
  it("refuses when the caller holds a malformed role and NO workspace is named anywhere", async () => {
    const { app } = createApp();
    const { actor, workspaceB, invitationId } = await scenario(app);
    await plantLegacyMembershipRole(workspaceB, actor.user.id, "owner,admin");
    await unsetActiveWorkspace(app, actor.cookie);

    // Body names no workspace; the query names none; session-active is null. Under v2 all
    // three candidates were empty and half 2 never ran.
    const response = await organizationActionViaPlugin(
      app,
      actor.cookie,
      "cancel-invitation",
      { invitationId },
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error?: string }).error).toBe(
      "MALFORMED_MEMBERSHIP_ROLE",
    );
    // The assertion that actually matters: the v2 bypass moved this to "canceled".
    expect(await invitationStatus(invitationId)).toBe("pending");
  });

  it("refuses when the active workspace is a DIFFERENT, healthy one — the deliberate widening", async () => {
    const { app } = createApp();
    const { actor, workspaceA, workspaceB, invitationId } = await scenario(app);
    await plantLegacyMembershipRole(workspaceB, actor.user.id, "owner,admin");
    await organizationActionViaPlugin(app, actor.cookie, "set-active", {
      organizationId: workspaceA,
    });

    const response = await organizationActionViaPlugin(
      app,
      actor.cookie,
      "cancel-invitation",
      { invitationId },
    );

    // This is stricter than the per-workspace check was, on purpose: the malformed row is in
    // B and the session points at A. v2 answered 200 here and canceled the invitation.
    expect(response.status).toBe(409);
    expect(await invitationStatus(invitationId)).toBe("pending");
  });

  it("refuses on a route acting purely on the HEALTHY workspace, while a malformed row sits in the other", async () => {
    const { app } = createApp();
    const { actor, workspaceA, workspaceB } = await scenario(app);
    await plantLegacyMembershipRole(workspaceB, actor.user.id, "owner,admin");
    // Point the session at A as well, so NEITHER the body nor the query nor session-active
    // names the malformed workspace. Without this the probe is not discriminating: creating
    // B last leaves it session-active, so even v2's enumeration would have found it there.
    await organizationActionViaPlugin(app, actor.cookie, "set-active", {
      organizationId: workspaceA,
    });

    const response = await organizationActionViaPlugin(
      app,
      actor.cookie,
      "invite-member",
      {
        organizationId: workspaceA,
        email: "someone@healthy.test",
        role: "member",
      },
    );

    // Recorded as a test rather than left as prose: the widening means a corrupt row anywhere
    // refuses every non-exempt route, including ones naming an unrelated healthy workspace.
    expect(response.status).toBe(409);
  });
});

describe("#82 B-1 — update-team cannot be steered through body.data.organizationId", () => {
  it("refuses a rename whose workspace is named only inside `data`", async () => {
    const { app } = createApp();
    const { actor, workspaceA, workspaceB } = await scenario(app);

    const createdTeam = await organizationActionViaPlugin(
      app,
      actor.cookie,
      "create-team",
      { organizationId: workspaceB, name: "Original" },
    );
    expect(createdTeam.status).toBe(200);
    const teamId = ((await createdTeam.json()) as { id: string }).id;

    await plantLegacyMembershipRole(workspaceB, actor.user.id, "owner,admin");
    await organizationActionViaPlugin(app, actor.cookie, "set-active", {
      organizationId: workspaceA,
    });

    const response = await organizationActionViaPlugin(
      app,
      actor.cookie,
      "update-team",
      { teamId, data: { name: "PWNED", organizationId: workspaceB } },
    );

    expect(response.status).toBe(409);

    const [team] = await db
      .select({ name: schema.teamTable.name })
      .from(schema.teamTable)
      .where(eq(schema.teamTable.id, teamId))
      .limit(1);
    // v2 renamed it. The name is the oracle, not the status.
    expect(team?.name).toBe("Original");
  });
});

describe("#82 B-1 — the refusal is an ESCALATION guard, not a blanket denial", () => {
  it("ORACLE: the same route, same steering, a clean single role — succeeds", async () => {
    const { app } = createApp();
    const { actor, workspaceA, invitationId } = await scenario(app);
    // No malformed row planted at all.
    await organizationActionViaPlugin(app, actor.cookie, "set-active", {
      organizationId: workspaceA,
    });

    const response = await organizationActionViaPlugin(
      app,
      actor.cookie,
      "cancel-invitation",
      { invitationId },
    );

    // Without this, every refusal above would be satisfied by a guard that denied everything.
    expect(response.status).toBe(200);
    expect(await invitationStatus(invitationId)).toBe("canceled");
  });

  it("ESCALATION CONTROL: a clean `viewer` is denied the same action, so `owner,admin` was buying real authority", async () => {
    const { app } = createApp();
    await signUpUser(app); // instance-admin slot
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = ((await created.json()) as { id: string }).id;
    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace,
      "viewer",
    );
    const invitationId = await pendingInvitationIn(
      app,
      owner.cookie,
      workspace,
    );

    const response = await organizationActionViaPlugin(
      app,
      viewer.cookie,
      "cancel-invitation",
      { invitationId },
    );

    // A `viewer` may not cancel invitations. That is what made the v2 bypass an escalation
    // rather than a divergence: the same member, same route, same steering, denied on their
    // real role and successful on the comma-joined one.
    expect(response.status).not.toBe(200);
    expect(await invitationStatus(invitationId)).toBe("pending");
  });
});
