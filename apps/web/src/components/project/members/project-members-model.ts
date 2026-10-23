// Pure helpers for the project Members settings; kept free of React for unit tests. The server
// remains the authority for every roster rule (`PR-2`..`PR-4`).

export type RosterRoleView = {
  roleKey: string;
  roleName: string;
  roleRank: number;
  roleId: string | null;
};

export type RosterMemberView = {
  personId: string;
  displayName: string | null;
  active: boolean;
  jobTitle: string | null;
  roleKey: string;
  roleName: string;
  source: string;
  inheritedFrom: { projectId: string; projectName: string } | null;
  overridesInherited: { roleKey: string; roleName: string } | null;
  managedExternally: boolean;
  removable: boolean;
};

/** Select items for the roster roles, lowest rank first (the API already sorts them). */
export function rosterRoleItems(roles: readonly RosterRoleView[]) {
  return roles.map((role) => ({ value: role.roleKey, label: role.roleName }));
}

/**
 * A project-scope role replaces the person's workspace role on this one project
 * (permissions.md "Project authority overrides workspace authority for that project"), so
 * adding a workspace owner, admin or manager can lower their authority here. The dialog says so.
 */
export function isAuthorityReplacingWorkspaceRole(workspaceRole: string) {
  return ["owner", "admin", "manager"].includes(workspaceRole);
}

/**
 * Roles the caller may grant: rank at or below their own (`role_exceeds_caller_authority`).
 * The roster response does not carry the caller's rank yet; without it every role is offered
 * and the server stays the authority. A role already held stays listed so the Select can
 * display it.
 */
export function assignableRoles(
  roles: readonly RosterRoleView[],
  callerRank: number | null | undefined,
  currentRoleKey?: string,
): RosterRoleView[] {
  if (typeof callerRank !== "number") return [...roles];
  return roles.filter(
    (role) => role.roleRank <= callerRank || role.roleKey === currentRoleKey,
  );
}

const ERROR_KEYS: Record<string, string> = {
  inherited_membership: "settings:projectMembers.errors.inheritedMembership",
  managed_membership: "settings:projectMembers.errors.managedMembership",
  role_exceeds_caller_authority:
    "settings:projectMembers.errors.roleExceedsAuthority",
  already_member: "settings:projectMembers.errors.alreadyMember",
  person_not_eligible: "settings:projectMembers.errors.personNotEligible",
  project_role_not_found: "settings:projectMembers.errors.roleNotFound",
  pending_action_target_changed: "settings:projectMembers.errors.targetChanged",
};

/**
 * The i18n key for a roster refusal. The server's text starts with a machine code
 * (`inherited_membership: inherited from project <uuid>...`); only the code is used, so raw
 * server text and project ids never reach a toast.
 */
export function projectMemberErrorKey(
  failure: unknown,
  fallbackKey: string,
): string {
  const message =
    failure instanceof Error && typeof failure.message === "string"
      ? failure.message
      : "";
  const code = /^([a-z][a-z0-9_]*)(?::|$)/.exec(message.trim())?.[1];
  if (code && ERROR_KEYS[code]) return ERROR_KEYS[code];
  const status = (failure as { status?: unknown } | null)?.status;
  if (status === 403) return "settings:projectMembers.errors.forbidden";
  if (status === 409) return "settings:projectMembers.errors.conflict";
  return fallbackKey;
}
