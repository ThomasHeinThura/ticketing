import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ONLY_ACTIONS } from "../../../apps/api/src/audit/actions";
import {
  HISTORY_ACTIONS,
  HISTORY_ENTITY_TYPES,
} from "../../../apps/api/src/audit/history-actions";
import { settingsHistoryQuery } from "../../../apps/api/src/audit/schema";
import { EVENT_KEYS } from "../../../apps/api/src/events/event-keys";

const SRC = join(__dirname, "../../../apps/api/src");

/** Audit actions written by the API that are deliberately not Settings History, with why. */
const NOT_SETTINGS_HISTORY: Record<string, string> = {
  "api_key.auto_disabled":
    "api key automatic or protocol event, not a settings change",
  "approval.closed": "approval workflow lifecycle, not a settings change",
  "approval.decided": "approval workflow lifecycle, not a settings change",
  "approval.expired": "approval workflow lifecycle, not a settings change",
  "approval.requested": "approval workflow lifecycle, not a settings change",
  "approval.withdrawn": "approval workflow lifecycle, not a settings change",
  "asset.purged": "asset purge, not a settings change",
  "attachment.downloaded": "attachment access event, not a settings change",
  "attachment.restored": "attachment access event, not a settings change",
  "audit.exported": "audit log read, export or purge, not a settings change",
  "audit.purged": "audit log read, export or purge, not a settings change",
  "audit.read": "audit log read, export or purge, not a settings change",
  "auth.instance_admin_break_glass":
    "authentication or session security event, not a settings change",
  "auth.instance_admin_granted":
    "authentication or session security event, not a settings change",
  "auth.mfa_reset":
    "authentication or session security event, not a settings change",
  "auth.password_reset_completed":
    "authentication or session security event, not a settings change",
  "auth.password_reset_requested":
    "authentication or session security event, not a settings change",
  "auth.sessions_revoked":
    "authentication or session security event, not a settings change",
  "auth.step_up_consumed":
    "authentication or session security event, not a settings change",
  "auth.step_up_denied":
    "authentication or session security event, not a settings change",
  "auth.step_up_issued":
    "authentication or session security event, not a settings change",
  "auth.user_suspended":
    "authentication or session security event, not a settings change",
  "auth.user_unsuspended":
    "authentication or session security event, not a settings change",
  "automation.notification_sent":
    "automation run side effect, not a settings change",
  "available_hours.created": "capacity record, not a settings change",
  "bulk.performed": "bulk work item operation, not a settings change",
  "change.freeze_overridden": "change record activity, not a settings change",
  "change.updated": "change record activity, not a settings change",
  "change_freeze.created": "change freeze record, not a settings change",
  "comment.deleted": "comment activity, not a settings change",
  "comment.updated": "comment activity, not a settings change",
  "cost_entry.created": "cost entry record, not a settings change",
  "cost_entry.deleted": "cost entry record, not a settings change",
  "cost_entry.updated": "cost entry record, not a settings change",
  "cycle.completed": "agile cycle record, not a settings change",
  "cycle.created": "agile cycle record, not a settings change",
  "cycle.deleted": "agile cycle record, not a settings change",
  "cycle.updated": "agile cycle record, not a settings change",
  "cycle.work_item_added": "agile cycle record, not a settings change",
  "cycle.work_item_removed": "agile cycle record, not a settings change",
  "dashboard.created": "dashboard content, not a settings change",
  "dashboard.deleted": "dashboard content, not a settings change",
  "dashboard.updated": "dashboard content, not a settings change",
  "document_link.created":
    "project document register entry, not a settings change",
  "document_link.updated":
    "project document register entry, not a settings change",
  "estimate.work_item_set":
    "per-item estimate value, not estimate configuration",
  "feature_flag.changed":
    "feature flag change has no History target in this contract",
  "hard_purge.executed": "retention purge event, not a settings change",
  "identity.deprovisioned": "identity lifecycle event, not a settings change",
  "identity.linked": "identity lifecycle event, not a settings change",
  "identity.placeholder_claimed":
    "identity lifecycle event, not a settings change",
  "impersonation.ended": "God Mode session event, not a settings change",
  "impersonation.started": "God Mode session event, not a settings change",
  "import.run": "import run event, not a settings change",
  "instance.delivery.requeued":
    "instance operational event outside the General settings contract",
  "instance.local_factor_policy_changed":
    "instance operational event outside the General settings contract",
  "instance.observability_changed":
    "instance operational event outside the General settings contract",
  "invitation.link_copied": "invitation lifecycle, not a settings change",
  "invitation.redeemed": "invitation lifecycle, not a settings change",
  "invitation.revoked": "invitation lifecycle, not a settings change",
  "invitation.sent": "invitation lifecycle, not a settings change",
  "job.triggered": "job run trigger, not a configuration change",
  "kb.settings_changed":
    "knowledge base settings have no History target in this contract",
  "kb_article.created": "knowledge article content, not a settings change",
  "kb_article.updated": "knowledge article content, not a settings change",
  "kb_article.version_restored":
    "knowledge article content, not a settings change",
  "kb_category.created": "knowledge category content, not a settings change",
  "kb_category.deleted": "knowledge category content, not a settings change",
  "kb_category.updated": "knowledge category content, not a settings change",
  "legal_hold.lifted": "legal hold record, not a settings change",
  "legal_hold.placed": "legal hold record, not a settings change",
  "mcp.request": "MCP request log, not a settings change",
  "module.created": "agile module record, not a settings change",
  "module.deleted": "agile module record, not a settings change",
  "module.updated": "agile module record, not a settings change",
  "module.work_item_added": "agile module record, not a settings change",
  "module.work_item_removed": "agile module record, not a settings change",
  "organisation.created": "organisation record, not a settings change",
  "organisation.deleted": "organisation record, not a settings change",
  "organisation.restored": "organisation record, not a settings change",
  "organisation.updated": "organisation record, not a settings change",
  "page.created": "page content, not a settings change",
  "page.deleted": "page content, not a settings change",
  "page.purged": "page content, not a settings change",
  "page.restored": "page content, not a settings change",
  "page.undeleted": "page content, not a settings change",
  "page.updated": "page content, not a settings change",
  "pending_action.decided": "pending-action lifecycle, not a settings change",
  "pending_action.executed": "pending-action lifecycle, not a settings change",
  "pending_action.requested": "pending-action lifecycle, not a settings change",
  "pending_action.viewed": "pending-action lifecycle, not a settings change",
  "permission.denied": "permission denial log, not a settings change",
  "plugin.tested": "plugin test run, not a configuration change",
  "project.customer_organisation_linked":
    "project lifecycle or overview record outside the Settings History contract",
  "project.reach_changed":
    "project lifecycle or overview record outside the Settings History contract",
  "project.restored":
    "project lifecycle or overview record outside the Settings History contract",
  "project.summary_updated":
    "project lifecycle or overview record outside the Settings History contract",
  "project_contract.set":
    "project contract or hour bank record, not a settings change",
  "release.checklist_toggled": "release record, not a settings change",
  "release.created": "release record, not a settings change",
  "release.notes_updated": "release record, not a settings change",
  "report.export_requested": "report export event, not a settings change",
  "report.exported": "report export event, not a settings change",
  "request_type.group_order_updated":
    "request type group ordering, not a request type setting",
  "satisfaction.rated": "customer rating, not a settings change",
  "saved_view.created": "saved view record, not a settings change",
  "saved_view.deleted": "saved view record, not a settings change",
  "saved_view.pinned": "saved view record, not a settings change",
  "saved_view.updated": "saved view record, not a settings change",
  "secrets.rekeyed": "secret rekey event, not a settings change",
  "service.created": "service catalogue record, not a settings change",
  "service.deleted": "service catalogue record, not a settings change",
  "service.status_changed": "service catalogue record, not a settings change",
  "service.updated": "service catalogue record, not a settings change",
  "service.work_item_linked": "service catalogue record, not a settings change",
  "submission.accepted": "portal submission lifecycle, not a settings change",
  "submission.claimed": "portal submission lifecycle, not a settings change",
  "submission.declined": "portal submission lifecycle, not a settings change",
  "submission.duplicate": "portal submission lifecycle, not a settings change",
  "submission.received": "portal submission lifecycle, not a settings change",
  "submission.reopen_requested":
    "portal submission lifecycle, not a settings change",
  "submission.reopened": "portal submission lifecycle, not a settings change",
  "submission.replied": "portal submission lifecycle, not a settings change",
  "submission.withdrawn": "portal submission lifecycle, not a settings change",
  "time_entry.created": "time entry record, not a settings change",
  "time_entry.deleted": "time entry record, not a settings change",
  "time_entry.timer_started": "time entry record, not a settings change",
  "time_entry.updated": "time entry record, not a settings change",
  "work_item.assigned": "work item activity, not a settings change",
  "work_item.commented": "work item activity, not a settings change",
  "work_item.deleted": "work item activity, not a settings change",
  "work_item.escalated": "work item activity, not a settings change",
  "work_item.exported": "work item activity, not a settings change",
  "work_item.transitioned": "work item activity, not a settings change",
  "work_item.unassigned": "work item activity, not a settings change",
  "work_item.updated": "work item activity, not a settings change",
  "workspace.created":
    "workspace lifecycle or bulk record, not a settings change",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}

