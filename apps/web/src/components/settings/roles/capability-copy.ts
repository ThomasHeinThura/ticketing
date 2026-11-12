// Translation keys are indexed by the stable permissions registry identifiers.
export const CAPABILITY_LABEL_KEYS: Readonly<Record<string, string>> = {
  "workspace:read": "roles:capabilityCatalog.labels.workspace__read",
  "workspace:update": "roles:capabilityCatalog.labels.workspace__update",
  "workspace:delete": "roles:capabilityCatalog.labels.workspace__delete",
  "workspace:manage_members":
    "roles:capabilityCatalog.labels.workspace__manage_members",
  "workspace:manage_roles":
    "roles:capabilityCatalog.labels.workspace__manage_roles",
  "workspace:manage_settings":
    "roles:capabilityCatalog.labels.workspace__manage_settings",
  "workspace:transfer_ownership":
    "roles:capabilityCatalog.labels.workspace__transfer_ownership",
  "project:create": "roles:capabilityCatalog.labels.project__create",
  "project:read": "roles:capabilityCatalog.labels.project__read",
  "project:update": "roles:capabilityCatalog.labels.project__update",
  "project:manage_members":
    "roles:capabilityCatalog.labels.project__manage_members",
  "project:manage_settings":
    "roles:capabilityCatalog.labels.project__manage_settings",
  "project:archive": "roles:capabilityCatalog.labels.project__archive",
  "project:delete": "roles:capabilityCatalog.labels.project__delete",
  "work_item:read": "roles:capabilityCatalog.labels.work_item__read",
  "work_item:create": "roles:capabilityCatalog.labels.work_item__create",
  "work_item:update": "roles:capabilityCatalog.labels.work_item__update",
  "work_item:delete": "roles:capabilityCatalog.labels.work_item__delete",
  "work_item:assign": "roles:capabilityCatalog.labels.work_item__assign",
  "work_item:transition":
    "roles:capabilityCatalog.labels.work_item__transition",
  "work_item:rank": "roles:capabilityCatalog.labels.work_item__rank",
  "work_item:set_priority":
    "roles:capabilityCatalog.labels.work_item__set_priority",
  "work_item:escalate_priority":
    "roles:capabilityCatalog.labels.work_item__escalate_priority",
  "work_item:export": "roles:capabilityCatalog.labels.work_item__export",
  "comment:create": "roles:capabilityCatalog.labels.comment__create",
  "comment:create_internal":
    "roles:capabilityCatalog.labels.comment__create_internal",
  "comment:update_own": "roles:capabilityCatalog.labels.comment__update_own",
  "comment:delete_own": "roles:capabilityCatalog.labels.comment__delete_own",
  "comment:update_any": "roles:capabilityCatalog.labels.comment__update_any",
  "comment:delete_any": "roles:capabilityCatalog.labels.comment__delete_any",
  "attachment:create": "roles:capabilityCatalog.labels.attachment__create",
  "attachment:delete_own":
    "roles:capabilityCatalog.labels.attachment__delete_own",
  "attachment:delete_any":
    "roles:capabilityCatalog.labels.attachment__delete_any",
  "label:manage": "roles:capabilityCatalog.labels.label__manage",
  "custom_field:manage": "roles:capabilityCatalog.labels.custom_field__manage",
  "saved_view:read": "roles:capabilityCatalog.labels.saved_view__read",
  "saved_view:create": "roles:capabilityCatalog.labels.saved_view__create",
  "saved_view:share": "roles:capabilityCatalog.labels.saved_view__share",
  "sla_policy:read": "roles:capabilityCatalog.labels.sla_policy__read",
  "sla_policy:manage": "roles:capabilityCatalog.labels.sla_policy__manage",
  "workflow:read": "roles:capabilityCatalog.labels.workflow__read",
  "workflow:manage": "roles:capabilityCatalog.labels.workflow__manage",
  "request_type:read": "roles:capabilityCatalog.labels.request_type__read",
  "request_type:manage": "roles:capabilityCatalog.labels.request_type__manage",
  "intake:triage": "roles:capabilityCatalog.labels.intake__triage",
  "approval:request": "roles:capabilityCatalog.labels.approval__request",
  "approval:request_cab":
    "roles:capabilityCatalog.labels.approval__request_cab",
  "approval:decide": "roles:capabilityCatalog.labels.approval__decide",
  "approval:decide_cab": "roles:capabilityCatalog.labels.approval__decide_cab",
  "time_entry:create": "roles:capabilityCatalog.labels.time_entry__create",
  "time_entry:update_own":
    "roles:capabilityCatalog.labels.time_entry__update_own",
  "time_entry:delete_own":
    "roles:capabilityCatalog.labels.time_entry__delete_own",
  "time_entry:read_any": "roles:capabilityCatalog.labels.time_entry__read_any",
  "time_entry:update_any":
    "roles:capabilityCatalog.labels.time_entry__update_any",
  "time_entry:delete_any":
    "roles:capabilityCatalog.labels.time_entry__delete_any",
  "time_entry:log_backdated":
    "roles:capabilityCatalog.labels.time_entry__log_backdated",
  "time_entry:manage_rates":
    "roles:capabilityCatalog.labels.time_entry__manage_rates",
  "budget:read": "roles:capabilityCatalog.labels.budget__read",
  "budget:manage": "roles:capabilityCatalog.labels.budget__manage",
  "report:read": "roles:capabilityCatalog.labels.report__read",
  "report:read_all": "roles:capabilityCatalog.labels.report__read_all",
  "report:export": "roles:capabilityCatalog.labels.report__export",
  "kb_article:read": "roles:capabilityCatalog.labels.kb_article__read",
  "kb_article:write": "roles:capabilityCatalog.labels.kb_article__write",
  "kb_article:publish": "roles:capabilityCatalog.labels.kb_article__publish",
  "service:read": "roles:capabilityCatalog.labels.service__read",
  "service:manage": "roles:capabilityCatalog.labels.service__manage",
  "change:manage": "roles:capabilityCatalog.labels.change__manage",
  "release:manage": "roles:capabilityCatalog.labels.release__manage",
  "member:invite": "roles:capabilityCatalog.labels.member__invite",
  "member:remove": "roles:capabilityCatalog.labels.member__remove",
  "api_key:manage": "roles:capabilityCatalog.labels.api_key__manage",
  "webhook:manage": "roles:capabilityCatalog.labels.webhook__manage",
  "automation:manage": "roles:capabilityCatalog.labels.automation__manage",
};

