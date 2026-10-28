import { legacyStatementsFromCapabilities } from "../permissions/legacy-statements";
import { storedCapabilities } from "../permissions/workspace-role-authority.repository";
import type { RoleWithHolders } from "./role.repository";

/**
 * The role as the API returns it. `role` (the key) and `permission` (a statement view derived
 * from the capabilities) are kept for the pre-canonical clients; `capabilities` is the stored
 * canonical set and the source of truth. `version` is the optimistic-concurrency token a PATCH
 * echoes back as `expectedVersion`.
 */
export type RoleView = {
  id: string;
  workspaceId: string;
  role: string;
  name: string;
  description: string | null;
  rank: number;
  capabilities: string[];
  permission: Record<string, string[]>;
  isSystem: boolean;
  isEditable: boolean;
  holderCount: number;
  version: string;
  createdAt: Date;
  updatedAt: Date;
};

export function toRoleView(row: RoleWithHolders): RoleView {
  const capabilities = storedCapabilities(row.capabilities);
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? "",
    role: row.key,
    name: row.name,
    description: row.description,
    rank: row.rank,
    capabilities,
    permission: legacyStatementsFromCapabilities(capabilities),
    isSystem: row.isSystem,
    isEditable: row.isEditable,
    holderCount: row.holderCount,
    version: String(row.updatedAt.getTime()),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
