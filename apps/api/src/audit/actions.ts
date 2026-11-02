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
  "auth.user_suspended",
  "auth.user_unsuspended",
  "auth.sessions_revoked",
  "auth.instance_admin_granted",
  "auth.step_up_issued",
  "auth.step_up_consumed",
  "auth.step_up_denied",
  // GM-7, GM-11.
  "impersonation.started",
  "impersonation.ended",
  // A pending approval closed by a run of its transition (owner decision 2026-10-10).
  "approval.closed",
  // Authority and reach changes.
  "role.created",
  "role.updated",
  "role.deleted",
  "membership.changed",
  "membership.sees_all_granted",
  // `owner_team_id` or `parent_id` changed (rbac.md#reach).
  "project.reach_changed",
  "project.restored",
  // Overview (0213): the summary fields and lifecycle status; the contract and hour bank.
  "project.summary_updated",
  "project_contract.set",
  "sla_policy.created",
  "sla_policy.updated",
  "sla_policy.published",
  "request_type.created",
  "request_type.updated",
  "request_type.group_order_updated",
  "request_type.published",
  "request_type.unpublished",
  "request_type.deleted",
  "submission.claimed",
  "submission.duplicate",
  "submission.reopened",
  "submission.reopen_requested",
  "satisfaction.rated",
  "comment.updated",
  "comment.deleted",
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
  // RP-10: a large export was queued for the `report-export` job (nothing has left yet).
  "report.export_requested",
  "attachment.downloaded",
  "attachment.restored",
  "config.exported",
  "instance.exported",
  // One summary row per bulk operation (plus one per item).
  "bulk.performed",
  // Run-level import audit; a manual job trigger.
  "import.run",
  "identity.placeholder_claimed",
  "identity.linked",
  "workspace.project_settings_updated",
  "project.settings_updated",
  "state_template.created",
  "state_template.updated",
  "job.triggered",
  "job.configuration_changed",
  "instance.delivery.requeued",
  // Durable-authority lifecycle.
  "api_key.created",
  "api_key.reattested",
  "api_key.ownership_transferred",
  "api_key.revoked",
  "webhook.created",
  "webhook.deleted",
  "webhook.updated",
  "webhook.secret_rotated",
  // Rule state.
  "automation.created",
  "automation.updated",
  "automation.deleted",
  "automation.enabled",
  "automation.disabled",
  // P4 configuration governance: custom fields and sections, teams, instance settings.
  "custom_field.created",
  "custom_field.updated",
  "custom_field.deleted",
  "custom_field.restored",
  // CF-8: the scheduled hard delete after the 30 day restore window (system actor).
  "custom_field.purged",
  "custom_field_section.created",
  "custom_field_section.updated",
  "custom_field_section.deleted",
  "team.created",
  "team.updated",
  "team.deleted",
  "team.member_added",
  "team.member_updated",
  "team.member_removed",
  // P5 service management: services, change details, freezes (and the prominent override), releases.
  "service.created",
  "service.updated",
  "service.status_changed",
  "service.deleted",
  "service.work_item_linked",
  "change.updated",
  "change.freeze_overridden",
  "change_freeze.created",
  "change_freeze.updated",
  "change_freeze.cancelled",
  "release.created",
  "release.updated",
  "release.published",
  "release.notes_updated",
  "release.checklist_toggled",
  // CH-2: the opt-in CAB workflow template was applied to a workspace.
  "workflow.cab_template_applied",
  // P5 knowledge base (KB-3, KB-4): article lifecycle, categories and the review-step setting.
  "kb_article.created",
  "kb_article.updated",
  "kb_article.submitted",
  "kb_article.published",
  "kb_article.unpublished",
  "kb_article.archived",
  "kb_article.restored",
  "kb_article.version_restored",
  "kb_category.created",
  "kb_category.updated",
  "kb_category.deleted",
  "kb.settings_changed",
  "instance.settings_changed",
  "terminology.changed",
  // P5 time and cost (feature-contracts-p5.md, time-and-cost).
  "time_entry.created",
  "time_entry.updated",
  "time_entry.deleted",
  "time_entry.timer_started",
  "time_entry.timer_stopped",
  "time_entry.timer_capped",
  "time_activity.created",
  "time_activity.updated",
  "time_settings.updated",
  "hourly_rate.created",
  "budget.created",
  "cost_type.created",
  "cost_type.updated",
  "cost_entry.created",
  "cost_entry.updated",
  "cost_entry.deleted",
  "available_hours.created",
  // P5 agile planning: cycles, modules, estimates (feature-contracts-p5.md, agile).
  "cycle.created",
  "cycle.updated",
  "cycle.deleted",
  "cycle.completed",
  "cycle.work_item_added",
  "cycle.work_item_removed",
  "module.created",
  "module.updated",
  "module.deleted",
  "module.work_item_added",
  "module.work_item_removed",
  "estimate.configured",
  "estimate.system_changed",
  "estimate.work_item_set",
  "agile.settings_updated",
  // P5 project pages (feature-contracts-p5.md, PG-8). Metadata only, never the body.
  "page.created",
  "page.updated",
  "page.restored",
  "page.deleted",
  // PG-7: restored from the 30 day window / hard-deleted after it (system actor, no body).
  "page.undeleted",
  "page.purged",
  // attachment-gc (P0R2-02): a detached inline asset collected after its recovery window
  // (system actor; asset metadata only).
  "asset.purged",
  // P5 reports (RP-13..RP-15): dashboards and their layouts.
  "dashboard.created",
  "dashboard.updated",
  "dashboard.deleted",
  // VW-12: a board column's work-in-progress limit.
  "state.wip_limit_changed",
  // A work item's content was sent to an ai.* provider.
  "ai.sent_externally",
  // MC-4: mark each MCP request as agent-originated without recording request content.
  "mcp.request",
  // Tenancy lifecycle. legal_hold.* not wired yet — see doc comment above.
  "organisation.created",
  "organisation.updated",
  "organisation.suspended",
  "organisation.unsuspended",
  "organisation.restored",
  "organisation.deleted",
  "legal_hold.placed",
  "legal_hold.lifted",
  // AU-13; the purge audits itself.
  "audit.read",
  "audit.exported",
  "audit.purged",
  // PA-13 hard purge; the event stream uses pending_action.executed.
  "hard_purge.executed",
  // A restore completed (backup-and-restore.md).
  "instance.restored",
  "instance.observability_changed",
  "instance.local_factor_policy_changed",
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