export const CAPABILITY_DESCRIPTION_KEYS: Readonly<Record<string, string>> = {
  "instance:admin": "roles:capabilityCatalog.descriptions.instance__admin",
  "instance:read_audit":
    "roles:capabilityCatalog.descriptions.instance__read_audit",
  "instance:manage_plugins":
    "roles:capabilityCatalog.descriptions.instance__manage_plugins",
  "instance:manage_jobs":
    "roles:capabilityCatalog.descriptions.instance__manage_jobs",
  "instance:manage_terminology":
    "roles:capabilityCatalog.descriptions.instance__manage_terminology",
  "workspace:read": "roles:capabilityCatalog.descriptions.workspace__read",
  "workspace:update": "roles:capabilityCatalog.descriptions.workspace__update",
  "workspace:delete": "roles:capabilityCatalog.descriptions.workspace__delete",
  "workspace:manage_members":
    "roles:capabilityCatalog.descriptions.workspace__manage_members",
  "workspace:manage_roles":
    "roles:capabilityCatalog.descriptions.workspace__manage_roles",
  "workspace:manage_settings":
    "roles:capabilityCatalog.descriptions.workspace__manage_settings",
  "workspace:transfer_ownership":
    "roles:capabilityCatalog.descriptions.workspace__transfer_ownership",
  "project:create": "roles:capabilityCatalog.descriptions.project__create",
  "project:read": "roles:capabilityCatalog.descriptions.project__read",
  "project:update": "roles:capabilityCatalog.descriptions.project__update",
  "project:manage_members":
    "roles:capabilityCatalog.descriptions.project__manage_members",
  "project:manage_settings":
    "roles:capabilityCatalog.descriptions.project__manage_settings",
  "project:archive": "roles:capabilityCatalog.descriptions.project__archive",
  "project:delete": "roles:capabilityCatalog.descriptions.project__delete",
  "work_item:read": "roles:capabilityCatalog.descriptions.work_item__read",
  "work_item:create": "roles:capabilityCatalog.descriptions.work_item__create",
  "work_item:update": "roles:capabilityCatalog.descriptions.work_item__update",
  "work_item:delete": "roles:capabilityCatalog.descriptions.project__delete",
  "work_item:assign": "roles:capabilityCatalog.descriptions.work_item__assign",
  "work_item:transition":
    "roles:capabilityCatalog.descriptions.work_item__transition",
  "work_item:rank": "roles:capabilityCatalog.descriptions.work_item__rank",
  "work_item:set_priority":
    "roles:capabilityCatalog.descriptions.work_item__set_priority",
  "work_item:escalate_priority":
    "roles:capabilityCatalog.descriptions.work_item__escalate_priority",
  "work_item:export": "roles:capabilityCatalog.descriptions.work_item__export",
  "comment:create": "roles:capabilityCatalog.descriptions.comment__create",
  "comment:create_internal":
    "roles:capabilityCatalog.descriptions.comment__create_internal",
  "comment:update_own":
    "roles:capabilityCatalog.descriptions.comment__update_own",
  "comment:delete_own":
    "roles:capabilityCatalog.descriptions.comment__delete_own",
  "comment:update_any":
    "roles:capabilityCatalog.descriptions.comment__update_any",
  "comment:delete_any":
    "roles:capabilityCatalog.descriptions.comment__delete_any",
  "attachment:create":
    "roles:capabilityCatalog.descriptions.attachment__create",
  "attachment:delete_own":
    "roles:capabilityCatalog.descriptions.attachment__delete_own",
  "attachment:delete_any":
    "roles:capabilityCatalog.descriptions.attachment__delete_any",
  "label:manage": "roles:capabilityCatalog.descriptions.label__manage",
  "custom_field:manage":
    "roles:capabilityCatalog.descriptions.custom_field__manage",
  "saved_view:read": "roles:capabilityCatalog.descriptions.saved_view__read",
  "saved_view:create":
    "roles:capabilityCatalog.descriptions.saved_view__create",
  "saved_view:share": "roles:capabilityCatalog.descriptions.saved_view__share",
  "sla_policy:read": "roles:capabilityCatalog.descriptions.sla_policy__read",
  "sla_policy:manage":
    "roles:capabilityCatalog.descriptions.sla_policy__manage",
  "workflow:read": "roles:capabilityCatalog.descriptions.workflow__read",
  "workflow:manage": "roles:capabilityCatalog.descriptions.workflow__manage",
  "request_type:read":
    "roles:capabilityCatalog.descriptions.request_type__read",
  "request_type:manage":
    "roles:capabilityCatalog.descriptions.request_type__manage",
  "intake:triage": "roles:capabilityCatalog.descriptions.intake__triage",
  "approval:request": "roles:capabilityCatalog.descriptions.approval__request",
  "approval:request_cab":
    "roles:capabilityCatalog.descriptions.approval__request_cab",
  "approval:decide": "roles:capabilityCatalog.descriptions.approval__decide",
  "approval:decide_cab":
    "roles:capabilityCatalog.descriptions.approval__decide_cab",
  "time_entry:create":
    "roles:capabilityCatalog.descriptions.time_entry__create",
  "time_entry:update_own":
    "roles:capabilityCatalog.descriptions.time_entry__update_own",
  "time_entry:delete_own":
    "roles:capabilityCatalog.descriptions.time_entry__delete_own",
  "time_entry:read_any":
    "roles:capabilityCatalog.descriptions.time_entry__read_any",
  "time_entry:update_any":
    "roles:capabilityCatalog.descriptions.time_entry__update_any",
  "time_entry:delete_any":
    "roles:capabilityCatalog.descriptions.time_entry__delete_any",
  "time_entry:log_backdated":
    "roles:capabilityCatalog.descriptions.time_entry__log_backdated",
  "time_entry:manage_rates":
    "roles:capabilityCatalog.descriptions.time_entry__manage_rates",
  "budget:read": "roles:capabilityCatalog.descriptions.budget__read",
  "budget:manage": "roles:capabilityCatalog.descriptions.budget__manage",
  "report:read": "roles:capabilityCatalog.descriptions.report__read",
  "report:read_all": "roles:capabilityCatalog.descriptions.report__read_all",
  "report:export": "roles:capabilityCatalog.descriptions.report__export",
  "kb_article:read": "roles:capabilityCatalog.descriptions.kb_article__read",
  "kb_article:write": "roles:capabilityCatalog.descriptions.kb_article__write",
  "kb_article:publish":
    "roles:capabilityCatalog.descriptions.kb_article__publish",
  "service:read": "roles:capabilityCatalog.descriptions.service__read",
  "service:manage": "roles:capabilityCatalog.descriptions.service__manage",
  "change:manage": "roles:capabilityCatalog.descriptions.change__manage",
  "release:manage": "roles:capabilityCatalog.descriptions.release__manage",
  "member:invite": "roles:capabilityCatalog.descriptions.member__invite",
  "member:remove": "roles:capabilityCatalog.descriptions.member__remove",
  "api_key:manage": "settings:serviceKeys.title",
  "webhook:manage": "roles:capabilityCatalog.descriptions.webhook__manage",
  "automation:manage":
    "roles:capabilityCatalog.descriptions.automation__manage",
};

export const CAPABILITY_GROUP_KEYS: Readonly<Record<string, string>> = {
  Workspace: "common:audit.columns.workspace",
  Projects: "portal:projects.title",
  "Work items": "godModeOrganisations:quotaMaxWorkItems",
  Comments: "navigation:search.groups.comment",
  Attachments: "workItems:create.attachments.heading",
  "Labels & fields": "roles:capabilityCatalog.groups.labels_fields",
  Views: "navigation:keyboardShortcuts.categories.views",
  "Service desk": "roles:capabilityCatalog.groups.service_desk",
  "Time & cost": "roles:capabilityCatalog.groups.time_cost",
  Reports: "navigation:sidebar.reports",
  Knowledge: "roles:capabilityCatalog.groups.knowledge",
  "Service catalogue": "navigation:sidebar.serviceManagement",
  Members: "settings:projectMembers.title",
  Integrations: "roles:capabilityCatalog.groups.integrations",
  Automations: "automations:workspace.title",
};
