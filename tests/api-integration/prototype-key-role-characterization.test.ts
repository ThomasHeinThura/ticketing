/**
 * Issue #108 -- a `workspace_member.role` value naming a key on `Object.prototype`
 * (`"toString"`, `"constructor"`, ...) with NO backing `workspace_role` row makes the two
 * live authorization evaluators disagree in AVAILABILITY, not privilege:
 *
 * | Evaluator | Result |
 * | --- | --- |
 * | `POST /api/auth/organization/has-permission` (plugin) | **HTTP 500**, empty body |
 * | `GET /api/capabilities` (native) | **HTTP 200**, all sixteen capabilities `false` |
 *
 * THIS IS NOT #82. #82 is the comma-joined multi-role union -- a privilege ESCALATION, and
 * its own oracle lives in `multi-role-membership-characterization.test.ts`, whose structure
 * this file deliberately follows. A prototype-key role value is canonical and single (no
 * comma, trimmed, non-empty), so it is not excluded by #82's invariant or by the
 * `workspace_member_role_single_value` CHECK constraint -- it belongs to the same *class* of
 * bug (the two evaluators disagreeing about one `workspace_member.role` value) but the
 * opposite *direction*: it throws rather than granting anything.
 *
 * ROOT CAUSE, read directly from the installed dependency, better-auth 1.6.30, at
 * `apps/api/node_modules/better-auth/dist/plugins/organization/permission.mjs:9`:
 *
 * ```js
 * for (const role of roles) if ((acRoles[role]?.authorize(input.permissions))?.success) return true;
 * ```
 *
 * `acRoles` (built at `has-permission.mjs:7`, `{ ...input.options.roles || defaultRoles }`)
 * is a plain object literal, so `acRoles["toString"]` resolves to `Object.prototype.toString`
 * -- truthy, but not a role object. `?.` only guards nullishness, so `.authorize` is
 * `undefined` and calling it throws a `TypeError`, which surfaces to the client as an
 * unhandled 500 with no JSON body. An ORDINARY unknown role name (`"nosuchrole"`) is not on
 * the prototype chain, so `acRoles["nosuchrole"]` is `undefined`, `?.` short-circuits
 * cleanly, and the loop just moves on -- that contrast is what section A's CONTROL pins.
 *
 * REACHABILITY IS NARROWER THAN IT FIRST LOOKS. `POST /organization/create-role` normalises
 * a new role name with nothing but `.toLowerCase()`
 * (`crud-access-control.mjs:9`, `const normalizeRoleName = (role) => role.toLowerCase();`).
 * Section B measures, against the real route, which prototype keys survive that: `toString`
 * becomes the harmless `tostring`; `constructor` (already lower-case) survives unchanged.
 * That is why this file exercises `constructor` as well as `toString` -- they are reachable
 * by two DIFFERENT paths (a legacy/direct-write value that never went through the route's
 * sanitizer, versus a name a human could type into "create a custom role" today and have it
 * accepted verbatim), and both must plant the identical membership-level divergence to be
 * the same bug rather than two coincidentally-similar ones.
 *
 * THE BOUND THAT KEEPS THIS FROM BEING A REAL ESCALATION: `hasPermission`
 * (`has-permission.mjs:16-25`) queries every `workspace_role` row for the organisation and,
 * for each one, does `acRoles[role] = input.options.ac.newRole(merged)` -- an assignment,
 * which OVERWRITES whatever `acRoles` inherited from `Object.prototype` under that same key.
 * A role that genuinely EXISTS as a `workspace_role` row is therefore never exploitable,
 * regardless of what its name happens to collide with. Section C pins that bound directly:
 * a real `workspace_role` named `"constructor"` behaves like any other custom role on BOTH
 * evaluators, with no throw and no divergence.
 *
 * SCOPE, AND WHY THIS FILE DOES NOT FIX ANYTHING. Issue #108 records the decision to accept
 * and record this bound (option (c) of three considered) rather than patch the write
 * boundary (option (a)) or weaken the native evaluator to match the plugin (option (b)):
 * the native side is already correct, and retrofit S10 unmounts `organization()` entirely,
 * erasing the divergence by deletion rather than by a patch to a component already
 * scheduled to go. This file's value is exactly that it will change shape when S10 lands --
 * a concrete verification point that unmounting the plugin genuinely removed the divergence
 * rather than merely moving it. No RED "target" probes accompany it, unlike
 * `multi-role-membership-target.test.ts` for #82 -- there is no target behaviour here to
 * implement; the target IS the removal, tracked by S10 itself.
 *
 * As with the #82 oracle, every assertion below is driven over real HTTP against a real
 * PostgreSQL and asserts on the actual measured response -- status AND body -- never on an
 * assumed shape.
 */
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

