/**
 * The one table of audit actions that Settings History may show. The repository filter, the
 * personal-history reader and the response schema all read it; a new settings action is added
 * here (or listed with a reason in the `NOT_SETTINGS_HISTORY` test allowlist), never inline.
 */
const entity = {
  instance: ["instance.settings_changed"],
  workspace: [
    "workspace.settings_updated",
    "workspace.project_settings_updated",
    "time_settings.updated",
  ],
  project: [
    "project.settings_updated",
    "project.general_settings_updated",
    "project.states_updated",
    "time_settings.updated",
    "agile.settings_updated",
  ],
  role: ["role.created", "role.updated", "role.deleted"],
  workflow: [
    "workflow.created",
    "workflow.version_created",
    "workflow.version_published",
    "workflow.cab_template_applied",
  ],
  team: [
    "team.created",
    "team.updated",
    "team.deleted",
    "team.member_added",
    "team.member_updated",
    "team.member_removed",
  ],
  service_calendar: [
    "service_calendar.created",
    "service_calendar.updated",
    "service_calendar.deleted",
  ],
  sla_policy: [
    "sla_policy.created",
    "sla_policy.updated",
    "sla_policy.published",
  ],
  request_type: [
    "request_type.created",
    "request_type.updated",
    "request_type.published",
    "request_type.unpublished",
    "request_type.deleted",
  ],
  custom_field: [
    "custom_field.created",
    "custom_field.updated",
    "custom_field.deleted",
    "custom_field.restored",
    "custom_field.purged",
  ],
  custom_field_section: [
    "custom_field_section.created",
    "custom_field_section.updated",
    "custom_field_section.deleted",
  ],
  state_template: ["state_template.created", "state_template.updated"],
  webhook: [
    "webhook.created",
    "webhook.updated",
    "webhook.deleted",
    "webhook.secret_rotated",
    "webhook.auto_disabled",
  ],
  canned_response: [
    "canned_response.created",
    "canned_response.updated",
    "canned_response.deleted",
  ],
  workspace_label: [
    "label.catalogue_created",
    "label.catalogue_updated",
    "label.catalogue_deleted",
  ],
  project_label: [
    "label.catalogue_created",
    "label.catalogue_updated",
    "label.catalogue_deleted",
  ],
  automation: [
    "automation.created",
    "automation.updated",
    "automation.enabled",
    "automation.disabled",
    "automation.deleted",
  ],
  state: ["state.wip_limit_changed"],
  time_activity: ["time_activity.created", "time_activity.updated"],
  cost_type: ["cost_type.created", "cost_type.updated"],
  hourly_rate: ["hourly_rate.created"],
  budget: ["budget.created"],
  // Membership rows additionally need role-change provenance in the repository filter.
  workspace_member: ["membership.changed"],
  project_membership: ["membership.changed"],
  // Plugin aliases: several targets share `plugin.changed` and are told apart by entity type/id.
  instance_notification_provider: ["plugin.changed"],
  instance_storage_draft: ["plugin.changed"],
  instance_auth_methods: ["plugin.changed"],
  staff_self_registration: ["plugin.changed"],
  instance_job: ["job.configuration_changed"],
  identity_connection: ["identity_connection.changed"],
  import_source_connection: ["plugin.changed"],
  terminology_override: ["terminology.changed"],
  project_estimates: ["estimate.configured", "estimate.system_changed"],
  service_api_key: [
    "api_key.created",
    "api_key.revoked",
    "api_key.reattested",
    "api_key.ownership_transferred",
  ],
} as const;

/** Self-service sections; the customer portal has no second factor to report. */
const personal = {
  profile: ["user.profile_updated"],
  preferences: ["user_preference.updated"],
  notifications: ["notification.settings_updated"],
  security_staff: ["auth.password_changed", "auth.mfa_enrolled"],
  security_customer: ["auth.password_changed"],
  apiKeys: ["api_key.created", "api_key.revoked"],
} as const;

export const HISTORY_ACTIONS = { entity, personal } as const;

export type HistoryEntityType = keyof typeof entity;

export const HISTORY_ENTITY_TYPES = Object.keys(entity) as [
  HistoryEntityType,
  ...HistoryEntityType[],
];

/** Targets that live on the instance (or an import source) rather than on a workspace row. */
export const INSTANCE_PLUGIN_TARGETS: ReadonlySet<string> = new Set([
  "instance_notification_provider",
  "instance_storage_draft",
  "instance_auth_methods",
  "staff_self_registration",
  "instance_job",
  "identity_connection",
  "import_source_connection",
]);
