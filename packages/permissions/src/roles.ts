/**
 * The built-in roles.
 *
 * Roles are **rows in the database** (`role`), created and edited by administrators in the
 * UI. These are the rows seeded on workspace creation. The table in
 * `docs/01-architecture/rbac.md` § "Built-in roles and their capabilities" **is** this data
 * and the permission-matrix fixture; a change there is a change here, and
 * `tests/permissions/roles-match-rbac.test.ts` fails if the two disagree.
 *
 * The four kaneo role names — `viewer`, `member`, `admin`, `owner` — are kept for data
 * continuity: existing `workspace_role` rows keep working. `manager`, `lead` and `customer`
 * are TaskDesk's additions, and `instance_admin` is the one instance-scope system role.
 *
 * Capability lists here are **declared**, not expanded: they are stored verbatim in
 * `role.capabilities`. Implications are expanded at evaluation time by `expandCapabilities`,
 * so a role row stored without an implied entry still behaves correctly.
 */

import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  type Capability,
} from "./capabilities";

/** The scope a role may be attached at. `organisation` exists for exactly one system role: `customer`. */
export const ROLE_SCOPES = [
  "instance",
  "organisation",
  "workspace",
  "project",
] as const;

export type RoleScope = (typeof ROLE_SCOPES)[number];

export type RoleDefinition = {
  /** Server-generated kebab slug, unique per `(scope, workspace_id)`, immutable. */
  readonly key: string;
  readonly scope: RoleScope;
  /** Higher wins. You cannot edit or mint a role whose rank is >= your own highest rank. */
  readonly rank: number;
  readonly intent: string;
  /** System roles cannot be deleted; some may still be edited. */
  readonly isEditable: boolean;
  readonly capabilities: readonly Capability[];
};

/** Every capability whose name starts with `prefix` — the `all \`work_item:*\`` shorthand in rbac.md. */
function withPrefix(prefix: string): Capability[] {
  return CAPABILITY_NAMES.filter((name) => name.startsWith(prefix));
}

/** Every capability that is not an `instance:*` capability. */
const EVERY_CAPABILITY_EXCEPT_INSTANCE: Capability[] = CAPABILITY_NAMES.filter(
  (name) => CAPABILITIES[name].group !== "Instance",
);

const OWNER_CAPABILITIES = EVERY_CAPABILITY_EXCEPT_INSTANCE;

const ADMIN_CAPABILITIES = OWNER_CAPABILITIES.filter(
  (name) => name !== "workspace:delete",
);

const MANAGER_CAPABILITIES: Capability[] = [
  "workspace:read",
  "workspace:manage_settings",
  "workspace:manage_members",
  "project:create",
  "project:read",
  "project:update",
  "project:manage_members",
  "project:manage_settings",
  "project:archive",
  ...withPrefix("work_item:"),
  ...withPrefix("comment:"),
  ...withPrefix("attachment:"),
  "label:manage",
  "custom_field:manage",
  "saved_view:create",
  "saved_view:share",
  "sla_policy:manage",
  "workflow:manage",
  "request_type:manage",
  "intake:triage",
  "approval:request_cab",
  "approval:decide",
  ...withPrefix("time_entry:"),
  "budget:manage",
  "report:read_all",
  "report:export",
  "kb_article:publish",
  "service:manage",
  "change:manage",
  "release:manage",
  "member:invite",
  "member:remove",
  "webhook:manage",
  "automation:manage",
];

const LEAD_CAPABILITIES: Capability[] = [
  "workspace:read",
  "project:read",
  "project:update",
  "project:manage_members",
  "work_item:create",
  "work_item:update",
  "work_item:delete",
  "work_item:assign",
  "work_item:transition",
  "work_item:rank",
  "work_item:set_priority",
  "work_item:export",
  "comment:create_internal",
  "comment:update_own",
  "comment:delete_own",
  "attachment:create",
  "attachment:delete_own",
  "label:manage",
  "saved_view:share",
  "sla_policy:read",
  "workflow:read",
  "request_type:read",
  "intake:triage",
  "approval:request",
  "approval:decide",
  "time_entry:create",
  "time_entry:update_own",
  "time_entry:delete_own",
  "time_entry:read_any",
  "time_entry:log_backdated",
  "budget:read",
  "report:read",
  "report:export",
  "kb_article:write",
  "service:read",
  "member:invite",
  "automation:manage",
];

