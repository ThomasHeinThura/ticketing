import { builtInRoles } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { isInstanceAdmin } from "./is-instance-admin";

type PermissionMap = Record<string, string[]>;

/**
 * Preserving workspace-role authority against the instance-admin bypass.
 *
 * THE FINDING THIS CLOSES. `hasWorkspacePermission`
 * (`apps/api/src/utils/require-workspace-permission.ts`) short-circuits to `true` the moment
 * `isInstanceAdmin(c)` is true, **before it ever reads the caller's actual workspace role**.
 * That function is shared by every authorized route in the product and is not this lane's to
 * redesign (it lives outside the S4 batch's ownership, and issue #66 already tracks a related,
 * separate defect in it). Left alone, mounting `PATCH/DELETE /api/workspace/{id}` on
 * `requireWorkspacePermission` alone would have let an instance admin who is merely a `viewer`
 * member rename or delete a workspace their own workspace role forbids — a real privilege
 * escalation, on a route this batch adds, not a pre-existing one merely inherited.
 *
 * **Thomas's decision (2026-09-08): do not bless the bypass.** This middleware is additive,
 * scoped to exactly the two mutation routes that need it, and changes nothing for anyone who
 * is not an instance admin — `requireWorkspacePermission` already resolved their authority
 * correctly, bypass or not.
 *
 * **How authority is resolved here, and why it is deliberately NOT the same resolution
 * `hasWorkspacePermission` uses for non-owner roles.** The default `viewer`/`member`/`admin`
 * roles get their authority from the `workspace_role` DB row seeded at create time (S4's own
 * create transaction now guarantees this — see `create-workspace.ts`). `hasWorkspacePermission`
 * falls back to the COMPILED definition when that row is missing, which is issue #66's own
 * escalation path (a narrowing undone by deleting the row). This guard never takes that
 * fallback for those three roles: if the row is missing, the request is REFUSED, not silently
 * granted the compiled default. That is a stricter, fail-closed answer than #66's shared
 * evaluator gives, and it means this new control's own correctness never depends on the buggy
 * fallback it is not this lane's job to fix.
 *
 * The one deliberate exception is `owner`. Retrofit plan R5 records that `owner` is NEVER
 * seeded a `workspace_role` row **by design** — owner authority has always been the compiled
 * static role, editable by nobody, and every workspace creator (who is very often also the
 * instance's first user, and therefore also its instance admin) depends on that today. Treating
 * a legitimate owner's always-absent row the same as a viewer/member/admin's anomalous missing
 * row would turn this fix into a regression for the single most common case: an instance admin
 * deleting a workspace they themselves created and own. So `owner` alone resolves from the
 * compiled definition — not because the fallback is trusted, but because for `owner` there was
 * never anything else to fall back FROM.
 */
export function requireWorkspaceRoleAuthority(permissions: PermissionMap) {
  return async (c: Context, next: Next) => {
    // Nobody else is affected. An ordinary caller's authority was already resolved correctly
    // (bypass or not, `isInstanceAdmin` is false for them) by `requireWorkspacePermission`,
    // which must already have run for this guard to mean anything.
    if (!(await isInstanceAdmin(c))) {
      return next();
    }

    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    if (!workspaceId || !userId) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    const [member] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, userId),
        ),
      )
      .limit(1);

    if (!member?.role) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    const statements =
      member.role === "owner"
        ? (builtInRoles.owner.statements as Record<string, readonly string[]>)
        : await ownRoleStatements(workspaceId, member.role);

    if (!statements || !satisfies(statements, permissions)) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    return next();
  };
}

/**
 * The workspace's OWN row for this role — no compiled substitute. Returns `null` when the
 * row is absent (deliberately: see the module comment) or malformed.
 */
async function ownRoleStatements(
  workspaceId: string,
  role: string,
): Promise<Record<string, readonly string[]> | null> {
  const [row] = await db
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    )
    .limit(1);

  if (!row?.permission) return null;

  let value: unknown;
  try {
    value = JSON.parse(row.permission);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(actions)) continue;
    const filtered = actions.filter(
      (action): action is string => typeof action === "string",
    );
    if (filtered.length > 0) {
      result[resource] = filtered;
    }
  }
  return result;
}

function satisfies(
  statements: Record<string, readonly string[]>,
  required: PermissionMap,
): boolean {
  for (const [resource, actions] of Object.entries(required)) {
    const granted = statements[resource];
    if (!granted) return false;
    for (const action of actions) {
      if (!granted.includes(action)) return false;
    }
  }
  return true;
}
