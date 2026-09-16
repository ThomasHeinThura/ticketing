/**
 * Error classes specific to the S6a native invitation-CREATE controller
 * (issue #6, retrofit plan §3, S6a row).
 *
 * `OwnerRoleNotAssignableHereError`, `WorkspaceRoleNotFoundError` and
 * `UserAlreadyMemberError` are NOT redeclared here -- S5's
 * `workspace-membership-errors.ts` already has the exact same meaning
 * ("the requested role is `owner`", "no such workspace_role row", "the
 * target is already a member") and `invite-workspace-member.ts` imports
 * those directly rather than defining lookalikes a second time.
 */

/**
 * There is already a pending, unexpired invitation for this `(workspaceId,
 * email)` pair, and the caller did not ask to resend.
 *
 * Mirrors better-auth's own `USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION`
 * (`crud-invites.mjs`). The caller's fix is either to pass `resend: true`
 * (which refreshes the existing invitation's expiry and re-sends the email
 * rather than creating a second row) or to cancel the existing invitation
 * first.
 */
export class InvitationAlreadyPendingError extends Error {
  constructor() {
    super("There is already a pending invitation for this email");
    this.name = "InvitationAlreadyPendingError";
  }
}

/**
 * The workspace already holds `MAX_PENDING_INVITATIONS_PER_WORKSPACE`
 * (`../../utils/workspace-invitation-limits.ts`) pending invitations, and the
 * call that hit this is one that would create a brand NEW row -- a `resend`
 * of an existing pending invitation never reaches this check, since it
 * updates the same row instead of inserting another.
 */
export class InvitationLimitReachedError extends Error {
  constructor(public readonly limit: number) {
    super(
      `This workspace already has the maximum of ${limit} pending invitations`,
    );
    this.name = "InvitationLimitReachedError";
  }
}
