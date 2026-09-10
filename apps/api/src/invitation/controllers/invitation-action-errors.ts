/**
 * Error classes for the S6a native invitation-ACTION controllers (accept,
 * reject, cancel) -- issue #6, retrofit plan §3, S6a row.
 */

/** No `invitation` row for this id. */
export class InvitationNotFoundError extends Error {
  constructor() {
    super("Invitation not found");
    this.name = "InvitationNotFoundError";
  }
}

/**
 * The invitation's `status` is not `"pending"`. Covers an invitation already
 * accepted, already canceled (which is also what a rejection is stored as --
 * see `reject-invitation.ts`), or expired.
 */
export class InvitationNotPendingError extends Error {
  constructor() {
    super("This invitation is no longer pending");
    this.name = "InvitationNotPendingError";
  }
}

/** The invitation's `expiresAt` has passed. Reported distinctly from
 * `InvitationNotPendingError`, matching `getInvitationDetails`
 * (`check-registration-allowed.ts`), which also gives expiry its own
 * message rather than folding it into "not pending". */
export class InvitationExpiredError extends Error {
  constructor() {
    super("This invitation has expired");
    this.name = "InvitationExpiredError";
  }
}

/** The caller's own session email does not match `invitation.email`
 * (case-insensitively). Mirrors better-auth's own
 * `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`. */
export class NotInvitationRecipientError extends Error {
  constructor() {
    super("You are not the recipient of this invitation");
    this.name = "NotInvitationRecipientError";
  }
}

/**
 * Issue #88. The caller already has a `workspace_member` row for this
 * invitation's workspace at the moment the accept transaction holds the
 * advisory lock. better-auth's own `acceptInvitation` has no equivalent
 * check at all (`adapter.createMember` unconditionally, `crud-invites.mjs`)
 * -- this is the fix the S6a row exists to make, and it is what closes
 * issue #88's duplicate-membership path AT SOURCE for this native route.
 */
export class AlreadyWorkspaceMemberError extends Error {
  constructor() {
    super("You are already a member of this workspace");
    this.name = "AlreadyWorkspaceMemberError";
  }
}
