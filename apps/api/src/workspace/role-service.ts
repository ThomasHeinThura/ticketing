import { createId } from "@paralleldrive/cuid2";
import {
  BUILT_IN_ROLE_KEYS,
  BUILT_IN_ROLES,
  type Capability,
  capabilityTier,
  expandCapabilities,
  isCapability,
  statement,
} from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import type { StepUpExecutor } from "../auth/repository";
import db from "../database";
import { withWorkspaceDeletionAccessLifecycle } from "../pending-action/workspace-access-invalidation";
import {
  applyCapabilityDeltaToLegacyStatements,
  capabilitiesFromLegacyStatements,
  LEGACY_PAIR_CAPABILITY,
} from "../permissions/legacy-statements";
import {
  expandedRoleCapabilities,
  findWorkspaceRoleByKey,
  storedCapabilities,
} from "../permissions/workspace-role-authority.repository";
import { resolveMembershipRole } from "../utils/workspace-member-roles";
import { MAX_WORKSPACE_ROLES_PER_WORKSPACE } from "../utils/workspace-role-limits";
import {
  CannotChangeOwnerRoleHereError,
  WorkspaceRoleNotFoundError,
} from "./controllers/workspace-membership-errors";
import {
  InsufficientPermissionToGrantError,
  InvalidCapabilityError,
  InvalidPermissionResourceError,
  RoleChangedError,
  RoleInIdentityUseError,
  RoleLimitReachedError,
  RoleNameInvalidError,
  RoleNameReservedError,
  RoleNameTakenError,
  RoleNotEditableError,
  RoleRankError,
  RoleReassignError,
  SelfEditConfirmationError,
} from "./controllers/workspace-role-errors";
import { WORKSPACE_ROLE_LOCK_NAMESPACE } from "./controllers/workspace-role-lock";
import {
  countCustomRoles,
  countIdentityRoleReferences,
  countRoleHolders,
  getRoleWithHolderCount,
  insertRoleRow,
  listPersonNames,
  listRoleHistory,
  listRoleHolders,
  listRolesWithHolderCounts,
  lockLegacySystemPermission,
  lockRoleHolderUserIds,
  lockRoleRow,
  setHolderRole,
  setLegacySystemPermission,
  updateRoleRow,
} from "./role.repository";
import {
  appendRoleAudit,
  assertActiveRoleManagerRemains,
  diffCapabilities,
  type RoleAuditActor,
} from "./role-governance";
import { type RoleView, toRoleView } from "./role-view";
import {
  lockPersonsInOrder,
  syncWorkspaceAdminReach,
} from "./workspace-admin-reach";
import { lockWorkspaceRoleAssignment } from "./workspace-role-assignment.repository";

/** Every resource key `@taskdesk/permissions`'s legacy `statement` recognizes. */
const VALID_PERMISSION_RESOURCES = new Set(Object.keys(statement));
const RESERVED_ROLE_KEYS: ReadonlySet<string> = new Set(BUILT_IN_ROLE_KEYS);
/** The default roles that still carry a legacy statement row the legacy gates read. */
const LEGACY_SYSTEM_STATEMENT_KEYS: ReadonlySet<string> = new Set([
  "viewer",
  "member",
  "admin",
]);
const DEFAULT_NEW_ROLE_RANK = 30;
const MAX_ROLE_RANK = 99;

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

/**
 * The immutable role key a name produces: lower-case letters and digits joined by single dashes
 * (any script's letters). It can never contain a comma or edge whitespace, so it always satisfies
 * the `workspace_member_role_single_value` CHECK.
 */
export function roleKeyFromName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

/** A name is reserved when any of its normalisations is a built-in key (`Instance Admin`, ...). */
export function isReservedRoleName(name: string, key: string): boolean {
  const lowered = name.normalize("NFKC").trim().toLowerCase();
  return (
    RESERVED_ROLE_KEYS.has(lowered) ||
    RESERVED_ROLE_KEYS.has(key) ||
    RESERVED_ROLE_KEYS.has(key.replaceAll("-", "_")) ||
    RESERVED_ROLE_KEYS.has(lowered.replace(/\s+/g, "_"))
  );
}

