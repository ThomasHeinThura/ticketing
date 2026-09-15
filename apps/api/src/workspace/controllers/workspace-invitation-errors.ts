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
