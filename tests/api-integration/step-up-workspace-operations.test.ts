/**
 * Elevated workspace operations spend a real step-up proof (GM-2, AK-7, RL-1/RL-4).
 *
 * Role create, role update, service-key create and ownership transfer used to declare
 * `elevated: true` while only `requireSessionOnly` ran. Each now spends a one-use,
 * operation-bound, route-bound PA-15 proof inside its own write transaction. For every route this
 * file proves the runtime behaviour, not the declaration: no proof is refused, a proof bound to
 * different content is refused, a replay is refused, a refused request does not burn the proof,
 * and the one successful request consumes exactly one.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "./helpers/step-up";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import { transferWorkspaceOwnershipNative } from "./helpers/workspace-membership-write-http";
import {
  createWorkspaceRoleNative,
  updateWorkspaceRoleNative,
} from "./helpers/workspace-role-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type App = ReturnType<typeof createApp>["app"];

beforeEach(async () => {
  await resetTestDatabase();
});

async function workspaceFor(app: App, cookie: string, name: string) {
  const created = await createWorkspaceNative(app, cookie, { name });
  expect(created.status, await created.clone().text()).toBe(200);
  return ((await created.json()) as { id: string }).id;
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function proofRows(operation: string) {
  return db
    .select({ state: schema.stepUpConfirmationTable.state })
    .from(schema.stepUpConfirmationTable)
    .where(eq(schema.stepUpConfirmationTable.operationKey, operation));
}

async function auditCount(action: string) {
  return (
    await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, action))
  ).length;
}

async function createServiceKey(
  app: App,
  cookie: string,
  workspaceId: string,
  payload: Record<string, unknown>,
  token?: string,
) {
  return csrfRequest(
    app,
    `/api/workspaces/${workspaceId}/api-keys`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        ...(token ? { [STEP_UP_TOKEN_HEADER]: token } : {}),
      },
      body: JSON.stringify(payload),
    },
    cookie,
  );
}

describe("role create spends a step-up proof (workspace_role_create)", () => {
  it("refuses without a proof, with another request's proof, and on replay; consumes exactly one", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await workspaceFor(app, owner.cookie, "Roles");
    const role = { role: "Auditors", capabilities: ["work_item:read"] };

    const none = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role,
      false,
    );
    expect(none.status).toBe(403);
    expect(await none.text()).toBe("step_up_required");

    // A proof for a different capability set must not authorise this one.
    const wrongBody = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_role_create",
      {
        workspaceId,
        role: "Auditors",
        capabilities: ["work_item:read", "work_item:update"],
      },
    );
    const wrong = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role,
      wrongBody as string,
    );
    expect(wrong.status).toBe(403);
    expect(await wrong.text()).toBe("step_up_unavailable");
    expect(
      await db
        .select()
        .from(schema.roleTable)
        .where(eq(schema.roleTable.key, "auditors")),
    ).toHaveLength(0);

    // A proof for another workspace does not authorise this one either.
    const otherWorkspaceId = await workspaceFor(app, owner.cookie, "Other");
    const elsewhere = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_role_create",
      { workspaceId: otherWorkspaceId, ...role },
    );
    const crossed = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role,
      elsewhere as string,
    );
    expect(crossed.status).toBe(403);

    const token = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_role_create",
      { workspaceId, ...role },
    );
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role,
      token as string,
    );
    expect(created.status, await created.clone().text()).toBe(200);

    const replay = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { ...role, role: "Auditors again" },
      token as string,
    );
    expect(replay.status).toBe(403);
    // Only the one successful request wrote a consumption record; refusals rolled theirs back.
    expect(await auditCount("auth.step_up_consumed")).toBe(1);
  });

  it("does not burn the proof on a refused request, and keeps the domain refusal", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await workspaceFor(app, owner.cookie, "Burn");
    const role = { role: "Duplicate", capabilities: ["work_item:read"] };
    const first = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role,
    );
    expect(first.status).toBe(200);

    // The same name again is a 409; its proof is minted, then refused, and stays unspent.
    const token = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_role_create",
      { workspaceId, ...role },
    );
    const duplicate = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role,
      token as string,
    );
    expect(duplicate.status).toBe(409);
    const rows = await proofRows("workspace_role_create");
    expect(rows.filter((row) => row.state === "issued")).toHaveLength(1);

    // A request refused for a domain reason answers that reason without any proof at all.
    const noProofRefusal = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "owner", capabilities: [] },
      false,
    );
    expect(noProofRefusal.status).toBe(400);
  });

  it("refuses a member who lacks the authority even holding a proof for someone else", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await workspaceFor(app, owner.cookie, "Authority");
    const member = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    const challenge = await csrfRequest(
      app,
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: member.cookie },
        body: JSON.stringify({
          kind: "operation",
          operation: "workspace_role_create",
          workspaceId,
          role: "Sneaky",
          capabilities: ["work_item:read"],
        }),
      },
      member.cookie,
    );
    expect(challenge.status).toBe(403);
  });
});

describe("role update spends a step-up proof (workspace_role_update)", () => {
  it("binds the exact change to the role, spends one proof and refuses a replay", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await workspaceFor(app, owner.cookie, "Update");
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "Editors", capabilities: ["work_item:read"] },
    );
    expect(created.status).toBe(200);
    const { id: roleId } = (await created.json()) as { id: string };

    const change = { capabilities: ["work_item:read", "work_item:update"] };
    const none = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
      change,
      false,
    );
    expect(none.status).toBe(403);
    expect(await none.text()).toBe("step_up_required");

    // A proof for a different role id is not valid for this role.
    const otherRole = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "Other editors", capabilities: ["work_item:read"] },
    );
    const { id: otherRoleId } = (await otherRole.json()) as { id: string };
    const wrongRole = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_role_update",
      { workspaceId, roleId: otherRoleId, ...change },
    );
    const crossed = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
      change,
      wrongRole as string,
    );
    expect(crossed.status).toBe(403);

    const token = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_role_update",
      { workspaceId, roleId, ...change },
    );
    const updated = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
      change,
      token as string,
    );
    expect(updated.status, await updated.clone().text()).toBe(200);

    const replay = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
      change,
      token as string,
    );
    expect(replay.status).toBe(403);
  });

  it("keeps the proof unspent through the self-edit confirmation and spends it on the retry", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await workspaceFor(app, owner.cookie, "Self edit");
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "Ops",
        rank: 30,
        capabilities: ["workspace:manage_roles", "work_item:read"],
      },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const { id: roleId } = (await created.json()) as { id: string };
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "ops",
    );

    // `confirmSelfEdit` is not part of the binding, so one proof covers both attempts.
    const change = { capabilities: ["workspace:manage_roles"] };
    const token = await mintStepUpToken(
      app,
      holder.cookie,
      "workspace_role_update",
      { workspaceId, roleId, ...change },
    );
    expect(token).not.toBeNull();

    const unconfirmed = await updateWorkspaceRoleNative(
      app,
      holder.cookie,
      workspaceId,
      roleId,
      change,
      token as string,
    );
    expect(unconfirmed.status).toBe(409);
    expect(await body(unconfirmed)).toMatchObject({
      error: "self_edit_confirmation_required",
    });
    expect(
      (await proofRows("workspace_role_update")).map((row) => row.state),
    ).toEqual(["issued"]);

    const confirmed = await updateWorkspaceRoleNative(
      app,
      holder.cookie,
      workspaceId,
      roleId,
      { ...change, confirmSelfEdit: true },
      token as string,
    );
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    expect(
      (await proofRows("workspace_role_update")).map((row) => row.state),
    ).toEqual(["consumed"]);
  });

  it("answers a challenge for a role that does not exist with 404", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await workspaceFor(app, owner.cookie, "Missing");
    const token = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_role_update",
      { workspaceId, roleId: "no-such-role", name: "Renamed" },
    );
    expect(token).toBeNull();
  });
});

describe("service-key create spends a step-up proof (service_key_create, AK-7)", () => {
  it("refuses without a proof or with another key's proof, then creates once", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await workspaceFor(app, owner.cookie, "Keys");
    const payload = {
      name: "CI bot",
      capabilities: ["work_item:read", "workspace:read"],
    };

    const none = await createServiceKey(
      app,
      owner.cookie,
      workspaceId,
      payload,
    );
    expect(none.status).toBe(403);
    expect(await none.text()).toBe("step_up_required");

    const widerBinding = await mintStepUpToken(
      app,
      owner.cookie,
      "service_key_create",
      {
        workspaceId,
        name: "CI bot",
        capabilities: ["work_item:read", "work_item:update", "workspace:read"],
      },
    );
    const wider = await createServiceKey(
      app,
      owner.cookie,
      workspaceId,
      payload,
      widerBinding as string,
    );
    expect(wider.status).toBe(403);
    expect(await wider.text()).toBe("step_up_unavailable");

    const token = await mintStepUpToken(
      app,
      owner.cookie,
      "service_key_create",
      { workspaceId, ...payload },
    );
    const created = await createServiceKey(
      app,
      owner.cookie,
      workspaceId,
      payload,
      token as string,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    expect((await body(created)).key).toEqual(expect.any(String));

    const replay = await createServiceKey(
      app,
      owner.cookie,
      workspaceId,
      { ...payload, name: "CI bot 2" },
      token as string,
    );
    expect(replay.status).toBe(403);
    const keys = await db
      .select({ id: schema.apikeyTable.id })
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.name, "CI bot"));
    expect(keys).toHaveLength(1);
  });
});

describe("ownership transfer spends a step-up proof (workspace_ownership_transfer)", () => {
  it("refuses without a proof or one bound to another new owner, then transfers once", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await workspaceFor(app, owner.cookie, "Transfer");
    const first = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const second = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    const none = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: first.user.id },
      false,
    );
    expect(none.status).toBe(403);
    expect(await none.text()).toBe("step_up_required");

    const forSecond = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_ownership_transfer",
      { workspaceId, newOwnerUserId: second.user.id },
    );
    const crossed = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: first.user.id },
      forSecond as string,
    );
    expect(crossed.status).toBe(403);
    const stillOwner = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, owner.user.id),
        ),
      );
    expect(stillOwner[0]?.role).toBe("owner");

    const ok = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: first.user.id },
    );
    expect(ok.status, await ok.clone().text()).toBe(200);
  });
});
