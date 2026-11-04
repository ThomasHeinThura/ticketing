/**
 * The service calendar a new project inherits when the create call names none. The
 * organisation's per-workspace default row wins whenever it exists, even when that row sets
 * only an SLA policy (its calendar is then null and the workspace default is NOT used); the
 * workspace default applies only when no such row exists. `createProjectRow` and the
 * create-project organisation list both use this, so the dialog and the PR-9 check agree.
 */
export function inheritedServiceCalendarId(input: {
  organisationDefault: { serviceCalendarId: string | null } | undefined;
  workspaceDefaultCalendarId: string | null;
}) {
  return input.organisationDefault
    ? input.organisationDefault.serviceCalendarId
    : input.workspaceDefaultCalendarId;
}
