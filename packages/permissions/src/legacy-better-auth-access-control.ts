/**
 * kaneo's better-auth access control — **inherited, transitional, on its way out.**
 *
 * This is the 84-line `createAccessControl` surface TaskDesk imported with kaneo. It is not
 * the permission model: capabilities, the five policy kinds and the evaluator live beside it
 * in this package and are what new code uses. It survives only because
 * `apps/api/src/auth.ts`, `apps/api/src/utils/*` and three `apps/web` screens still read it
 * while the better-auth `organization` plugin is being removed (#6, P0 step 1b).
 *
 * **It goes when the `organization` plugin goes.** Two things must happen together, and
 * neither is this lane's to do: the last consumer stops importing it, and the `better-auth`
 * dependency is dropped from this package's `package.json` — which needs a lockfile
 * regeneration, and the lockfile is owned elsewhere during P0.
 *
 * The four role names it seeds — `viewer`, `member`, `admin`, `owner` — are kept for data
 * continuity and are re-declared properly in `roles.ts`.
 *
 * **The `work_item` statement key was `task` until issue #8's prerequisite rename** (2026-09-23
 * decision log entry, "shadow until clean, then strict; rename `task:*` first"): the compiled
 * built-in roles here and every `requireWorkspacePermission({ work_item: [...] })` call site
 * across `apps/api/src` were re-keyed together, in the same change, so no caller is left
 * checking a resource name this statement no longer has. This is a plain rename to match what
 * the target `Capability` union calls `work_item:*` — it does not change what any role is
 * granted, and it is a prerequisite for the `task`/work-item router's shadow-mode soak (issue
 * #8), not that soak itself.
 *
 * **This did NOT re-key every already-seeded `workspace_role` row, or `apikey.permissions`,
 * by itself** (Opus review of pull request #392, BLOCKING): those are persisted `text`/JSON
 * columns, not derived from these compiled objects, and a row a pre-rename binary already
 * wrote keeps its old `{"task": [...]}` shape until something rewrites it. Migration
 * `0071_workspace_role_apikey_permission_task_to_work_item.sql` is the one-time backfill that
 * does that for both columns; only freshly-seeded rows (created after this rename shipped)
 * get the new key from these objects directly.
 */

import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export const statement = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete", "share"],
  work_item: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
} as const;

export const ac = createAccessControl(statement);

export const viewer = ac.newRole({
  ...memberAc.statements,
  project: ["read"],
  work_item: ["read"],
  label: ["read"],
  workspace: ["read"],
});

export const member = ac.newRole({
  ...memberAc.statements,
  project: ["create", "read"],
  work_item: ["create", "read", "update"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  work_item: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "manage_settings"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  work_item: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
});

export const builtInRoles = { viewer, member, admin, owner } as const;

export type BuiltInRoleName = keyof typeof builtInRoles;

// Default-role names that the API seeds per workspace. These ARE editable in
// the UI (their permissions live as rows in `workspace_role`), but their names
// are reserved and the rows are auto-created on workspace creation /
// backfilled at boot. `owner` is intentionally NOT in this list because it
// stays a true static role on the better-auth side.
export const DEFAULT_ROLE_NAMES = ["viewer", "member", "admin"] as const;
export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

function toMutablePayload(
  statements: Record<string, readonly string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(statements)) {
    out[resource] = [...actions];
  }
  return out;
}

// Plain JSON-serializable permission payloads for the seeded default roles.
// Mirrors each role's `.statements` (including better-auth's organization/
// member/team/invitation/ac defaults) so a workspace_role row that uses one
// of these has parity with the prior static definition.
export const defaultRolePayloads: Record<
  DefaultRoleName,
  Record<string, string[]>
> = {
  viewer: toMutablePayload(viewer.statements),
  member: toMutablePayload(member.statements),
  admin: toMutablePayload(admin.statements),
};