const MEMBER_CAPABILITIES: Capability[] = [
  "workspace:read",
  "project:read",
  "work_item:create",
  "work_item:update",
  "work_item:transition",
  "work_item:rank",
  "work_item:set_priority",
  "comment:create_internal",
  "comment:update_own",
  "comment:delete_own",
  "attachment:create",
  "attachment:delete_own",
  "saved_view:create",
  "sla_policy:read",
  "workflow:read",
  "request_type:read",
  "approval:request",
  "approval:decide",
  "time_entry:create",
  "time_entry:update_own",
  "time_entry:delete_own",
  "budget:read",
  "report:read",
  "kb_article:write",
  "service:read",
];

const VIEWER_CAPABILITIES: Capability[] = [
  "workspace:read",
  "project:read",
  "work_item:read",
  "saved_view:read",
  "sla_policy:read",
  "workflow:read",
  "request_type:read",
  "report:read",
  "kb_article:read",
  "service:read",
];

/**
 * Portal only, off the ladder. "…and nothing else, ever."
 *
 * The customer role's real constraints are **behavioural**, live in `packages/domain`, and
 * are enforced regardless of capabilities — an administrator cannot grant them away through
 * the role editor (rbac.md § "The customer role is special").
 */
const CUSTOMER_CAPABILITIES: Capability[] = [
  "work_item:read",
  "comment:create",
  "attachment:create",
  "work_item:rank",
  "work_item:escalate_priority",
  "approval:decide",
  "kb_article:read",
];

export const BUILT_IN_ROLES = {
  instance_admin: {
    key: "instance_admin",
    scope: "instance",
    rank: 1000,
    intent: "The one instance-scope system role",
    isEditable: false,
    capabilities: withPrefix("instance:"),
  },
  owner: {
    key: "owner",
    scope: "workspace",
    rank: 100,
    intent: "Everything, including deleting the workspace. Not editable",
    isEditable: false,
    capabilities: OWNER_CAPABILITIES,
  },
  admin: {
    key: "admin",
    scope: "workspace",
    rank: 80,
    intent: "Everything except deleting the workspace",
    isEditable: true,
    capabilities: ADMIN_CAPABILITIES,
  },
  manager: {
    key: "manager",
    scope: "workspace",
    rank: 60,
    intent: "Runs delivery: projects, members, policies, workflows",
    isEditable: true,
    capabilities: MANAGER_CAPABILITIES,
  },
  lead: {
    key: "lead",
    scope: "workspace",
    rank: 50,
    intent: "Assigns work, triages intake, decides approvals within reach",
    isEditable: true,
    capabilities: LEAD_CAPABILITIES,
  },
  member: {
    key: "member",
    scope: "workspace",
    rank: 40,
    intent: "Creates and updates work items, comments internally, self-assigns",
    isEditable: true,
    capabilities: MEMBER_CAPABILITIES,
  },
  viewer: {
    key: "viewer",
    scope: "workspace",
    rank: 20,
    intent: "Read-only",
    isEditable: true,
    capabilities: VIEWER_CAPABILITIES,
  },
  customer: {
    key: "customer",
    scope: "organisation",
    rank: 10,
    intent: "Portal only. Off the ladder",
    isEditable: false,
    capabilities: CUSTOMER_CAPABILITIES,
  },
} as const satisfies Record<string, RoleDefinition>;

export type BuiltInRoleKey = keyof typeof BUILT_IN_ROLES;

export const BUILT_IN_ROLE_KEYS = Object.keys(
  BUILT_IN_ROLES,
) as BuiltInRoleKey[];

/**
 * The role names kaneo seeded, kept so existing `workspace_role` rows keep resolving.
 * `owner` was a static better-auth role upstream; here it is a row like the others.
 */
export const INHERITED_ROLE_KEYS = [
  "viewer",
  "member",
  "admin",
  "owner",
] as const satisfies readonly BuiltInRoleKey[];
