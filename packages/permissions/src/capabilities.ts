/**
 * The capability registry.
 *
 * A capability is the atom of authority: `resource:action`.
 *
 * **This file and `docs/01-architecture/rbac.md` are one artefact.** rbac.md is the single
 * authoritative home for capabilities and policy kinds (AGENTS.md do-not 11); this file is
 * that table, rendered as code. `tests/permissions/capabilities-match-rbac.test.ts` parses
 * rbac.md and fails if the two disagree in either direction, so a capability cannot be added
 * here without being added there in the same change.
 *
 * **Adding is additive; renaming or removing is a two-phase change** — capability names are
 * stored as strings in `role.capabilities` and `api_key.capabilities`, so a rename that only
 * touches this file silently drops the capability from every custom role and every issued key.
 * rbac.md states the two stages; both need a decision-log entry.
 */

/** The heading the role editor shows a capability under (RL-1). */
export const CAPABILITY_GROUPS = [
  "Instance",
  "Workspace",
  "Projects",
  "Work items",
  "Comments",
  "Attachments",
  "Labels & fields",
  "Views",
  "Service desk",
  "Time & cost",
  "Reports",
  "Knowledge",
  "Service management",
  "Members",
  "Integrations",
  "Automations",
] as const;

export type CapabilityGroup = (typeof CAPABILITY_GROUPS)[number];

export type CapabilityDefinition = {
  readonly group: CapabilityGroup;
  /**
   * Ticking a capability auto-ticks what it implies (RL-5); implication is transitive.
   * Entries are `ImpliedCapability` values — checked below, once `Capability` exists.
   */
  readonly implies: readonly string[];
  readonly description: string;
};