/**
 * Drives the still-mounted plugin's own `/organization/has-permission` route and returns the
 * raw `Response` -- deliberately NOT asserting `status === 200` the way the #82 oracle's
 * `checkPluginPermission` does, because the entire point of this file is that this route's
 * status is NOT always 200 for a real membership row.
 */
async function pluginHasPermissionRaw(
  app: App,
  cookie: string,
  organizationId: string,
  permissions: Record<string, string[]>,
): Promise<Response> {
  return app.request("/api/auth/organization/has-permission", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ organizationId, permissions }),
  });
}

async function getCapabilities(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<{ status: number; body: Record<string, boolean> }> {
  const response = await app.request(
    `/api/capabilities?workspaceId=${workspaceId}`,
    { headers: { cookie } },
  );
  const body = (await response.json()) as Record<string, boolean>;
  return { status: response.status, body };
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

/**
 * Plants a role value directly on a `workspace_member` row, bypassing every route's own
 * sanitizer entirely -- the same inline `.update(schema.workspaceUserTable)` pattern
 * `multi-role-membership-characterization.test.ts` uses for its own legacy-row cases
 * (its lines 386 and 421). This is the ONE mechanism by which a value that no route would
 * ever persist verbatim (a bare `"toString"`, never lower-cased) can land in the column --
 * modelling a legacy row, a direct DB edit, or a value written by a component other than
 * the still-mounted plugin. When #82 lands and extracts this into
 * `tests/api-integration/helpers/organization-http.ts` as `plantLegacyMembershipRole`, this
 * file should adopt it, per issue #108's own text.
 */
async function plantLegacyMembershipRole(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<void> {
  await db
    .update(schema.workspaceUserTable)
    .set({ role })
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
}

/**
 * Drives the still-mounted plugin's real `POST /organization/create-role` route -- the ONE
 * place a human, not a direct DB write, could originate a prototype-colliding role name.
 * Returns the raw `Response` so callers can assert on the route's own normalisation of
 * `role` (`crud-access-control.mjs:9`, lower-cased before anything else happens to it).
 */
async function createOrgRoleViaPlugin(
  app: App,
  cookie: string,
  organizationId: string,
  role: string,
  permission: Record<string, string[]>,
): Promise<Response> {
  return app.request("/api/auth/organization/create-role", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ organizationId, role, permission }),
  });
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("#108 A -- primary reproduction: a prototype-key role with no backing row throws the plugin evaluator; native fails closed", () => {
  it('THE REPRODUCTION: role = "toString" planted directly on a real membership (no `workspace_role` row named "toString" exists) makes `POST /organization/has-permission` throw a 500 with an EMPTY body (permission.mjs:9, `acRoles["toString"]` resolves to `Object.prototype.toString` -- truthy, so `?.` does not short-circuit, but it has no `.authorize`), while `GET /api/capabilities` still returns 200 with all sixteen capabilities false (require-workspace-permission.ts:57-70, `customRoleStatements` does an exact `eq(workspaceRoleTable.role, role)` lookup and finds no row, so `statements` is null and every check denies)', async () => {
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

    await plantLegacyMembershipRole(workspace.id, target.user.id, "toString");
    const memberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(memberAfter.role).toBe("toString");

    const pluginResponse = await pluginHasPermissionRaw(
      app,
      target.cookie,
      workspace.id,
      { task: ["create"] },
    );
    expect(pluginResponse.status).toBe(500);
    expect(await pluginResponse.text()).toBe("");

    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.status).toBe(200);
    for (const name of Object.keys(CAPABILITY_CHECKS)) {
      expect(
        capabilities.body[name],
        `capability "${name}" should be denied`,
      ).toBe(false);
    }
  });

  it('THE CONTROL, isolating the mechanism: role = "nosuchrole" -- an ORDINARY unknown role name, not a prototype key -- denies cleanly on BOTH evaluators. The plugin returns 200 with `{ success: false }` (permission.mjs:9, `acRoles["nosuchrole"]` is `undefined`, so `?.` short-circuits with no throw); native still returns 200, all false. This is the contrast that proves the defect is specifically about NAMES ON `Object.prototype`, not about unknown role names in general', async () => {
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

    await plantLegacyMembershipRole(workspace.id, target.user.id, "nosuchrole");

    const pluginResponse = await pluginHasPermissionRaw(
      app,
      target.cookie,
      workspace.id,
      { task: ["create"] },
    );
    expect(pluginResponse.status).toBe(200);
    expect(await pluginResponse.json()).toEqual({
      error: null,
      success: false,
    });

    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.status).toBe(200);
    for (const name of Object.keys(CAPABILITY_CHECKS)) {
      expect(
        capabilities.body[name],
        `capability "${name}" should be denied`,
      ).toBe(false);
    }
  });
});