/** RL-3 input: validate and expand a requested set. Returns the stored closure, sorted. */
export function closureOfRequested(requested: readonly string[]): Capability[] {
  const bad = requested.filter(
    (name) => !isCapability(name) || capabilityTier(name) !== "workspace",
  );
  if (bad.length > 0) throw new InvalidCapabilityError([...new Set(bad)]);
  return [...expandCapabilities(requested, { tier: "workspace" })].sort();
}

/** The legacy `{resource: action[]}` body, validated the way the inherited route did. */
export function capabilitiesFromLegacyBody(
  permission: Record<string, string[]>,
): Capability[] {
  const badResources = Object.keys(permission).filter(
    (resource) => !VALID_PERMISSION_RESOURCES.has(resource),
  );
  if (badResources.length > 0) {
    throw new InvalidPermissionResourceError(badResources);
  }
  const unmapped: string[] = [];
  for (const [resource, actions] of Object.entries(permission)) {
    for (const action of actions) {
      const pair = `${resource}:${action}`;
      if (!Object.hasOwn(LEGACY_PAIR_CAPABILITY, pair) && !isCapability(pair)) {
        unmapped.push(pair);
      }
    }
  }
  if (unmapped.length > 0) throw new InvalidPermissionResourceError(unmapped);
  return capabilitiesFromLegacyStatements(permission);
}

export type RequestedCapabilities = {
  capabilities?: readonly string[] | undefined;
  permission?: Record<string, string[]> | undefined;
};

function requestedClosure(input: RequestedCapabilities): Capability[] | null {
  if (input.capabilities !== undefined && input.permission !== undefined) {
    throw new InvalidCapabilityError(["capabilities and permission together"]);
  }
  if (input.capabilities !== undefined) {
    return closureOfRequested(input.capabilities);
  }
  if (input.permission !== undefined) {
    return closureOfRequested(capabilitiesFromLegacyBody(input.permission));
  }
  return null;
}

/** Capabilities in `wanted` the caller does not hold, in the order given. */
export function capabilitiesBeyond(
  wanted: readonly string[],
  held: ReadonlySet<string> | null,
): string[] {
  return wanted.filter((name) => !held?.has(name));
}

/* ------------------------------------------------------------------ *
 * Caller
 * ------------------------------------------------------------------ */

export type RoleCaller = {
  userId: string;
  roleKey: string;
  rank: number;
  capabilities: ReadonlySet<Capability>;
  actor: RoleAuditActor;
};

/**
 * The calling member's own role, rank and capabilities in this workspace. `owner` is compiled;
 * every other key reads its canonical row. `null` means nothing usable resolves, and a caller
 * must treat that as "holds nothing" (every grant is refused).
 */
