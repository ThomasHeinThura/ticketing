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
 * `legal_hold.placed` and `legal_hold.lifted` are wired to the instance legal-hold
 * endpoints (`/api/instance/legal-holds`) and write hash-chained audit rows inside the
 * hold placement and lift transactions.
 */
export const AUDIT_ONLY_ACTIONS = new Set<string>([
  // Authentication lifecycle, with the provider used.
  "auth.sign_in_succeeded",
  "auth.sign_in_failed",
  "auth.sign_out",
  "auth.password_reset_completed",
  "auth.password_reset_requested",
  "auth.password_changed",
  "auth.session_revoked",
  // Second factor enrolled; reset by an administrator (with the verification note).
  "auth.mfa_enrolled",
  "auth.mfa_reset",
  "auth.user_suspended",
  "auth.user_unsuspended",
  "auth.sessions_revoked",
  "auth.instance_admin_granted",
  "auth.instance_admin_break_glass",
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
  "project.customer_organisation_linked",
  "project.restored",
  // Overview (0213): the summary fields and lifecycle status; the contract and hour bank.
  "project.summary_updated",
  "project_contract.set",
  // Documents register (0216, U-15): an entry is added or edited. Deletion is a pending action.
  "document_link.created",
  "document_link.updated",
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
  "invitation.link_copied",
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
  "workspace.settings_updated",
  "project.settings_updated",
  "project.general_settings_updated",
  "project.states_updated",
  "user_preference.updated",
  "user.profile_updated",
  "notification.settings_updated",
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
  // D7 customer announcements (feature-contracts-p5.md "Announcements").
  "announcement.created",
  "announcement.updated",
  "announcement.published",
  "announcement.unpublished",
  "announcement.deleted",
  // CH-2: the opt-in CAB workflow template was applied to a workspace.
  "workflow.cab_template_applied",
  "workflow.created",
  "workflow.version_created",
  "workflow.version_published",
  "label.catalogue_created",
  "label.catalogue_updated",
  "label.catalogue_deleted",
  "canned_response.created",
  "canned_response.updated",
  "canned_response.deleted",
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
  // Tenancy lifecycle and legal holds.
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

/** Actions reserved in the catalogue that no writer may accept yet. Kept exported for
 * `audit-writer.ts`; empty now that `legal_hold.placed` and `legal_hold.lifted` are wired. */
export const AUDIT_ACTIONS_NOT_YET_WIRED = new Set<string>([]);
