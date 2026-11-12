/** Pure clean-install plan. IDs are shared with the retained UAT fixture. */
export const G1_SERVICE_STATES = [
  { key: "new", name: "New", group: "backlog" },
  { key: "open", name: "Open", group: "started" },
  { key: "waiting-on-customer", name: "Waiting on customer", group: "started" },
  { key: "on-hold", name: "On hold", group: "started" },
  { key: "resolved", name: "Resolved", group: "completed" },
  { key: "closed", name: "Closed", group: "completed" },
] as const;
export const G1_PROJECT_IDS = [
  "uat-proj-support",
  "uat-proj-itops",
  "uat-proj-web",
  "uat-proj-contoso-managed",
] as const;
export const G1_STAFF_PROJECTS: Record<string, string[]> = {
  lead: ["uat-proj-support", "uat-proj-itops", "uat-proj-web"],
  agent1: ["uat-proj-support", "uat-proj-web"], // IT Operations comes through the owning team.
  agent2: [...G1_PROJECT_IDS],
  viewer: ["uat-proj-web"],
};
export function g1StaffProjects(key: string): string[] {
  return G1_STAFF_PROJECTS[key] ?? [];
}
export const G1_PROJECT_MANAGERS = G1_PROJECT_IDS.map((projectId) => ({
  projectId,
  personId: "uat-person-manager",
}));
export const G1_PENDING_CUSTOMER = {
  email: "pending@contoso.uat.taskdesk.test",
  projectIds: ["uat-proj-support", "uat-proj-contoso-managed"],
};
export const G1_AUTOMATIONS = [
  {
    name: "A customer reply reopens a resolved item",
    requires: "customer comment author condition",
    definition: {
      trigger: "work_item.commented",
      conditions: [
        { field: "state", op: "eq", value: "resolved" },
        { field: "comment_visibility", op: "eq", value: "public" },
        { field: "actor_role", op: "eq", value: "customer" },
      ],
      actions: [
        { type: "transition", toStateTemplateId: "uat-service-template-open" },
      ],
    },
  },
  {
    name: "Resolved items close after 3 days",
    requires:
      "time-based automation trigger and resolved timestamp age condition",
    definition: {
      trigger: "schedule",
      scheduleCron: "0 * * * *",
      conditions: [
        { field: "state", op: "eq", value: "resolved" },
        { field: "age", op: "gte", value: 4320, basis: "resolved_at" },
      ],
      actions: [
        {
          type: "transition",
          toStateTemplateId: "uat-service-template-closed",
        },
      ],
    },
  },
] as const;

const STAFF_DOMAIN = "uat.taskdesk.test";
export const G1_ACCOUNTS = [
  {
    key: "owner",
    email: `owner@${STAFF_DOMAIN}`,
    name: "Olivia Owens",
    roleLabel: "Workspace owner",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "owner",
    projectRole: null,
  },
  {
    key: "admin",
    email: `admin@${STAFF_DOMAIN}`,
    name: "Arjun Patel",
    roleLabel: "Workspace admin",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "admin",
    projectRole: null,
  },
  {
    key: "lead",
    email: `lead@${STAFF_DOMAIN}`,
    name: "Laura Chen",
    roleLabel: "Project lead and change approver",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "lead",
    projectRole: "cab",
  },
  {
    key: "agent1",
    email: `agent1@${STAFF_DOMAIN}`,
    name: "Marcus Reid",
    roleLabel: "Service desk agent (member)",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "member",
    projectRole: "agent",
  },
  {
    key: "agent2",
    email: `agent2@${STAFF_DOMAIN}`,
    name: "Sofia Alvarez",
    roleLabel: "Service desk agent (member)",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "member",
    projectRole: "agent",
  },
  {
    key: "viewer",
    email: `viewer@${STAFF_DOMAIN}`,
    name: "Victor Nguyen",
    roleLabel: "Read-only viewer",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "viewer",
    projectRole: "viewer",
  },
  {
    key: "contoso1",
    email: `emma.clarke@contoso.${STAFF_DOMAIN}`,
    name: "Emma Clarke",
    roleLabel: "Customer, Contoso Ltd",
    userRole: "user",
    side: "customer",
    org: "contoso",
    workspaceRole: null,
    projectRole: null,
  },
  {
    key: "contoso2",
    email: `james.wright@contoso.${STAFF_DOMAIN}`,
    name: "James Wright",
    roleLabel: "Customer, Contoso Ltd",
    userRole: "user",
    side: "customer",
    org: "contoso",
    workspaceRole: null,
    projectRole: null,
  },
  {
    key: "fabrikam1",
    email: `nina.berg@fabrikam.${STAFF_DOMAIN}`,
    name: "Nina Berg",
    roleLabel: "Customer, Fabrikam Inc",
    userRole: "user",
    side: "customer",
    org: "fabrikam",
    workspaceRole: null,
    projectRole: null,
  },
  {
    key: "manager",
    email: `manager@${STAFF_DOMAIN}`,
    name: "Maya Brooks",
    roleLabel: "Workspace manager",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "manager",
    projectRole: null,
  },
  {
    key: "contoso3",
    email: `alex.morgan@contoso.${STAFF_DOMAIN}`,
    name: "Alex Morgan",
    roleLabel: "Customer, both Contoso engagements",
    userRole: "user",
    side: "customer",
    org: "contoso",
    workspaceRole: null,
    projectRole: null,
  },
] as const;