export const CAPABILITIES = {
  "instance:admin": {
    group: "Instance",
    implies: ["instance:*"],
    description: "Administer the whole deployment (God Mode)",
  },
  "instance:read_audit": {
    group: "Instance",
    implies: [],
    description: "Read the instance audit log",
  },
  "instance:manage_plugins": {
    group: "Instance",
    implies: [],
    description: "Configure, test, enable and disable plugins",
  },
  "instance:manage_jobs": {
    group: "Instance",
    implies: [],
    description: "Change job cadence, enable/disable, trigger manually",
  },
  "instance:manage_terminology": {
    group: "Instance",
    implies: [],
    description: "Edit instance-level terminology overrides",
  },
  "workspace:read": {
    group: "Workspace",
    implies: [],
    description: "See the workspace and its settings",
  },
  "workspace:update": {
    group: "Workspace",
    implies: ["workspace:read"],
    description: "Edit workspace general settings",
  },
  "workspace:delete": {
    group: "Workspace",
    implies: ["workspace:update"],
    description: "Delete the workspace",
  },
  "workspace:manage_members": {
    group: "Workspace",
    implies: ["workspace:read"],
    description: "Add and remove workspace members",
  },
  "workspace:manage_roles": {
    group: "Workspace",
    implies: ["workspace:read"],
    description: "Create and edit roles",
  },
  /**
   * Where this attaches, asked and answered rather than assumed.
   *
   * The six inherited kaneo integration routers were this capability's only consumers **in
   * code**, and #6 deletes all six — but the documented domain model already attaches it to the
   * workspace-settings tier in four places, so it is not orphaned and it is not removed:
   * `settings-hierarchy.md` (`GET/PATCH /api/workspaces/{id}/settings` and `…/features`),
   * `teams.md` (creating, editing and deleting teams and their membership),
   * `automations.md` (rules at workspace scope) and its own description below.
   *
   * It is a **workspace**-tier authority and never an instance one: every God Mode surface is
   * `instance:admin` (`god-mode.md`). Its routes land with P1/P4, which is why no policy names
   * it during P0 — the "every capability is referenced" rule is satisfied by the documented
   * domain rules until then.
   */
  "workspace:manage_settings": {
    group: "Workspace",
    implies: ["workspace:read"],
    description:
      "Types, workflows, SLA policies, calendars, request types, custom fields, labels, estimates, automations, canned responses, workspace terminology",
  },
  "project:create": {
    group: "Projects",
    implies: [],
    description: "Create a project or managed service",
  },
  "project:read": {
    group: "Projects",
    implies: [],
    description: "See a project in reach",
  },
  "project:update": {
    group: "Projects",
    implies: ["project:read"],
    description:
      "Edit project fields, health, milestones, prerequisites, stakeholders, document links — **not** parent_id or owner_team_id",
  },
  "project:manage_members": {
    group: "Projects",
    implies: ["project:read"],
    description:
      "Manage the project roster and per-project roles, and the two reach-affecting fields parent_id and owner_team_id (see [Reach](#reach))",
  },
  "project:manage_settings": {
    group: "Projects",
    implies: ["project:update"],
    description:
      "Project states, features, labels, SLA and calendar assignment, automations",
  },
  "project:archive": {
    group: "Projects",
    implies: ["project:update"],
    description: "Archive and restore",
  },
  "project:delete": {
    group: "Projects",
    implies: ["project:archive"],
    description: "Soft-delete",
  },
  "work_item:read": {
    group: "Work items",
    implies: [],
    description: "See work items in reach",
  },
  "work_item:create": {
    group: "Work items",
    implies: ["work_item:read"],
    description: "Create work items",
  },
  "work_item:update": {
    group: "Work items",
    implies: ["work_item:read"],
    description:
      "Edit title, description, dates, labels, custom fields; archive",
  },
  "work_item:delete": {
    group: "Work items",
    implies: ["work_item:update"],
    description: "Soft-delete",
  },
  "work_item:assign": {
    group: "Work items",
    implies: ["work_item:read"],
    description: "Assign to anyone on the roster",
  },
  "work_item:transition": {
    group: "Work items",
    implies: ["work_item:read"],
    description: "Change state, subject to workflow legality",
  },
  "work_item:rank": {
    group: "Work items",
    implies: ["work_item:read"],
    description: "Re-order within a state or backlog",
  },
  "work_item:set_priority": {
    group: "Work items",
    implies: ["work_item:escalate_priority"],
    description: "Set priority up or down",
  },
  "work_item:escalate_priority": {
    group: "Work items",
    implies: ["work_item:read"],
    description: "Raise priority only — the customer capability",
  },
  "work_item:export": {
    group: "Work items",
    implies: ["work_item:read"],
    description: "Export a view or list to CSV/XLSX",
  },
  "comment:create": {
    group: "Comments",
    implies: ["work_item:read"],
    description: "Comment publicly",
  },
  "comment:create_internal": {
    group: "Comments",
    implies: ["comment:create"],
    description: "Comment internally",
  },
  "comment:update_own": {
    group: "Comments",
    implies: ["comment:create"],
    description: "Edit own comments within the window",
  },
  "comment:delete_own": {
    group: "Comments",
    implies: ["comment:create"],
    description: "Delete own comments",
  },
  "comment:update_any": {
    group: "Comments",
    implies: ["comment:update_own"],
    description: "Edit anyone's comment",
  },
  "comment:delete_any": {
    group: "Comments",
    implies: ["comment:delete_own"],
    description: "Delete anyone's comment",
  },
  "attachment:create": {
    group: "Attachments",
    implies: ["work_item:read"],
    description: "Upload to a work item or comment",
  },
  "attachment:delete_own": {
    group: "Attachments",
    implies: ["attachment:create"],
    description: "Delete own attachments",
  },
  "attachment:delete_any": {
    group: "Attachments",
    implies: ["attachment:delete_own"],
    description: "Delete anyone's attachments",
  },
  "label:manage": {
    group: "Labels & fields",
    implies: [],
    description: "Create, edit, delete labels",
  },
  "custom_field:manage": {
    group: "Labels & fields",
    implies: [],
    description: "Define custom fields and sections",
  },
  "saved_view:read": {
    group: "Views",
    implies: [],
    description: "List and open saved views and queues shared with you",
  },
  "saved_view:create": {
    group: "Views",
    implies: ["saved_view:read", "work_item:read"],
    description: "Create private saved views and queues",
  },
  "saved_view:share": {
    group: "Views",
    implies: ["saved_view:create"],
    description: "Share a view with a team or the workspace",
  },
  "sla_policy:read": {
    group: "Service desk",
    implies: [],
    description: "Read SLA policies and service calendars",
  },
  "sla_policy:manage": {
    group: "Service desk",
    implies: ["sla_policy:read"],
    description: "Author policies and calendars",
  },
  "workflow:read": {
    group: "Service desk",
    implies: [],
    description: "Read workflows",
  },
  "workflow:manage": {
    group: "Service desk",
    implies: ["workflow:read"],
    description: "Create, edit, publish workflows",
  },
  "request_type:read": {
    group: "Service desk",
    implies: [],
    description: "Read request types (triage needs this)",
  },
  "request_type:manage": {
    group: "Service desk",
    implies: ["request_type:read"],
    description: "Author request types and per-organisation catalogues",
  },
  "intake:triage": {
    group: "Service desk",
    implies: ["request_type:read"],
    description:
      "Claim, accept, decline, merge, clarify submissions; manage queues",
  },
  "approval:request": {
    group: "Service desk",
    implies: ["work_item:read"],
    description: "Request a customer approval",
  },
  "approval:request_cab": {
    group: "Service desk",
    implies: ["approval:request"],
    description: "Request a CAB approval (staff only)",
  },
  "approval:decide": {
    group: "Service desk",
    implies: [],
    description: "Decide an approval addressed to you",
  },
  "approval:decide_cab": {
    group: "Service desk",
    implies: ["approval:decide"],
    description: "Decide a CAB approval — **and** be a member of the CAB team",
  },
  "time_entry:create": {
    group: "Time & cost",
    implies: [],
    description: "Log own time; start/stop own timer",
  },
  "time_entry:update_own": {
    group: "Time & cost",
    implies: ["time_entry:create"],
    description: "Edit own entries",
  },
  "time_entry:delete_own": {
    group: "Time & cost",
    implies: ["time_entry:create"],
    description: "Delete own entries",
  },
  "time_entry:read_any": {
    group: "Time & cost",
    implies: [],
    description: "See anyone's entries",
  },
  "time_entry:update_any": {
    group: "Time & cost",
    implies: ["time_entry:read_any", "time_entry:update_own"],
    description: "Edit anyone's entries",
  },
  "time_entry:delete_any": {
    group: "Time & cost",
    implies: ["time_entry:update_any", "time_entry:delete_own"],
    description: "Delete anyone's entries",
  },
  "time_entry:log_backdated": {
    group: "Time & cost",
    implies: ["time_entry:create"],
    description: "Log beyond the workspace backdating limit",
  },
  "time_entry:manage_rates": {
    group: "Time & cost",
    implies: ["time_entry:read_any"],
    description: "Rates, cost types; see cost data",
  },
  "budget:read": {
    group: "Time & cost",
    implies: [],
    description: "See budgets",
  },
  "budget:manage": {
    group: "Time & cost",
    implies: ["budget:read"],
    description: "Create and edit budgets",
  },
  "report:read": {
    group: "Reports",
    implies: [],
    description: "Reports for your reach",
  },
  "report:read_all": {
    group: "Reports",
    implies: ["report:read"],
    description: "Reports across all projects",
  },
  "report:export": {
    group: "Reports",
    implies: ["report:read"],
    description: "Export a report",
  },
  "kb_article:read": {
    group: "Knowledge",
    implies: [],
    description: "Read articles",
  },
  "kb_article:write": {
    group: "Knowledge",
    implies: ["kb_article:read"],
    description: "Draft and edit articles",
  },
  "kb_article:publish": {
    group: "Knowledge",
    implies: ["kb_article:write"],
    description: "Publish, archive, manage categories",
  },
  "service:read": {
    group: "Service management",
    implies: [],
    description: "See services",
  },
  "service:manage": {
    group: "Service management",
    implies: ["service:read"],
    description: "Manage services, dependencies and service state",
  },
  "change:manage": {
    group: "Service management",
    implies: [],
    description: "Change details, freezes, freeze override (elevated)",
  },
  "release:manage": {
    group: "Service management",
    implies: [],
    description: "Releases and checklists",
  },
  "member:invite": {
    group: "Members",
    implies: [],
    description: "Invite people",
  },
  "member:remove": {
    group: "Members",
    implies: [],
    description: "Remove people",
  },
  "api_key:manage": {
    group: "Integrations",
    implies: [],
    description: "Workspace service keys",
  },
  "webhook:manage": {
    group: "Integrations",
    implies: [],
    description: "Webhooks, secret rotation, redelivery",
  },
  "automation:manage": {
    group: "Automations",
    implies: [],
    description:
      "Rules at project scope (workspace scope also needs workspace:manage_settings)",
  },
} as const satisfies Record<string, CapabilityDefinition>;

/** Every capability name, as a union. The only legal capability strings in the codebase. */
export type Capability = keyof typeof CAPABILITIES;

export const CAPABILITY_NAMES = Object.keys(CAPABILITIES) as Capability[];

/**
 * A capability another capability implies. `"instance:*"` is the one wildcard, held by
 * `instance:admin` alone; it expands to every capability in the `Instance` group.
 */
export type ImpliedCapability = Capability | "instance:*";

/** Compile-time proof that every `implies` entry names something real. */
type AssertNever<T extends never> = T;
type UnknownImplication = Exclude<
  (typeof CAPABILITIES)[Capability]["implies"][number],
  ImpliedCapability
>;
export type NoUnknownImplication = AssertNever<UnknownImplication>;

/**
 * True when `value` is a capability this build knows about.
 *
 * An unrecognised capability string encountered at evaluation is **logged and treated as
 * absent** — never expanded by a wildcard implication (rbac.md, § Capabilities).
 */
export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITIES, value);
}

/** The capabilities in one group, in declaration order. */
export function capabilitiesInGroup(group: CapabilityGroup): Capability[] {
  return CAPABILITY_NAMES.filter((name) => CAPABILITIES[name].group === group);
}