const writtenActions = new Set(
  sourceFiles(SRC).flatMap((file) =>
    [
      ...readFileSync(file, "utf8").matchAll(
        /action:\s*"([a-z_]+\.[a-z_.]+)"/g,
      ),
    ].map((match) => match[1] as string),
  ),
);
const historyActions = new Set<string>([
  ...Object.values(HISTORY_ACTIONS.entity).flat(),
  ...Object.values(HISTORY_ACTIONS.personal).flat(),
]);

describe("settings history action inventory", () => {
  it("classifies every audit action the API writes", () => {
    expect(writtenActions.size).toBeGreaterThan(100);
    const unclassified = [...writtenActions].filter(
      (action) =>
        !historyActions.has(action) && !(action in NOT_SETTINGS_HISTORY),
    );
    expect(unclassified).toEqual([]);
  });

  it("keeps the allowlist honest", () => {
    const stale = Object.keys(NOT_SETTINGS_HISTORY).filter(
      (action) => !writtenActions.has(action) || historyActions.has(action),
    );
    expect(stale).toEqual([]);
    expect(Object.values(NOT_SETTINGS_HISTORY).every(Boolean)).toBe(true);
  });

  it("lists only actions the audit writer accepts", () => {
    const unknown = [...historyActions].filter(
      (action) => !AUDIT_ONLY_ACTIONS.has(action) && !EVENT_KEYS.has(action),
    );
    expect(unknown).toEqual([]);
  });

  it("drives the request enum from the same table", () => {
    expect(settingsHistoryQuery.shape.entity_type.options).toEqual(
      HISTORY_ENTITY_TYPES,
    );
  });

  it("estimates show estimate configuration only", () => {
    expect(HISTORY_ACTIONS.entity.project_estimates).toEqual([
      "estimate.configured",
      "estimate.system_changed",
    ]);
    expect(HISTORY_ACTIONS.entity.project).toContain("agile.settings_updated");
  });
});
