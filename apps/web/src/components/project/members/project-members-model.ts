// Pure helpers for the project Members settings; kept free of React for unit tests. The server
// remains the authority for every roster rule (`PR-2`..`PR-4`).

export type RosterRoleView = {
  roleKey: string;
  roleName: string;
  roleRank: number;
  roleId: string | null;
  roleDescription?: string | null;
  isSystem?: boolean;
};

export type RosterMemberView = {
  personId: string;
  membershipId: string | null;
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

/** Select items for the roster roles (label is what the closed Select shows). */
export function rosterRoleItems(roles: readonly RosterRoleView[]) {
  return roles.map((role) => ({ value: role.roleKey, label: role.roleName }));
}

const BUILT_IN_DESCRIPTION_KEYS: Record<string, string> = {
  "project-lead": "settings:projectMembers.roleDescriptionLead",
  "project-member": "settings:projectMembers.roleDescriptionMember",
  "project-viewer": "settings:projectMembers.roleDescriptionViewer",
};

/** Built-in roles read from i18n by role key; custom roles keep the API's description. */
export function roleDescriptionText(
  role: RosterRoleView,
  t: (key: string) => string,
): string | null {
  const key = role.isSystem
    ? BUILT_IN_DESCRIPTION_KEYS[role.roleKey]
    : undefined;
  return key ? t(key) : (role.roleDescription ?? null);
}

const BUILT_IN_ORDER = ["project-lead", "project-member", "project-viewer"];

/** Built-in roles first (lead, member, viewer), then custom roles in the API's rank order. */
export function groupRosterRoles(roles: readonly RosterRoleView[]) {
  const builtIn = roles
    .filter((role) => role.isSystem)
    .sort(
      (a, b) =>
        (BUILT_IN_ORDER.indexOf(a.roleKey) + 1 || 99) -
        (BUILT_IN_ORDER.indexOf(b.roleKey) + 1 || 99),
    );
  return { builtIn, custom: roles.filter((role) => !role.isSystem) };
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
 * When `callerRank` is omitted (for example in a test fixture), every role is offered and the
 * server stays the authority. A role already held stays listed so the Select can display it.
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
