import {
  checkReparent,
  decideMemberRemoval,
  type ProjectParentMap,
  type ReparentRefusal,
  reachAncestorIds,
} from "../hierarchy";

/**
 * Project roster rules (`PR-2`..`PR-4`), pure so they are unit-testable without a database.
 *
 * Inherited rows are NOT materialised: a person who holds a project-scope `membership` on an
 * ancestor is on every descendant's roster at read time, with the nearest ancestor naming where
 * it came from. An explicit row on the child overrides the inherited role (`PR-3`); removing
 * that explicit row brings the inherited one back. An inherited row cannot be removed on the
 * child (`PR-4`).
 */

export type RosterRoleRef = {
  roleId: string;
  roleKey: string;
  roleName: string;
  roleRank: number;
};

export type RosterPerson = {
  personId: string;
  displayName: string | null;
  active: boolean;
  jobTitle: string | null;
};

/** One project-scope `membership` row, joined with its person and role. */
export type RosterRow = RosterPerson &
  RosterRoleRef & {
    /** An active DIRECT `membership_grant` backs this row (as opposed to IdP-managed only). */
    hasDirectGrant: boolean;
  };

export type RosterAncestor = {
  projectId: string;
  projectName: string;
  rows: readonly RosterRow[];
};

export type RosterEntry = RosterPerson &
  RosterRoleRef & {
    source: "direct" | "inherited";
    /** Nearest ancestor project that holds this person (inherited, or the overridden one). */
    inheritedFrom: { projectId: string; projectName: string } | null;
    /** `PR-3`: a direct row whose role replaces the one an ancestor would give. */
    overridesInherited: { roleKey: string; roleName: string } | null;
    /** Direct row not backed by a direct grant: managed by an identity-provider mapping. */
    managedExternally: boolean;
    /** Whether `DELETE` on this project can remove the row. */
    removable: boolean;
  };

export function buildRoster(input: {
  direct: readonly RosterRow[];
  /** Nearest ancestor first. */
  ancestors: readonly RosterAncestor[];
}): RosterEntry[] {
  const out: RosterEntry[] = [];
  const directIds = new Set(input.direct.map((row) => row.personId));

  const nearestAncestorHolding = (personId: string) => {
    for (const ancestor of input.ancestors) {
      const row = ancestor.rows.find((r) => r.personId === personId);
      if (row) return { ancestor, row };
    }
    return undefined;
  };

  for (const row of input.direct) {
    const inherited = nearestAncestorHolding(row.personId);
    out.push({
      ...toEntryBase(row),
      source: "direct",
      inheritedFrom: inherited
        ? {
            projectId: inherited.ancestor.projectId,
            projectName: inherited.ancestor.projectName,
          }
        : null,
      overridesInherited: inherited
        ? { roleKey: inherited.row.roleKey, roleName: inherited.row.roleName }
        : null,
      managedExternally: !row.hasDirectGrant,
      removable: row.hasDirectGrant,
    });
  }

  const seen = new Set<string>();
  for (const ancestor of input.ancestors) {
    for (const row of ancestor.rows) {
      if (directIds.has(row.personId) || seen.has(row.personId)) continue;
      seen.add(row.personId);
      out.push({
        ...toEntryBase(row),
        source: "inherited",
        inheritedFrom: {
          projectId: ancestor.projectId,
          projectName: ancestor.projectName,
        },
        overridesInherited: null,
        managedExternally: false,
        removable: false,
      });
    }
  }

  return out.sort(
    (a, b) =>
      (a.displayName ?? "").localeCompare(b.displayName ?? "") ||
      a.personId.localeCompare(b.personId),
  );
}

function toEntryBase(row: RosterRow): RosterPerson & RosterRoleRef {
  return {
    personId: row.personId,
    displayName: row.displayName,
    active: row.active,
    jobTitle: row.jobTitle,
    roleId: row.roleId,
    roleKey: row.roleKey,
    roleName: row.roleName,
    roleRank: row.roleRank,
  };
}

export type RemovalVerdict =
  | { allowed: true }
  | { allowed: false; status: 404; code: "not_on_roster" }
  | {
      allowed: false;
      status: 409;
      code: "inherited_membership";
      inheritedFrom: string;
    }
  | { allowed: false; status: 409; code: "managed_membership" };

/**
 * `DELETE .../members/{personId}`. Uses `decideMemberRemoval` for the `PR-4` split between an
 * inherited-only person (409, remove at the ancestor) and a person holding an explicit row.
 * An explicit row with no direct grant is held by an identity-provider mapping and is not
 * removable here either (the mapping, not the roster, owns it).
 */
export function decideRosterRemoval(input: {
  directRow: Pick<RosterRow, "hasDirectGrant"> | undefined;
  ancestorIdsNearestFirst: readonly string[];
  ancestorMemberOf: ReadonlySet<string>;
}): RemovalVerdict {
  const decision = decideMemberRemoval({
    hasExplicitRow: input.directRow !== undefined,
    ancestorIdsNearestFirst: input.ancestorIdsNearestFirst,
    ancestorMemberOf: input.ancestorMemberOf,
  });
  if (!decision.removable) {
    return {
      allowed: false,
      status: 409,
      code: decision.code,
      inheritedFrom: decision.inheritedFrom,
    };
  }
  if (!input.directRow)
    return { allowed: false, status: 404, code: "not_on_roster" };
  if (!input.directRow.hasDirectGrant) {
    return { allowed: false, status: 409, code: "managed_membership" };
  }
  return { allowed: true };
}

