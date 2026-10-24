import {
  BUILT_IN_ROLES,
  type Capability,
  expandCapabilities,
} from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";

/**
 * Canonical workspace-role authority: one read of the workspace-scope `role` row that a
 * `workspace_member.role` key points at, and the capability set it grants.
 *
 * `role` is the only home of a custom role's capabilities (owner decision, 23 Oct). `owner` is
 * never read from a row: its authority stays compiled, so an administrator can never edit the
 * workspace creator's authority away.
 */

export type WorkspaceRoleAuthorityRow = {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  rank: number;
  capabilities: readonly string[];
  isSystem: boolean;
  isEditable: boolean;
  updatedAt: Date;
  createdAt: Date;
};

export function storedCapabilities(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** The workspace-scope role row for `(workspaceId, key)`, or `undefined`. */
export async function findWorkspaceRoleByKey(
  executor: Pick<Executor, "select">,
  workspaceId: string,
  key: string,
): Promise<WorkspaceRoleAuthorityRow | undefined> {
  const [row] = await executor
    .select()
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.key, key),
      ),
    )
    .limit(1);
  return row ? toRow(row) : undefined;
}

export async function findWorkspaceRoleById(
  executor: Pick<Executor, "select">,
  workspaceId: string,
  roleId: string,
): Promise<WorkspaceRoleAuthorityRow | undefined> {
  const [row] = await executor
    .select()
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.id, roleId),
      ),
    )
    .limit(1);
  return row ? toRow(row) : undefined;
}

function toRow(
  row: typeof schema.roleTable.$inferSelect,
): WorkspaceRoleAuthorityRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? "",
    key: row.key,
    name: row.name,
    description: row.description,
    rank: row.rank,
    capabilities: storedCapabilities(row.capabilities),
    isSystem: row.isSystem,
    isEditable: row.isEditable,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

/** Expanded workspace-tier capability set. Instance-tier entries are never admitted. */
export function expandedRoleCapabilities(
  capabilities: readonly string[],
): Set<Capability> {
  return expandCapabilities(capabilities, { tier: "workspace" });
}

/** `owner` is compiled; every other key resolves from its role row, or holds nothing. */
export async function workspaceRoleCapabilitySet(
  executor: Pick<Executor, "select">,
  workspaceId: string,
  roleKey: string,
): Promise<Set<Capability>> {
  if (roleKey === "owner") {
    return expandedRoleCapabilities(BUILT_IN_ROLES.owner.capabilities);
  }
  const row = await findWorkspaceRoleByKey(executor, workspaceId, roleKey);
  if (!row) return new Set();
  return expandedRoleCapabilities(row.capabilities);
}

/** A custom (non-system) role row for this key, the only kind legacy gates read canonically. */
export async function findCustomWorkspaceRole(
  workspaceId: string,
  roleKey: string,
  executor: Pick<Executor, "select"> = db,
): Promise<WorkspaceRoleAuthorityRow | undefined> {
  const row = await findWorkspaceRoleByKey(executor, workspaceId, roleKey);
  return row && !row.isSystem ? row : undefined;
}