export async function resolveRoleCaller(
  workspaceId: string,
  userId: string,
  actor: RoleAuditActor,
): Promise<RoleCaller | null> {
  const membership = await resolveMembershipRole(db, workspaceId, userId);
  if (!membership.ok) return null;
  if (membership.role === "owner") {
    return {
      userId,
      roleKey: "owner",
      rank: BUILT_IN_ROLES.owner.rank,
      capabilities: expandCapabilities(BUILT_IN_ROLES.owner.capabilities, {
        tier: "workspace",
      }),
      actor,
    };
  }
  const row = await findWorkspaceRoleByKey(db, workspaceId, membership.role);
  if (!row) return null;
  return {
    userId,
    roleKey: row.key,
    rank: row.rank,
    capabilities: expandedRoleCapabilities(row.capabilities),
    actor,
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listRoles(workspaceId: string): Promise<RoleView[]> {
  return (await listRolesWithHolderCounts(db, workspaceId)).map(toRoleView);
}

export async function getRole(
  workspaceId: string,
  roleId: string,
): Promise<RoleView> {
  const row = await getRoleWithHolderCount(db, workspaceId, roleId);
  if (!row) throw new WorkspaceRoleNotFoundError(roleId);
  return toRoleView(row);
}

export async function getRoleHolders(
  workspaceId: string,
  roleId: string,
  limit = 200,
) {
  const row = await getRoleWithHolderCount(db, workspaceId, roleId);
  if (!row) throw new WorkspaceRoleNotFoundError(roleId);
  return {
    role: toRoleView(row),
    holders: await listRoleHolders(db, workspaceId, row.key, limit),
  };
}

export type RoleHistoryEntry = {
  id: string;
  action: string;
  actorName: string | null;
  actorType: string;
  added: string[];
  removed: string[];
  rank: { before: number | null; after: number | null } | null;
  createdAt: Date;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export async function getRoleHistory(
  workspaceId: string,
  roleId: string,
  limit = 50,
): Promise<RoleHistoryEntry[]> {
  const row = await getRoleWithHolderCount(db, workspaceId, roleId);
  if (!row) throw new WorkspaceRoleNotFoundError(roleId);
  const rows = await listRoleHistory(db, workspaceId, roleId, limit);
  const names = await listPersonNames(
    db,
    rows.flatMap((entry) => (entry.actorId ? [entry.actorId] : [])),
  );
  return rows.map((entry) => {
    const after =
      entry.after && typeof entry.after === "object"
        ? (entry.after as Record<string, unknown>)
        : {};
    const before =
      entry.before && typeof entry.before === "object"
        ? (entry.before as Record<string, unknown>)
        : {};
    const afterCaps = stringList(after.capabilities);
    const beforeCaps = stringList(before.capabilities);
    // Rows written by `role.created/updated` carry the diff; a delete carries only `before`.
    const diff = diffCapabilities(
      entry.action === "role.created" ? [] : beforeCaps,
      entry.action === "role.deleted" ? [] : afterCaps,
    );
    const rank =
      after.rank && typeof after.rank === "object"
        ? (after.rank as { before: number | null; after: number | null })
        : null;
    return {
      id: entry.id,
      action: entry.action,
      actorName: entry.actorId ? (names.get(entry.actorId) ?? null) : null,
      actorType: entry.actorType,
      added: entry.action === "role.created" ? afterCaps : diff.added,
      removed: diff.removed,
      rank,
      createdAt: entry.createdAt,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Preview (RL-12): navigation entries and sample work-item actions for a DRAFT set
 * ------------------------------------------------------------------ */

type PreviewEntry = {
  key: string;
  label: string;
  requires: Capability;
};

/** Where each navigation entry of the app shell becomes available. */
const PREVIEW_NAVIGATION: readonly PreviewEntry[] = [
  { key: "projects", label: "Projects", requires: "project:read" },
  { key: "work_items", label: "Work items", requires: "work_item:read" },
  { key: "views", label: "Saved views", requires: "saved_view:read" },
  { key: "reports", label: "Reports", requires: "report:read" },
  { key: "time", label: "Time tracking", requires: "time_entry:create" },
  { key: "knowledge", label: "Knowledge base", requires: "kb_article:read" },
  { key: "services", label: "Services", requires: "service:read" },
  { key: "approvals", label: "Approvals", requires: "approval:decide" },
  {
    key: "settings_workspace",
    label: "Settings: workspace",
    requires: "workspace:update",
  },
  {
    key: "settings_members",
    label: "Settings: members",
    requires: "workspace:manage_members",
  },
  {
    key: "settings_roles",
    label: "Settings: roles",
    requires: "workspace:manage_roles",
  },
  {
    key: "settings_automations",
    label: "Settings: automations",
    requires: "automation:manage",
  },
  {
    key: "settings_api_keys",
    label: "Settings: API keys",
    requires: "api_key:manage",
  },
  {
    key: "settings_webhooks",
    label: "Settings: webhooks",
    requires: "webhook:manage",
  },
];

/** The actions on one sample work item. */
const PREVIEW_ACTIONS: readonly PreviewEntry[] = [
  { key: "create", label: "Create a work item", requires: "work_item:create" },
  {
    key: "edit",
    label: "Edit title, description and fields",
    requires: "work_item:update",
  },
  {
    key: "transition",
    label: "Change state",
    requires: "work_item:transition",
  },
  {
    key: "assign",
    label: "Assign to anyone on the roster",
    requires: "work_item:assign",
  },
  {
    key: "priority",
    label: "Set priority",
    requires: "work_item:set_priority",
  },
  {
    key: "comment_internal",
    label: "Add an internal comment",
    requires: "comment:create_internal",
  },
  { key: "attach", label: "Add an attachment", requires: "attachment:create" },
  { key: "log_time", label: "Log time", requires: "time_entry:create" },
  {
    key: "delete",
    label: "Delete the work item",
    requires: "work_item:delete",
  },
];

export type RolePreview = {
  navigation: {
    key: string;
    label: string;
    requires: string;
    allowed: boolean;
  }[];
  workItemActions: {
    key: string;
    label: string;
    requires: string;
    allowed: boolean;
  }[];
  capabilityCount: number;
};

/**
 * RL-12: what a holder of this DRAFT capability set would see. A preview, not impersonation:
 * it reads nothing about any person, accepts the unsaved set from the request body, and never
 * persists. Unknown or instance-tier names are refused rather than ignored.
 */
export function previewCapabilitySet(
  requested: readonly string[],
): RolePreview {
  const closure = new Set(closureOfRequested(requested));
  const project = (entries: readonly PreviewEntry[]) =>
    entries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      requires: entry.requires,
      allowed: closure.has(entry.requires),
    }));
  return {
    navigation: project(PREVIEW_NAVIGATION),
    workItemActions: project(PREVIEW_ACTIONS),
    capabilityCount: closure.size,
  };
}

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

export type CreateRoleInput = {
  workspaceId: string;
  name: string;
  description?: string | null | undefined;
  rank?: number | undefined;
  cloneFromRoleId?: string | undefined;
  caller: RoleCaller | null;
  /**
   * Spends the caller's step-up proof inside this transaction, after every check and right before
   * the write, so a refused create never burns it.
   */
  beforeWrite?: (tx: StepUpExecutor) => Promise<void>;
} & RequestedCapabilities;

export async function createRole(input: CreateRoleInput): Promise<RoleView> {
  const key = roleKeyFromName(input.name);
  if (key === "") throw new RoleNameInvalidError();
  if (isReservedRoleName(input.name, key)) {
    throw new RoleNameReservedError(key.replaceAll("-", "_"));
  }

  let closure = requestedClosure(input);
  if (closure !== null && input.cloneFromRoleId !== undefined) {
    throw new InvalidCapabilityError([
      "cloneFromRoleId together with capabilities",
    ]);
  }

  const callerRank = input.caller?.rank ?? 0;
  const rank =
    input.rank ?? Math.max(1, Math.min(DEFAULT_NEW_ROLE_RANK, callerRank - 1));
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_ROLE_RANK) {
    throw new RoleRankError(
      `A role rank must be a whole number from 1 to ${MAX_ROLE_RANK}`,
    );
  }
  // RL-14: never create a role at or above your own highest rank.
  if (rank >= callerRank) {
    throw new RoleRankError(
      "You cannot create a role ranked at or above your own rank",
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_ROLE_LOCK_NAMESPACE}, hashtext(${input.workspaceId}))`,
    );

    if (input.cloneFromRoleId !== undefined) {
      const source = await getRoleWithHolderCount(
        tx,
        input.workspaceId,
        input.cloneFromRoleId,
      );
      if (!source) throw new WorkspaceRoleNotFoundError(input.cloneFromRoleId);
      closure = closureOfRequested(
        // A clone never inherits an instance-tier entry, whatever the source row says.
        storedCapabilities(source.capabilities).filter(
          (name) => isCapability(name) && capabilityTier(name) === "workspace",
        ),
      );
    }
    const capabilities = closure ?? [];

    // RL-3: the caller may never grant a capability they do not hold themselves.
    const missing = capabilitiesBeyond(
      capabilities,
      input.caller?.capabilities ?? null,
    );
    if (missing.length > 0)
      throw new InsufficientPermissionToGrantError(missing);

    if (
      (await countCustomRoles(tx, input.workspaceId)) >=
      MAX_WORKSPACE_ROLES_PER_WORKSPACE
    ) {
      throw new RoleLimitReachedError(MAX_WORKSPACE_ROLES_PER_WORKSPACE);
    }
    if (await findWorkspaceRoleByKey(tx, input.workspaceId, key)) {
      throw new RoleNameTakenError(key);
    }

    await input.beforeWrite?.(tx);
    const created = await insertRoleRow(tx, {
      id: createId(),
      scope: "workspace",
      workspaceId: input.workspaceId,
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      rank,
      capabilities,
      isSystem: false,
      isEditable: true,
    });

    await appendRoleAudit(tx, {
      action: "role.created",
      workspaceId: input.workspaceId,
      roleId: created.id,
      roleName: created.key,
      actor: input.caller?.actor ?? { userId: "", actorType: "person" },
      before: null,
      after: capabilities,
      rank: { before: null, after: rank },
    });

    return toRoleView({ ...created, holderCount: 0 });
  });
}

/* ------------------------------------------------------------------ *
 * Update
 * ------------------------------------------------------------------ */

export type UpdateRoleInput = {
  workspaceId: string;
  roleId: string;
  name?: string | undefined;
  description?: string | null | undefined;
  rank?: number | undefined;
  /** The `version` the editor loaded; a mismatch is a 409 with the current role. */
  expectedVersion?: string | undefined;
  /** Typed confirmation for removing capabilities from the role the caller holds. */
  confirmSelfEdit?: boolean | undefined;
  caller: RoleCaller | null;
  /** As on create: spends the step-up proof in this transaction, right before the write. */
  beforeWrite?: (tx: StepUpExecutor) => Promise<void>;
} & RequestedCapabilities;

export async function updateRole(input: UpdateRoleInput): Promise<RoleView> {
  const closure = requestedClosure(input);
  if (
    closure === null &&
    input.name === undefined &&
    input.description === undefined &&
    input.rank === undefined
  ) {
    throw new InvalidCapabilityError(["nothing to change"]);
  }
  if (
    input.rank !== undefined &&
    (!Number.isInteger(input.rank) ||
      input.rank < 1 ||
      input.rank > MAX_ROLE_RANK)
  ) {
    throw new RoleRankError(
      `A role rank must be a whole number from 1 to ${MAX_ROLE_RANK}`,
    );
  }

  return withWorkspaceDeletionAccessLifecycle(input.workspaceId, async (tx) => {
    await lockWorkspaceRoleAssignment(tx, input.workspaceId);

    const existing = await lockRoleRow(tx, input.workspaceId, input.roleId);
    if (!existing) throw new WorkspaceRoleNotFoundError(input.roleId);
    // RL-6: owner is compiled and never edited.
    if (existing.key === "owner" || !existing.isEditable) {
      throw new RoleNotEditableError(existing.key);
    }
    // A built-in role keeps its key, name and rank; only its capabilities and description change,
    // and only through `capabilities` (a legacy statement body is not a faithful edit of a row
    // whose compiled list is wider than the legacy vocabulary).
    if (
      existing.isSystem &&
      (input.permission !== undefined ||
        input.name !== undefined ||
        input.rank !== undefined)
    ) {
      throw new RoleNotEditableError(existing.key);
    }

    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== String(existing.updatedAt.getTime())
    ) {
      throw new RoleChangedError(
        toRoleView({
          ...existing,
          holderCount: await countRoleHolders(
            tx,
            input.workspaceId,
            existing.key,
          ),
        }),
      );
    }

    const caller = input.caller;
    const callerRank = caller?.rank ?? 0;
    const isOwnRole = caller !== null && caller.roleKey === existing.key;
    // RL-4: nothing at or above your own rank, except the role you hold yourself.
    if (existing.rank >= callerRank && !isOwnRole) {
      throw new RoleRankError(
        "You cannot edit a role ranked at or above your own rank",
      );
    }
    // RL-14: nor move a role to a rank at or above your own.
    if (input.rank !== undefined && input.rank >= callerRank) {
      throw new RoleRankError(
        "You cannot give a role a rank at or above your own rank",
      );
    }

    const before = expandedRoleCapabilities(
      storedCapabilities(existing.capabilities),
    );
    const nextCapabilities = closure ?? [...before].sort();
    const { added, removed } = diffCapabilities([...before], nextCapabilities);

    // RL-3 applies to what this save ADDS.
    const missing = capabilitiesBeyond(added, caller?.capabilities ?? null);
    if (missing.length > 0)
      throw new InsufficientPermissionToGrantError(missing);

    if (isOwnRole && removed.length > 0 && input.confirmSelfEdit !== true) {
      throw new SelfEditConfirmationError(removed);
    }

    const capabilitiesChanged = added.length > 0 || removed.length > 0;
    const rankChanged =
      input.rank !== undefined && input.rank !== existing.rank;
    if (
      (capabilitiesChanged || rankChanged) &&
      (await countIdentityRoleReferences(tx, existing.id)) > 0
    ) {
      throw new RoleInIdentityUseError();
    }

    // RL-7: the post-save world still has an active person who can manage roles.
    if (capabilitiesChanged) {
      await assertActiveRoleManagerRemains(tx, input.workspaceId, {
        kind: "update",
        roleId: existing.id,
        capabilities: nextCapabilities,
      });
    }

    await input.beforeWrite?.(tx);

    // The three built-in defaults that still have a legacy statement row keep that row in step
    // with the canonical set, by delta, because the legacy gates read it (owner decision, 23 Oct:
    // capabilities live in `role`; the legacy row is a derived, readable projection).
    if (
      existing.isSystem &&
      capabilitiesChanged &&
      LEGACY_SYSTEM_STATEMENT_KEYS.has(existing.key)
    ) {
      const stored = await lockLegacySystemPermission(
        tx,
        input.workspaceId,
        existing.key,
      );
      if (stored !== null) {
        let parsed: Record<string, readonly string[]> = {};
        try {
          const value: unknown = JSON.parse(stored);
          if (value && typeof value === "object" && !Array.isArray(value)) {
            parsed = Object.fromEntries(
              Object.entries(value).map(([resource, actions]) => [
                resource,
                Array.isArray(actions)
                  ? actions.filter(
                      (action): action is string => typeof action === "string",
                    )
                  : [],
              ]),
            );
          }
        } catch {
          parsed = {};
        }
        await setLegacySystemPermission(
          tx,
          input.workspaceId,
          existing.key,
          JSON.stringify(
            applyCapabilityDeltaToLegacyStatements(parsed, { added, removed }),
          ),
        );
      }
    }

    const updated = await updateRoleRow(tx, existing.id, {
      ...(closure === null ? {} : { capabilities: nextCapabilities }),
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.description === undefined
        ? {}
        : { description: input.description?.trim() || null }),
      ...(input.rank === undefined ? {} : { rank: input.rank }),
    });

    const holderCount = await countRoleHolders(
      tx,
      input.workspaceId,
      existing.key,
    );
    await appendRoleAudit(tx, {
      action: "role.updated",
      workspaceId: input.workspaceId,
      roleId: updated.id,
      roleName: updated.key,
      actor: caller?.actor ?? { userId: "", actorType: "person" },
      before: [...before],
      after: nextCapabilities,
      holderCount,
      ...(rankChanged
        ? { rank: { before: existing.rank, after: input.rank ?? null } }
        : {}),
    });

    return toRoleView({ ...updated, holderCount });
  });
}

/* ------------------------------------------------------------------ *
 * Bulk reassignment (RL-8)
 * ------------------------------------------------------------------ */

export type ReassignInput = {
  workspaceId: string;
  fromRoleId: string;
  toRoleId: string;
  /** Restrict the move to these people; omitted moves every holder. */
  userIds?: readonly string[] | undefined;
  caller: RoleCaller | null;
};

export type ReassignResult = {
  fromRoleId: string;
  toRoleId: string;
  moved: number;
};

export async function reassignRoleHolders(
  input: ReassignInput,
): Promise<ReassignResult> {
  if (input.fromRoleId === input.toRoleId) {
    throw new RoleReassignError("Choose a different role to move people to");
  }
  const caller = input.caller;
  const callerRank = caller?.rank ?? 0;

  return withWorkspaceDeletionAccessLifecycle(input.workspaceId, async (tx) => {
    await lockWorkspaceRoleAssignment(tx, input.workspaceId);

    const from = await lockRoleRow(tx, input.workspaceId, input.fromRoleId);
    if (!from) throw new WorkspaceRoleNotFoundError(input.fromRoleId);
    const to = await lockRoleRow(tx, input.workspaceId, input.toRoleId);
    if (!to) throw new WorkspaceRoleNotFoundError(input.toRoleId);

    // Ownership moves only through the ownership-transfer endpoint, in either direction.
    if (from.key === "owner") throw new CannotChangeOwnerRoleHereError();
    if (to.key === "owner") {
      throw new RoleReassignError(
        "Ownership is granted only by the ownership-transfer endpoint",
      );
    }
    // Nobody moves people at or above their own rank, nor hands out such a role.
    if (from.rank >= callerRank || to.rank >= callerRank) {
      throw new RoleRankError(
        "You cannot move people from or to a role ranked at or above your own rank",
      );
    }

    // RL-3: rank is not authority; the role people are moved into may not carry a capability the
    // caller does not hold (an Admin clone sits at rank 30).
    const beyond = capabilitiesBeyond(
      [...expandedRoleCapabilities(storedCapabilities(to.capabilities))],
      caller?.capabilities ?? null,
    );
    if (beyond.length > 0) throw new InsufficientPermissionToGrantError(beyond);

    const userIds = await lockRoleHolderUserIds(
      tx,
      input.workspaceId,
      from.key,
      input.userIds ?? null,
    );
    if (userIds.length === 0) {
      return { fromRoleId: from.id, toRoleId: to.id, moved: 0 };
    }

    await lockPersonsInOrder(tx, userIds);
    await setHolderRole(tx, input.workspaceId, userIds, to.key);
    for (const userId of userIds) {
      await syncWorkspaceAdminReach(tx, input.workspaceId, userId);
    }

    // RL-7: moving people must not strand role management.
    await assertActiveRoleManagerRemains(tx, input.workspaceId, {
      kind: "current",
    });

    await appendAuditLog(tx, {
      actorId: caller?.actor.userId ?? null,
      actorType: caller?.actor.actorType ?? "person",
      apiKeyId: caller?.actor.apiKeyId ?? null,
      workspaceId: input.workspaceId,
      action: "membership.changed",
      entityType: "workspace_role",
      entityId: from.id,
      before: { role: from.key },
      after: {
        kind: "role_reassigned",
        from: from.key,
        to: to.key,
        moved: userIds.length,
      },
    });

    return { fromRoleId: from.id, toRoleId: to.id, moved: userIds.length };
  });
}
