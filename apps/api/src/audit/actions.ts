/**
 * The audit action catalogue — `docs/03-features/audit-trail.md` § "Audit action
 * catalogue", transcribed verbatim. Per that section: "Where a domain event exists for
 * the mutation, the audit action is that event's key from `events.md` ... The keys below
 * are audit-only: security-relevant things that are not domain events."
 *
 * This module is one half of the audit-action check, and since #360 the other half
 * exists: the event-key registry (`apps/api/src/events/event-keys.ts`, transcribed from
 * `events.md`'s Catalogue) — `audit-writer.ts`'s `validateAction` accepts the union of
 * this audit-only catalogue and that registry. When this module was written no
 * code-level event-key set existed anywhere, so the writer could only ever validate
 * half of the real rule `audit-trail.md` describes; both halves now close over their
 * own authoritative doc (audit-trail.md here, events.md there), and a code-level list
 * that drifts from its doc fails a test rather than silently mis-validating.
 *
 * `legal_hold.placed`/`legal_hold.lifted` are included in the set below (so a real
 * future caller does not fail validation) but nothing in this codebase writes them yet —
 * `schema.ts`'s comment on `legalHoldTable` says so explicitly: "placing a hold is
 * specified as audited ... and this repository has no audit-log write path yet ... the
 * table lands first ... placing and lifting follow the audit-log writer (issue #37's
 * remaining scope), tracked on #198." That remains true after this slice: this PR adds
 * the writer, not the legal-hold wiring, which is #198's job.
 */
export const AUDIT_ONLY_ACTIONS = new Set<string>([
  // Authentication lifecycle, with the provider used.
  "auth.sign_in_succeeded",
  "auth.sign_in_failed",
  "auth.sign_out",
  "auth.session_revoked",
  // Second factor enrolled; reset by an administrator (with the verification note).
  "auth.mfa_enrolled",
  "auth.mfa_reset",
  // GM-7, GM-11.
  "impersonation.started",
  "impersonation.ended",
  // Authority and reach changes.
  "role.created",
  "role.updated",
  "role.deleted",
  "membership.changed",
  "membership.sees_all_granted",
  // `owner_team_id` or `parent_id` changed (rbac.md#reach).
  "project.reach_changed",
  // Invitations.
  "invitation.sent",
  "invitation.redeemed",
  "invitation.revoked",
  // Plugin configuration (keys only, never values), a test() call even when unsaved,
  // key rotation.
  "plugin.changed",
  "plugin.tested",
  "secrets.rekeyed",
  // Any level.
  "feature_flag.changed",
  // A 403 or an out-of-reach 404 on a scoped route.
  "permission.denied",
  // Data leaving through a person's hands.
  "work_item.exported",
  "report.exported",
  "attachment.downloaded",
  "config.exported",
  "instance.exported",
  // One summary row per bulk operation (plus one per item).
  "bulk.performed",
  // Run-level import audit; a manual job trigger.
  "import.run",
  "job.triggered",
  // Durable-authority lifecycle.
  "api_key.created",
  "api_key.revoked",
  "webhook.created",
  "webhook.deleted",
  "webhook.secret_rotated",
  // Rule state.
  "automation.enabled",
  "automation.disabled",
  // A work item's content was sent to an ai.* provider.
  "ai.sent_externally",
  // Tenancy lifecycle. legal_hold.* not wired yet — see doc comment above.
  "organisation.created",
  "organisation.suspended",
  "organisation.deleted",
  "legal_hold.placed",
  "legal_hold.lifted",
  // AU-13; the purge audits itself.
  "audit.read",
  "audit.exported",
  "audit.purged",
  // A restore completed (backup-and-restore.md).
  "instance.restored",
  // The one pending-action transition that is not an event (PA-11).
  "pending_action.viewed",
]);

/** Actions no writer may ever accept, even though they parse as valid dotted keys —
 * `legal_hold.*` is deliberately excluded from what THIS writer will actually insert
 * until #198 wires it, per the module doc comment above. Kept as a separate export
 * (rather than removed from `AUDIT_ONLY_ACTIONS`) so the catalogue itself stays a
 * faithful transcription of the spec, and the "not wired yet" restriction lives in code
 * that visibly says why, next to the check that enforces it. */
export const AUDIT_ACTIONS_NOT_YET_WIRED = new Set<string>([
  "legal_hold.placed",
  "legal_hold.lifted",
]);