describe("#108 B -- reachability: create-role's bare .toLowerCase() decides which prototype keys survive, and the same divergence reproduces via a second, different path", () => {
  it('REACHABILITY, measured against the real route: `POST /organization/create-role` normalises with nothing but `.toLowerCase()` (crud-access-control.mjs:9) -- "Constructor" survives as the eleven-character string "constructor", STILL a name on `Object.prototype`, while "ToString" survives only as "tostring", which collides with nothing', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const constructorResponse = await createOrgRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      "Constructor",
      { task: ["read"] },
    );
    expect(constructorResponse.status).toBe(200);
    const constructorBody = (await constructorResponse.json()) as {
      roleData: { role: string };
    };
    expect(constructorBody.roleData.role).toBe("constructor");

    const toStringResponse = await createOrgRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      "ToString",
      { task: ["read"] },
    );
    expect(toStringResponse.status).toBe(200);
    const toStringBody = (await toStringResponse.json()) as {
      roleData: { role: string };
    };
    expect(toStringBody.roleData.role).toBe("tostring");
  });

  it('THE REPRODUCTION, second path: role = "constructor" planted directly on a membership (no backing `workspace_role` row, exactly as with "toString" above) reproduces the IDENTICAL divergence -- plugin 500 with an empty body, native 200 with all sixteen capabilities false. "constructor" and "toString" arrive at this same broken state via different routes (a name that would survive create-role\'s normalisation unchanged, versus one that would not), so both are pinned, not just one', async () => {
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

    await plantLegacyMembershipRole(
      workspace.id,
      target.user.id,
      "constructor",
    );
    const memberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(memberAfter.role).toBe("constructor");

    const pluginResponse = await pluginHasPermissionRaw(
      app,
      target.cookie,
      workspace.id,
      { task: ["create"] },
    );
    expect(pluginResponse.status).toBe(500);
    expect(await pluginResponse.text()).toBe("");

    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.status).toBe(200);
    for (const name of Object.keys(CAPABILITY_CHECKS)) {
      expect(
        capabilities.body[name],
        `capability "${name}" should be denied`,
      ).toBe(false);
    }
  });
});

describe("#108 C -- the bound that keeps this from being a real escalation: a role that genuinely EXISTS is never exploitable", () => {
  it('THE BOUND: a real `workspace_role` row literally named "constructor" (created through the real create-role route, granting task:create) is assigned to a member through the real update-member-role route, and BOTH evaluators then behave completely normally -- no throw, no divergence. `hasPermission` (has-permission.mjs:16-25) assigns every `workspace_role` row into `acRoles` keyed by its name, and a plain assignment OVERWRITES whatever `acRoles["constructor"]` inherited from `Object.prototype`, so the plugin\'s lookup finds the real role object, not the inherited function, and authorizes exactly what the row grants -- task:create and nothing else, agreeing with native\'s exact-match row lookup (require-workspace-permission.ts:57-70) on every one of the sixteen capabilities', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const createRole = await createOrgRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      "constructor",
      { task: ["create"] },
    );
    expect(createRole.status).toBe(200);

    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );
    const memberBefore = await getMemberRow(workspace.id, target.user.id);

    const updateRole = await updateMemberRoleViaPlugin(
      app,
      owner.cookie,
      workspace.id,
      memberBefore.id,
      "constructor",
    );
    expect(updateRole.status).toBe(200);

    const memberAfter = await getMemberRow(workspace.id, target.user.id);
    expect(memberAfter.role).toBe("constructor");

    const pluginResponse = await pluginHasPermissionRaw(
      app,
      target.cookie,
      workspace.id,
      { task: ["create"] },
    );
    expect(pluginResponse.status).toBe(200);
    expect(await pluginResponse.json()).toEqual({
      error: null,
      success: true,
    });

    const capabilities = await getCapabilities(
      app,
      target.cookie,
      workspace.id,
    );
    expect(capabilities.status).toBe(200);
    expect(capabilities.body.createTasks).toBe(true);
    for (const name of Object.keys(CAPABILITY_CHECKS)) {
      if (name === "createTasks") continue;
      expect(
        capabilities.body[name],
        `capability "${name}" should be denied`,
      ).toBe(false);
    }
  });
});