/**
 * Rank ceiling for authority-minting writes: a caller may grant, change or remove only roles at
 * or below their own rank in this project (a project-scope role overrides workspace roles on
 * that project, `authorityFor`). Same ceiling the workspace role editor applies.
 */
export function callerRankInProject(
  authority: ReadonlyArray<{
    scope: string;
    scopeId: string | null;
    rank: number;
  }>,
  projectId: string,
  workspaceId: string,
): number {
  const projectGrants = authority.filter(
    (grant) => grant.scope === "project" && grant.scopeId === projectId,
  );
  const applicable =
    projectGrants.length > 0
      ? projectGrants
      : authority.filter(
          (grant) =>
            grant.scope === "workspace" && grant.scopeId === workspaceId,
        );
  const instance = authority.filter((grant) => grant.scope === "instance");
  return Math.max(0, ...[...applicable, ...instance].map((g) => g.rank));
}

export type ReparentAccessChange = RosterPerson & {
  /** The ancestor (of the new parent chain for gains, the old chain for losses) responsible. */
  via: { projectId: string; projectName: string };
  roleKey: string;
  roleName: string;
};

export type ReparentRoleChange = RosterPerson & {
  from: { roleKey: string; roleName: string; projectName: string };
  to: { roleKey: string; roleName: string; projectName: string };
};

export type ReparentAccessPreview = {
  refusal: ReparentRefusal | null;
  gains: ReparentAccessChange[];
  losses: ReparentAccessChange[];
  roleChanges: ReparentRoleChange[];
};

/**
 * Who gains and who loses access to `projectId` (and, identically, to every descendant that does
 * not hold the person directly) when it moves under `newParentId` (`null` = root). Reach by
 * ancestor membership only: people with a direct row on the project keep access either way.
 */
export function previewReparentAccess(input: {
  parents: ProjectParentMap;
  deleted: ReadonlySet<string>;
  projectId: string;
  newParentId: string | null;
  directPersonIds: ReadonlySet<string>;
  rowsByProject: ReadonlyMap<string, readonly RosterRow[]>;
  projectNames: ReadonlyMap<string, string>;
}): ReparentAccessPreview {
  const refusal = checkReparent(
    input.parents,
    input.projectId,
    input.newParentId,
  );
  const moved = new Map(input.parents);
  if (refusal === null) moved.set(input.projectId, input.newParentId);

  const chain = (parents: ProjectParentMap) =>
    reachAncestorIds(parents, input.deleted, input.projectId).map((id) => ({
      projectId: id,
      projectName: input.projectNames.get(id) ?? id,
      rows: input.rowsByProject.get(id) ?? [],
    }));
  const before = chain(input.parents);
  const after = refusal === null ? chain(moved) : before;

  const nearest = (ancestors: ReturnType<typeof chain>, personId: string) => {
    for (const ancestor of ancestors) {
      const row = ancestor.rows.find((r) => r.personId === personId);
      if (row) return { ancestor, row };
    }
    return undefined;
  };
  const holders = (ancestors: ReturnType<typeof chain>) =>
    new Set(ancestors.flatMap((a) => a.rows.map((r) => r.personId)));

  const beforeHolders = holders(before);
  const afterHolders = holders(after);
  const gains: ReparentAccessChange[] = [];
  const losses: ReparentAccessChange[] = [];
  const roleChanges: ReparentRoleChange[] = [];

  const toChange = (
    hit: NonNullable<ReturnType<typeof nearest>>,
  ): ReparentAccessChange => ({
    personId: hit.row.personId,
    displayName: hit.row.displayName,
    active: hit.row.active,
    jobTitle: hit.row.jobTitle,
    via: {
      projectId: hit.ancestor.projectId,
      projectName: hit.ancestor.projectName,
    },
    roleKey: hit.row.roleKey,
    roleName: hit.row.roleName,
  });

  for (const personId of afterHolders) {
    if (input.directPersonIds.has(personId)) continue;
    const hit = nearest(after, personId);
    if (!hit) continue;
    if (!beforeHolders.has(personId)) gains.push(toChange(hit));
    else {
      const old = nearest(before, personId);
      if (old && old.row.roleId !== hit.row.roleId) {
        roleChanges.push({
          personId,
          displayName: hit.row.displayName,
          active: hit.row.active,
          jobTitle: hit.row.jobTitle,
          from: {
            roleKey: old.row.roleKey,
            roleName: old.row.roleName,
            projectName: old.ancestor.projectName,
          },
          to: {
            roleKey: hit.row.roleKey,
            roleName: hit.row.roleName,
            projectName: hit.ancestor.projectName,
          },
        });
      }
    }
  }
  for (const personId of beforeHolders) {
    if (input.directPersonIds.has(personId) || afterHolders.has(personId))
      continue;
    const hit = nearest(before, personId);
    if (hit) losses.push(toChange(hit));
  }

  const byName = (a: RosterPerson, b: RosterPerson) =>
    (a.displayName ?? "").localeCompare(b.displayName ?? "") ||
    a.personId.localeCompare(b.personId);
  gains.sort(byName);
  losses.sort(byName);
  roleChanges.sort(byName);
  return { refusal, gains, losses, roleChanges };
}
