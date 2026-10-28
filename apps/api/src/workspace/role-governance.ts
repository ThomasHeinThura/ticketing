import type { JsonValue } from "@taskdesk/domain";
import { type Capability, expandCapabilities } from "@taskdesk/permissions";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import { schema } from "../database";
import type { Executor } from "../database/executor";
import { storedCapabilities } from "../permissions/workspace-role-authority.repository";

/**
 * Role governance (RL-7, RL-10): pure helpers plus the two transaction-scoped effects the role
 * write paths share, so create/update/delete/reassign cannot drift apart. Capabilities are the
 * canonical `resource:action` names stored in `role.capabilities`.
 */

export type RoleCapabilities = readonly string[];

/** Sorted, de-duplicated capability names. */
export function sortedCapabilities(
  capabilities: RoleCapabilities | null | undefined,
): string[] {
  return [...new Set(capabilities ?? [])].sort();
}

/** RL-10: which capabilities a save added and removed. */
export function diffCapabilities(
  before: RoleCapabilities | null | undefined,
  after: RoleCapabilities | null | undefined,
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before ?? []);
  const afterSet = new Set(after ?? []);
  return {
    added: [...afterSet].filter((name) => !beforeSet.has(name)).sort(),
    removed: [...beforeSet].filter((name) => !afterSet.has(name)).sort(),
  };
}

/** Holding this capability is what "can still manage roles" means for RL-7. */
export const ROLE_MANAGEMENT_CAPABILITY: Capability = "workspace:manage_roles";

export function capabilitiesGrantRoleManagement(
  capabilities: RoleCapabilities | null | undefined,
): boolean {
  if (!capabilities) return false;
  return expandCapabilities(capabilities, { tier: "workspace" }).has(
    ROLE_MANAGEMENT_CAPABILITY,
  );
}

export type RoleManagerCandidate = {
  /** The member's `workspace_member.role` value. */
  role: string;
  /** Not suspended (user ban) and not deactivated (person.active). */
  active: boolean;
};

/**
 * RL-7: is there at least one ACTIVE holder of role management? `owner` is compiled and always
 * holds it. A role that is missing from `capabilitiesByRole` (deleted, malformed) grants nothing.
 * A holder who is suspended or deactivated does not count: the workspace would be stranded exactly
 * as if nobody held it.
 */
export function hasActiveRoleManager(
  members: readonly RoleManagerCandidate[],
  capabilitiesByRole: ReadonlyMap<string, RoleCapabilities | null>,
): boolean {
  return members.some((member) => {
    if (!member.active) return false;
    if (member.role === "owner") return true;
    return capabilitiesGrantRoleManagement(capabilitiesByRole.get(member.role));
  });
}

export class LastRoleManagerError extends Error {
  constructor() {
    super(
      "At least one active person must be able to manage roles. This change would leave nobody (or only suspended or deactivated people) holding that permission.",
    );
    this.name = "LastRoleManagerError";
  }
}

export type RoleChangeScenario =
  | { kind: "update"; roleId: string; capabilities: RoleCapabilities }
  | { kind: "delete"; roleId: string }
  /** Evaluate the world as it stands in this transaction (after a write that already ran). */
  | { kind: "current" };

/**
 * RL-7 enforcement. Call inside the role-write transaction AFTER the workspace role lock is held.
 * Evaluates the post-change world and refuses with `LastRoleManagerError` when no active holder
 * of role management would remain.
 */
export async function assertActiveRoleManagerRemains(
  tx: Executor,
  workspaceId: string,
  change: RoleChangeScenario,
): Promise<void> {
  const roleRows = await tx
    .select({
      id: schema.roleTable.id,
      key: schema.roleTable.key,
      capabilities: schema.roleTable.capabilities,
    })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, workspaceId),
      ),
    );

  const capabilitiesByRole = new Map<string, RoleCapabilities | null>();
  for (const row of roleRows) {
    if (change.kind !== "current" && row.id === change.roleId) {
      if (change.kind === "update")
        capabilitiesByRole.set(row.key, change.capabilities);
      // delete: the role vanishes, so it grants nothing.
      continue;
    }
    capabilitiesByRole.set(row.key, storedCapabilities(row.capabilities));
  }

  const memberRows = await tx
    .select({
      role: schema.workspaceUserTable.role,
      personActive: schema.personTable.active,
      suspended: sql<boolean>`(${schema.userTable.banned} is true and (${schema.userTable.banExpires} is null or ${schema.userTable.banExpires} > now()))`,
    })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.workspaceUserTable.userId),
    )
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.workspaceUserTable.userId),
    )
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        or(
          isNull(schema.personTable.side),
          eq(schema.personTable.side, "staff"),
        ),
      ),
    );

  const members: RoleManagerCandidate[] = memberRows.map((row) => ({
    role: row.role,
    active: row.personActive !== false && row.suspended !== true,
  }));

  if (!hasActiveRoleManager(members, capabilitiesByRole))
    throw new LastRoleManagerError();
}

export type RoleAuditActor = {
  userId: string;
  actorType: "person" | "api_key";
  apiKeyId?: string | null;
};

/**
 * RL-10: append one `role.*` audit row in the caller's transaction, with the added and removed
 * capabilities. Never records anything but names.
 */
export async function appendRoleAudit(
  tx: Executor,
  input: {
    action: "role.created" | "role.updated" | "role.deleted";
    workspaceId: string;
    roleId: string;
    roleName: string;
    actor: RoleAuditActor;
    before: RoleCapabilities | null;
    after: RoleCapabilities | null;
    holderCount?: number;
    /** Rank change, recorded when a save moves it. */
    rank?: { before: number | null; after: number | null };
  },
): Promise<void> {
  const { added, removed } = diffCapabilities(input.before, input.after);
  const summary = {
    role: input.roleName,
    added,
    removed,
    ...(input.holderCount === undefined
      ? {}
      : { holderCount: input.holderCount }),
    ...(input.rank === undefined ? {} : { rank: input.rank }),
  } satisfies JsonValue;
  await appendAuditLog(tx, {
    actorId: input.actor.userId,
    actorType: input.actor.actorType,
    apiKeyId: input.actor.apiKeyId ?? null,
    workspaceId: input.workspaceId,
    action: input.action,
    entityType: "workspace_role",
    entityId: input.roleId,
    before: input.before
      ? { role: input.roleName, capabilities: sortedCapabilities(input.before) }
      : null,
    after:
      input.action === "role.deleted"
        ? null
        : { ...summary, capabilities: sortedCapabilities(input.after) },
  });
}
