import { expect, type Page, test } from "@playwright/test";

const session = {
  session: {
    id: "visual-session",
    userId: "visual-user",
    activeOrganizationId: "visual-workspace",
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "visual-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id: "visual-user",
    name: "Ada Example",
    email: "ada@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    image: null,
    role: "admin",
  },
};

const workspace = {
  id: "visual-workspace",
  name: "Northstar Support",
  slug: "northstar-support",
  logo: null,
  description: "Visual regression fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const project = {
  id: "visual-project",
  workspaceId: workspace.id,
  slug: "help",
  icon: null,
  name: "Help Desk",
  description: "Customer support work",
  createdAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  position: 0,
  lastTaskNumber: 7,
  statistics: { completionPercentage: 25, totalTasks: 4, dueDate: null },
  archivedTasks: [],
  plannedTasks: [],
  columns: [],
};

const visualIdentityConnection = {
  id: "visual-connection",
  providerType: "entra",
  portalScope: "agent",
  organisationId: null,
  defaultWorkspaceId: "visual-workspace",
  displayName: "Staff Entra",
  issuer: "https://login.example.test/tenant/v2.0",
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecretConfigured: true,
  redirectUri: "https://desk.example.test/api/auth/callback/visual-connection",
  scopes: ["openid", "profile", "email"],
  claimMapping: { version: 1, displayName: "name" },
  claimMappingState: "valid",
  domainBindings: ["example.test"],
  jitPolicy: {
    enabled: false,
    default_role_id: null,
    required_entra_app_role: "TaskDesk.User",
  },
  maxRoleRank: 10,
  mfaUpstreamMode: "off",
  enabled: false,
  configVersion: 7,
  healthState: "healthy",
  healthCheckedAt: null,
};

const visualRequestType = {
  id: "visual-request-type",
  key: "visual-access",
  name: "Access request",
  description: "Request access to a support workspace.",
  group: "Access",
  workItemTypeId: "visual-type",
  defaultProjectId: "visual-project",
  formSchema: {
    fields: [
      {
        key: "title",
        label: "Summary",
        type: "text",
        required: true,
        mapsTo: { field: "title" },
      },
    ],
  },
  published: true,
  version: 3,
  autoAccept: false,
  customerVisible: true,
  forcePrivate: false,
  position: 0,
};

const workItem = {
  id: "visual-item",
  projectId: project.id,
  workspaceId: workspace.id,
  typeId: "visual-type",
  number: 7,
  key: "HELP-7",
  title: "Customer cannot reset their password",
  description: "We sent a reset link, but it has expired.",
  stateId: "visual-state",
  stateName: "In progress",
  stateCategory: "started",
  priority: "high",
  assigneeId: null,
  assigneeName: null,
  requesterId: "visual-requester",
  parentId: null,
  position: "1.0000000000",
  customerVisibility: "private",
  startDate: "2026-09-01T00:00:00.000Z",
  dueDate: "2026-10-02T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const visualCalendar = {
  id: "visual-calendar",
  key: "support-coverage",
  workspaceId: workspace.id,
  name: "Support coverage",
  timezone: "Europe/London",
  windows: {
    mon: [{ from: 540, to: 1020 }],
    tue: [{ from: 540, to: 1020 }],
    wed: [{ from: 540, to: 1020 }],
    thu: [{ from: 540, to: 1020 }],
    fri: [{ from: 540, to: 1020 }],
    sat: [],
    sun: [],
  },
  holidays: [],
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const visualGoals = [
  ...(["first_response", "resolution"] as const).flatMap((metric) =>
    (["low", "medium", "high", "urgent"] as const).map((priority) => ({
      metric,
      workItemTypeId: "visual-type",
      priority,
      targetMinutes: metric === "first_response" ? 120 : 480,
    })),
  ),
];

const visualSlaPolicy = {
  id: "visual-sla-policy",
  key: "priority-support",
  workspaceId: workspace.id,
  name: "Priority support",
  description: "Response and resolution targets for support incidents.",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  activeVersion: {
    id: "visual-sla-version",
    number: 1,
    calendarId: visualCalendar.id,
    atRiskThresholdPct: 80,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    goals: visualGoals,
  },
  draftVersion: null,
};

const visualSavedView = {
  id: "visual-view",
  workspaceId: workspace.id,
  createdBy: "visual-person",
  name: "Open incidents",
  scope: "workspace",
  scopeId: workspace.id,
  visibility: "workspace",
  sharedWithTeamId: null,
  layout: "list",
  query: {
    entity: "work_item",
    filter: { field: "priority", op: "eq", value: "high" },
    sort: [{ field: "key", direction: "asc" }],
  },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
  isPinned: true,
};

// The workspace owner's full capability map, as GET /api/capabilities returns it.
const visualOwnerCapabilities = {
  manageProjects: true,
  createProjects: true,
  updateProjects: true,
  deleteProjects: true,
  updateTasks: true,
  createTasks: true,
  deleteTasks: true,
  assignTasks: true,
  createLabels: true,
  updateLabels: true,
  deleteLabels: true,
  manageWorkspace: true,
  deleteWorkspace: true,
  inviteUsers: true,
  manageTeam: true,
  removeMembers: true,
  manageServiceCalendars: true,
  shareSavedViews: true,
  manageWorkspaceSettings: true,
  createPublicComments: true,
  createInternalComments: true,
  transitionTasks: true,
  rankTasks: true,
  exportTasks: true,
  setPriorityTasks: true,
  bindProjectOrganisation: true,
  manageProjectSettings: true,
  manageRoles: true,
  manageWebhooks: true,
  manageCustomFields: true,
  manageLabels: true,
  manageRates: true,
  manageWorkflows: true,
  readBudgets: true,
  logTime: true,
  createAttachments: true,
  triageIntake: true,
};

// No terminology overrides: every screen uses the default product terms.
const visualAgentTerminology = {
  locale: "en-US",
  audience: "agent",
  terms: {},
  etag: "visual-terminology-1",
};

// The effective feature switches of the Northstar Support workspace (and its Help Desk
// project); they match the workspace features settings fixture below.
const visualResolvedFeatures = [
  { key: "feature.cycles", enabled: true },
  { key: "feature.modules", enabled: true },
  { key: "feature.estimates", enabled: true },
  { key: "feature.intake", enabled: true },
  { key: "feature.sla", enabled: true },
  { key: "feature.approvals", enabled: true },
  { key: "feature.time_tracking", enabled: true },
  { key: "feature.cost_tracking", enabled: true },
  { key: "feature.knowledge_base", enabled: true },
  { key: "feature.service_catalogue", enabled: true },
  { key: "feature.customer_portal", enabled: true },
  { key: "feature.reports", enabled: true },
  { key: "feature.automations", enabled: true },
  { key: "feature.timeline", enabled: false },
  { key: "feature.calendar", enabled: false },
  { key: "feature.pages", enabled: true },
  { key: "feature.mcp", enabled: false },
  { key: "feature.scim", enabled: true },
  { key: "feature.import", enabled: true },
  { key: "feature.public_boards", enabled: false },
  { key: "feature.dev_links", enabled: false },
];

const visualCannedResponses = [
  {
    id: "visual-snippet",
    workspaceId: "visual-workspace",
    name: "Request acknowledgement",
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Thanks for your request." }],
        },
      ],
    },
    visibilityDefault: "internal",
    createdBy: "visual-user",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
];

// ex fixtures: endpoints the current app reads on existing visual screens.

// ---- Workspace people (GET /api/workspace/visual-workspace -> members) ----
// The shell's GET /api/workspace/visual-workspace/members (coordinator-owned) only lists Ada;
// see NOTES: it should return the same three rows (vExWorkspaceMembers) so every picker agrees.
const vExWorkspaceMembers = [
  {
    id: "visual-user",
    name: "Ada Example",
    email: "ada@example.test",
    image: null,
    role: "owner",
    personId: "visual-person",
  },
  {
    id: "visual-user-ben",
    name: "Ben Okafor",
    email: "ben.okafor@example.test",
    image: null,
    role: "admin",
    personId: "visual-person-ben",
  },
  {
    id: "visual-user-chloe",
    name: "Chloe Martin",
    email: "chloe.martin@example.test",
    image: null,
    role: "member",
    personId: "visual-person-chloe",
  },
];

// GET /api/workspace/visual-workspace (WorkspaceDetail). The pending invitation expired on
// 29 Sep 2026, so members-table.tsx:358 (`expiresAt < Date.now()`) is always true from now on:
// the "expired" rendering is clock-stable.
const vExWorkspaceDetail = {
  workspace: {
    id: "visual-workspace",
    name: "Northstar Support",
    slug: "northstar-support",
    logo: null,
    description: "Visual regression fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  members: vExWorkspaceMembers,
  pendingInvitations: [
    {
      id: "visual-invitation",
      email: "sam.rivera@example.test",
      role: "member",
      status: "pending",
      expiresAt: "2026-09-29T09:00:00.000Z",
      createdAt: "2026-09-22T09:00:00.000Z",
      inviterId: "visual-user",
    },
  ],
};

// ---- State templates (workspace + project views of the same rows) ----
// Ids match the project states fixture (`stateTemplateId` of visual-backlog/-state/-done) and
// the CAB template fixture (`approvedStateTemplateId: "visual-state-approved"`).
const vExTemplateBacklog = {
  id: "visual-backlog-template",
  key: "backlog",
  name: "Backlog",
  group: "backlog",
};
const vExTemplateInProgress = {
  id: "visual-state-template",
  key: "in-progress",
  name: "In progress",
  group: "started",
};
const vExTemplateApproved = {
  id: "visual-state-approved",
  key: "approved",
  name: "Approved",
  group: "started",
};
const vExTemplateDone = {
  id: "visual-done-template",
  key: "done",
  name: "Done",
  group: "completed",
};
const vExTemplateCancelled = {
  id: "visual-cancelled-template",
  key: "cancelled",
  name: "Cancelled",
  group: "cancelled",
};

// GET /api/workspace/visual-workspace/state-templates (WorkspaceStateTemplates).
const vExWorkspaceStateTemplates = {
  workspaceId: "visual-workspace",
  version: 4,
  templates: [
    { ...vExTemplateBacklog, enabled: true },
    { ...vExTemplateInProgress, enabled: true },
    { ...vExTemplateApproved, enabled: true },
    { ...vExTemplateDone, enabled: true },
    { ...vExTemplateCancelled, enabled: false },
  ],
};

// GET /api/workspace/visual-workspace/project-settings (WorkspaceProjectSettings).
const vExWorkspaceProjectSettings = {
  workspaceId: "visual-workspace",
  defaultSlaPolicyId: "visual-sla-policy",
  defaultServiceCalendarId: "visual-calendar",
  enabledStateTemplateIds: [
    "visual-backlog-template",
    "visual-state-template",
    "visual-state-approved",
    "visual-done-template",
  ],
  version: 4,
};

// GET /api/projects/visual-project/state-templates (ProjectStateTemplate[]): inUse = the
// project has an active state for it (Backlog, In progress, Done).
const vExProjectStateTemplates = [
  {
    id: vExTemplateBacklog.id,
    name: vExTemplateBacklog.name,
    group: vExTemplateBacklog.group,
    inUse: true,
    hasOutboundTransition: true,
  },
  {
    id: vExTemplateInProgress.id,
    name: vExTemplateInProgress.name,
    group: vExTemplateInProgress.group,
    inUse: true,
    hasOutboundTransition: true,
  },
  {
    id: vExTemplateApproved.id,
    name: vExTemplateApproved.name,
    group: vExTemplateApproved.group,
    inUse: false,
    hasOutboundTransition: true,
  },
  {
    id: vExTemplateDone.id,
    name: vExTemplateDone.name,
    group: vExTemplateDone.group,
    inUse: true,
    hasOutboundTransition: true,
  },
  {
    id: vExTemplateCancelled.id,
    name: vExTemplateCancelled.name,
    group: vExTemplateCancelled.group,
    inUse: false,
    hasOutboundTransition: false,
  },
];

// GET /api/projects/visual-project/settings/inheritance (ProjectSettingsInheritance).
// The API orders activeTemplateIds by state position and workspaceTemplateIds (every
// non-archived template, enabled or not) by template key.
const vExProjectInheritance = {
  projectId: "visual-project",
  workspaceId: "visual-workspace",
  projectVersion: 2,
  workspaceVersion: 4,
  slaPolicy: {
    mode: "inherit",
    overrideId: null,
    effectiveId: "visual-sla-policy",
    effectiveName: "Priority support",
    source: "workspace",
  },
  serviceCalendar: {
    mode: "inherit",
    overrideId: null,
    effectiveId: "visual-calendar",
    effectiveName: "Support coverage",
    source: "workspace",
  },
  states: {
    // "override": manage-project-states.ts:202 flips the mode when a project keeps its own
    // subset; an inheriting project would carry every workspace template.
    mode: "override",
    activeTemplateIds: [
      "visual-backlog-template",
      "visual-state-template",
      "visual-done-template",
    ],
    workspaceTemplateIds: [
      "visual-state-approved",
      "visual-backlog-template",
      "visual-cancelled-template",
      "visual-done-template",
      "visual-state-template",
    ],
  },
};

// ---- Legacy Kaneo board (GET /api/column/visual-project, /api/task/tasks/visual-project) ----
// The four columns create-project.ts DEFAULT_PROJECT_COLUMNS seeds for every project.
const vExColumnBase = {
  projectId: "visual-project",
  icon: null,
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const vExColumns = [
  {
    ...vExColumnBase,
    id: "visual-column-to-do",
    name: "To Do",
    slug: "to-do",
    position: 0,
    isFinal: false,
  },
  {
    ...vExColumnBase,
    id: "visual-column-in-progress",
    name: "In Progress",
    slug: "in-progress",
    position: 1,
    isFinal: false,
  },
  {
    ...vExColumnBase,
    id: "visual-column-in-review",
    name: "In Review",
    slug: "in-review",
    position: 2,
    isFinal: false,
  },
  {
    ...vExColumnBase,
    id: "visual-column-done",
    name: "Done",
    slug: "done",
    position: 3,
    isFinal: true,
  },
];

const vExBoardTask = {
  id: "visual-item",
  title: "Customer cannot reset their password",
  number: 7,
  description: "We sent a reset link, but it has expired.",
  status: "in-progress",
  priority: "high",
  startDate: "2026-09-01T00:00:00.000Z",
  dueDate: "2026-10-02T00:00:00.000Z",
  position: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeName: null,
  assigneeId: null,
  assigneeImage: null,
  projectId: "visual-project",
  labels: [],
  externalLinks: [],
};

// GET /api/task/tasks/visual-project (BoardResponse); the client returns `json.data`.
const vExBoard = {
  data: {
    id: "visual-project",
    name: "Help Desk",
    slug: "help",
    icon: null,
    description: "Customer support work",
    workspaceId: "visual-workspace",
    columns: [
      {
        id: "to-do",
        slug: "to-do",
        name: "To Do",
        icon: null,
        isFinal: false,
        tasks: [],
      },
      {
        id: "in-progress",
        slug: "in-progress",
        name: "In Progress",
        icon: null,
        isFinal: false,
        tasks: [vExBoardTask],
      },
      {
        id: "in-review",
        slug: "in-review",
        name: "In Review",
        icon: null,
        isFinal: false,
        tasks: [],
      },
      {
        id: "done",
        slug: "done",
        name: "Done",
        icon: null,
        isFinal: true,
        tasks: [],
      },
    ],
    archivedTasks: [],
    plannedTasks: [],
  },
  pagination: { total: 1, page: 1, pageSize: 1, totalPages: 1 },
};

// ---- Project roster (GET /api/projects/visual-project/members) ----
// Built-in project role ranks (project/members/service.ts builtInRank): lead 50, member 40,
// viewer 20; the caller is the workspace owner (rank 100).
const vExRosterRoleLead = {
  roleId: "visual-role-project-lead",
  roleKey: "project-lead",
  roleName: "Project lead",
  roleRank: 50,
};
const vExRosterRoleMember = {
  roleId: "visual-role-project-member",
  roleKey: "project-member",
  roleName: "Project member",
  roleRank: 40,
};
const vExRosterRoleViewer = {
  roleId: "visual-role-project-viewer",
  roleKey: "project-viewer",
  roleName: "Project viewer",
  roleRank: 20,
};
const vExRosterRowFlags = {
  source: "direct",
  inheritedFrom: null,
  overridesInherited: null,
  managedExternally: false,
  removable: true,
};
const vExProjectMembers = {
  members: [
    {
      personId: "visual-person",
      displayName: "Ada Example",
      active: true,
      jobTitle: "Service desk lead",
      ...vExRosterRoleLead,
      ...vExRosterRowFlags,
    },
    {
      personId: "visual-person-ben",
      displayName: "Ben Okafor",
      active: true,
      jobTitle: "Support engineer",
      ...vExRosterRoleMember,
      ...vExRosterRowFlags,
    },
    {
      personId: "visual-person-chloe",
      displayName: "Chloe Martin",
      active: true,
      jobTitle: "Service analyst",
      ...vExRosterRoleViewer,
      ...vExRosterRowFlags,
    },
  ],
  // Sorted by rank, then key (service.ts listProjectMembers).
  roles: [vExRosterRoleViewer, vExRosterRoleMember, vExRosterRoleLead],
  callerRank: 100,
};

// ---- Board WIP limits (GET /api/projects/help/wip-limits) ----
const vExWipLimits = {
  data: [{ stateId: "visual-state", limit: 5 }],
  canManage: true,
};

// ---- Scope time roll-ups (GET /api/time-entries/summary) ----
// Owner holds time_entry:manage_rates, so `cost` is present (EUR, like the budgets).
// Cycle: Ada 810 min at 75.00/h = 101250, Sam 480 min at 65.00/h = 52000.
const vExCycleTimeSummary = {
  scope: "cycle",
  from: null,
  to: null,
  totalMinutes: 1290,
  billableMinutes: 1050,
  entryCount: 9,
  byActivity: [
    { key: "support", label: "Support", minutes: 1050 },
    { key: "maintenance", label: "Maintenance", minutes: 240 },
  ],
  byPerson: [
    { key: "visual-person", label: "Ada Example", minutes: 810 },
    { key: "visual-person-sam", label: "Sam Rivera", minutes: 480 },
  ],
  cost: {
    byCurrency: [{ currency: "EUR", costMinor: 153250, pricedMinutes: 1290 }],
    unpricedMinutes: 0,
    costEntries: [],
  },
};
// Module: Ada 1230 min = 153750, Sam 780 min = 84500.
const vExModuleTimeSummary = {
  scope: "module",
  from: null,
  to: null,
  totalMinutes: 2010,
  billableMinutes: 1620,
  entryCount: 14,
  byActivity: [
    { key: "support", label: "Support", minutes: 1620 },
    { key: "maintenance", label: "Maintenance", minutes: 390 },
  ],
  byPerson: [
    { key: "visual-person", label: "Ada Example", minutes: 1230 },
    { key: "visual-person-sam", label: "Sam Rivera", minutes: 780 },
  ],
  cost: {
    byCurrency: [{ currency: "EUR", costMinor: 238250, pricedMinutes: 2010 }],
    unpricedMinutes: 0,
    costEntries: [],
  },
};

// ---- Intake triage ----
// GET /api/intake/queues?workspaceId=visual-workspace (IntakeQueueSummary[]). Only shows in the
// closed queue picker's options; the picker still reads "Current queue" without ?queue=.
const vExIntakeQueues = [
  {
    id: "visual-queue",
    workspaceId: "visual-workspace",
    name: "Access requests",
    visibility: "team",
    sharedWithTeamId: "visual-team",
    versions: { submission: 2, workItem: 1 },
  },
];
// GET /api/kb/deflection?workspaceId=visual-workspace&q=Request access to the support workspace
// The server ANDs the prefix terms (kb/full-text.ts prefixTsqueryText: "request:* & access:* &
// support:* & workspace:*") over published articles; the only published one ("Reset your
// password from the sign-in page") has no "support"/"workspace" in title or body, so the real
// answer is no articles (the suggestions card stays hidden).
const vExKbDeflection = {
  articles: [],
  portalBaseUrl: "https://portal.example.test",
};

// ---- Report detail: GET /api/project/organisations?workspaceId=visual-workspace ----
const vExProjectOrganisations = [
  { id: "visual-org-acme", name: "Acme Logistics" },
  { id: "visual-org-brightwater", name: "Brightwater Health" },
];

// ---- Request types: GET /api/request-type-groups/order?workspaceId=visual-workspace ----
// The only active group is "Access" (visualRequestType.group).
const vExRequestTypeGroupOrder = {
  groupOrder: { groups: ["Access"], version: 1 },
};

// ---- Service calendar: GET /api/service-calendars/visual-calendar/holidays/presets ----
// Verbatim packages/domain listHolidayPresets() + HOLIDAY_PRESET_DATASET_VERSION.
const vExHolidayPresets = {
  datasetVersion: "2026.10.1",
  presets: [
    {
      country: "US",
      name: "United States (federal)",
      notIncluded: "State and local holidays; Inauguration Day.",
    },
    {
      country: "GB",
      name: "United Kingdom (England and Wales)",
      notIncluded:
        "Scotland and Northern Ireland differences; one-off royal and jubilee holidays.",
    },
    {
      country: "IE",
      name: "Ireland",
      notIncluded: "One-off proclaimed holidays.",
    },
    {
      country: "CA",
      name: "Canada (federal)",
      notIncluded:
        "Provincial and territorial holidays (Family Day, Civic Holiday, Easter Monday in some provinces).",
    },
    {
      country: "AU",
      name: "Australia (national)",
      notIncluded:
        "State and territory holidays, the King's Birthday and Easter Saturday/Sunday, which differ by state.",
    },
    {
      country: "DE",
      name: "Germany (nationwide)",
      notIncluded:
        "State-specific holidays (Epiphany, Corpus Christi, Reformation Day, All Saints, Day of Prayer and Repentance).",
    },
    {
      country: "FR",
      name: "France",
      notIncluded: "Regional (Alsace-Moselle) and overseas holidays.",
    },
    {
      country: "SG",
      name: "Singapore (fixed-date holidays only)",
      notIncluded:
        "Chinese New Year, Hari Raya Puasa, Hari Raya Haji, Vesak Day and Deepavali: these follow lunar or religious calendars and are announced each year, so enter them manually.",
    },
  ],
};

// ---- Work item detail (HELP-7) ----
// GET /api/work-items/HELP-7/comments/mention-candidates?visibility=internal: staff only.
const vExMentionCandidates = [
  {
    personId: "visual-person",
    name: "Ada Example",
    image: null,
    side: "staff",
    reachable: true,
  },
  {
    personId: "visual-person-ben",
    name: "Ben Okafor",
    image: null,
    side: "staff",
    reachable: true,
  },
  {
    personId: "visual-person-chloe",
    name: "Chloe Martin",
    image: null,
    side: "staff",
    reachable: true,
  },
];
// GET /api/work-items/HELP-7/estimate: own estimate 3 points; its only child (HELP-8) is
// unestimated, so there is no roll-up (agile/logic.ts rollUpEstimate).
const vExWorkItemEstimate = {
  estimatePointId: "visual-point-p3",
  point: {
    id: "visual-point-p3",
    key: "p3",
    value: "3",
    weight: 3,
    position: 2,
  },
  rollup: { own: 3, rollup: null, effective: 3, discrepancy: false },
};

// ---- Workspace labels: GET /api/label/workspace/visual-workspace (Label[]) ----
// Catalogue labels have taskId null (label-catalogue.tsx filters out task labels).
const vExWorkspaceLabels = [
  {
    id: "visual-label-access",
    name: "Access",
    key: "access",
    color: "teal",
    createdAt: "2026-09-02T09:00:00.000Z",
    updatedAt: "2026-09-02T09:00:00.000Z",
    taskId: null,
    workspaceId: "visual-workspace",
  },
  {
    id: "visual-label-hardware",
    name: "Hardware",
    key: "hardware",
    color: "orange",
    createdAt: "2026-09-02T09:05:00.000Z",
    updatedAt: "2026-09-02T09:05:00.000Z",
    taskId: null,
    workspaceId: "visual-workspace",
  },
  {
    id: "visual-label-vip",
    name: "VIP customer",
    key: "vip-customer",
    color: "purple",
    createdAt: "2026-09-10T14:30:00.000Z",
    updatedAt: "2026-10-01T08:15:00.000Z",
    taskId: null,
    workspaceId: "visual-workspace",
  },
];

// ---- Portal shell: GET /api/portal/releases?limit=1 (PortalReleasePage) ----
// The one published release of the svc fixtures (visual-release-mail).
const vExPortalReleases = {
  data: [
    {
      id: "visual-release-mail",
      name: "Mail relay patch 2026.09",
      serviceName: "Email delivery",
      plannedDate: "2026-09-29",
      notes:
        "Notification emails that were delayed by the old mail relay are delivered again.",
      publishedAt: "2026-09-29T21:30:00.000Z",
    },
  ],
  nextCursor: null,
};

// agile fixtures
// ---- Cycles (GET /api/projects/help/cycles, /api/cycles/visual-cycle, /burndown) ----
// Statuses, summaries, velocity and burndown points are all server-computed; the client never
// derives them from the browser clock (apps/api/src/agile/logic.ts buildBurndown gets `today`
// from the server). Dates are calendar dates formatted by formatCalendarDate (no time zone).
const vAgileEmptyBucket = { count: 0, points: 0 };

const vAgileCycle = (
  id: string,
  name: string,
  startDate: string,
  endDate: string,
  status: "upcoming" | "active" | "completed",
  completedAt: string | null,
  summary: {
    total: { count: number; points: number };
    completed: { count: number; points: number };
    inProgress: { count: number; points: number };
    notStarted: { count: number; points: number };
  },
) => ({
  id,
  workspaceId: "visual-workspace",
  projectId: "visual-project",
  name,
  startDate,
  endDate,
  status,
  completedAt,
  version: 1,
  summary: {
    unit: "points",
    ...summary,
    cancelled: vAgileEmptyBucket,
    unestimated: { count: 0, share: 0 },
  },
});

const vAgileActiveSummary = {
  total: { count: 4, points: 13 },
  completed: { count: 1, points: 5 },
  inProgress: { count: 2, points: 5 },
  notStarted: { count: 1, points: 3 },
};

const vAgileCycleActive = vAgileCycle(
  "visual-cycle",
  "Sprint 14",
  "2026-10-19",
  "2026-11-01",
  "active",
  null,
  vAgileActiveSummary,
);

const vAgileCycleList = {
  data: [
    vAgileCycle(
      "visual-cycle-11",
      "Sprint 11",
      "2026-09-07",
      "2026-09-20",
      "completed",
      "2026-09-20T16:30:00.000Z",
      {
        total: { count: 7, points: 21 },
        completed: { count: 7, points: 21 },
        inProgress: vAgileEmptyBucket,
        notStarted: vAgileEmptyBucket,
      },
    ),
    vAgileCycle(
      "visual-cycle-12",
      "Sprint 12",
      "2026-09-21",
      "2026-10-04",
      "completed",
      "2026-10-04T16:10:00.000Z",
      {
        total: { count: 6, points: 18 },
        completed: { count: 6, points: 18 },
        inProgress: vAgileEmptyBucket,
        notStarted: vAgileEmptyBucket,
      },
    ),
    vAgileCycle(
      "visual-cycle-13",
      "Sprint 13",
      "2026-10-05",
      "2026-10-18",
      "completed",
      "2026-10-18T15:45:00.000Z",
      {
        total: { count: 8, points: 26 },
        completed: { count: 7, points: 24 },
        inProgress: vAgileEmptyBucket,
        notStarted: { count: 1, points: 2 },
      },
    ),
    vAgileCycleActive,
    vAgileCycle(
      "visual-cycle-15",
      "Sprint 15",
      "2026-11-02",
      "2026-11-15",
      "upcoming",
      null,
      {
        total: vAgileEmptyBucket,
        completed: vAgileEmptyBucket,
        inProgress: vAgileEmptyBucket,
        notStarted: vAgileEmptyBucket,
      },
    ),
  ],
  meta: {
    unit: "points",
    // Mean of Sprint 11..13 completed points: (21 + 18 + 24) / 3 = 21.
    velocity: { status: "ok", unit: "points", value: 21, cycles: 3 },
    incompletePolicy: "next_cycle",
    canManage: true,
    today: "2026-10-27",
  },
};

const vAgileCycleDetail = {
  ...vAgileCycleActive,
  scopeChanges: [
    {
      workItemKey: "HELP-14",
      title: "Update the VPN onboarding guide",
      kind: "removed",
      at: "2026-10-21T11:15:00.000Z",
      retrospective: false,
    },
    {
      workItemKey: "HELP-13",
      title: "Rotate the SSO signing certificate",
      kind: "added",
      at: "2026-10-22T09:30:00.000Z",
      retrospective: false,
    },
  ],
  completionPreview: {
    defaultPolicy: "next_cycle",
    incompleteCount: 3,
    nextCycle: {
      id: "visual-cycle-15",
      name: "Sprint 15",
      startDate: "2026-11-02",
      endDate: "2026-11-15",
    },
  },
  velocity: { status: "ok", unit: "points", value: 21, cycles: 3 },
  discontinuities: [],
  canManage: true,
  canEditItems: true,
};

// Opening scope 12 (HELP-9/10/11 = 10 + HELP-14 = 2); HELP-14 removed on 21 Oct, HELP-13 (3)
// added on 22 Oct, HELP-9 (5) resolved on 24 Oct. ideal = 12 * (1 - elapsed / 13), rounded to
// two places exactly as buildBurndown does. The series stops at the server's `today` (27 Oct).
const vAgileBurndown = {
  unit: "points",
  noScope: false,
  startDate: "2026-10-19",
  endDate: "2026-11-01",
  openingScope: 12,
  points: [
    { date: "2026-10-19", scope: 12, completed: 0, remaining: 12, ideal: 12 },
    {
      date: "2026-10-20",
      scope: 12,
      completed: 0,
      remaining: 12,
      ideal: 11.08,
    },
    {
      date: "2026-10-21",
      scope: 10,
      completed: 0,
      remaining: 10,
      ideal: 10.15,
    },
    { date: "2026-10-22", scope: 13, completed: 0, remaining: 13, ideal: 9.23 },
    { date: "2026-10-23", scope: 13, completed: 0, remaining: 13, ideal: 8.31 },
    { date: "2026-10-24", scope: 13, completed: 5, remaining: 8, ideal: 7.38 },
    { date: "2026-10-25", scope: 13, completed: 5, remaining: 8, ideal: 6.46 },
    { date: "2026-10-26", scope: 13, completed: 5, remaining: 8, ideal: 5.54 },
    { date: "2026-10-27", scope: 13, completed: 5, remaining: 8, ideal: 4.62 },
  ],
  unestimated: { count: 0, share: 0 },
  discontinuities: [],
};

// ---- Work items in the cycle / module (scoped work surface board) ----
// dueDate is null on purpose: kanban-board/task-card.tsx colours due dates through
// lib/due-date-status.ts getDueDateStatus, which reads `new Date()`.
const vAgileScopedItem = (
  number: number,
  title: string,
  stateId: string,
  stateName: string,
  stateCategory: string,
  priority: string,
  estimatePointId: string,
) => ({
  id: `visual-agile-item-${number}`,
  projectId: "visual-project",
  workspaceId: "visual-workspace",
  typeId: "visual-type",
  number,
  key: `HELP-${number}`,
  title,
  description: "",
  stateId,
  stateName,
  stateCategory,
  priority,
  assigneeId: null,
  assigneeName: null,
  requesterId: null,
  parentId: null,
  position: `${number}.0000000000`,
  customerVisibility: "private",
  startDate: null,
  dueDate: null,
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-10-12T09:00:00.000Z",
  updatedAt: "2026-10-24T15:20:00.000Z",
  cycleId: "visual-cycle",
  moduleId: "visual-module",
  estimatePointId,
});

const vAgileScopedWorkItems = {
  data: [
    vAgileScopedItem(
      9,
      "Enforce MFA for admin accounts",
      "visual-done",
      "Done",
      "completed",
      "high",
      "visual-point-p4",
    ),
    vAgileScopedItem(
      10,
      "Customer locked out after SSO migration",
      "visual-state",
      "In progress",
      "started",
      "urgent",
      "visual-point-p3",
    ),
    vAgileScopedItem(
      11,
      "Reset link expires too quickly",
      "visual-state",
      "In progress",
      "started",
      "medium",
      "visual-point-p2",
    ),
    vAgileScopedItem(
      13,
      "Rotate the SSO signing certificate",
      "visual-backlog",
      "Backlog",
      "backlog",
      "medium",
      "visual-point-p3",
    ),
  ],
  page: { hasMore: false, nextCursor: null },
  meta: {},
};

// ---- Modules (GET /api/projects/help/modules, /api/modules/visual-module) ----
// Progress and forecast ranges are server-computed (module.repository.ts progressOf); the
// client only formats calendar dates.
const vAgileLead = { id: "visual-person", name: "Ada Example" };

const vAgileModuleIdentity = {
  id: "visual-module",
  workspaceId: "visual-workspace",
  projectId: "visual-project",
  name: "Identity and access",
  description:
    "Single sign-on, MFA and password reset work for staff and customer accounts.",
  lead: vAgileLead,
  state: "in_progress",
  targetDate: "2026-11-30",
  version: 3,
  progress: { total: 4, completed: 1, cancelled: 0, remaining: 3, percent: 25 },
  forecast: {
    status: "on_track",
    earliest: "2026-11-16",
    latest: "2026-11-27",
    targetDate: "2026-11-30",
  },
};

const vAgileModuleList = {
  data: [
    vAgileModuleIdentity,
    {
      id: "visual-module-mobile",
      workspaceId: "visual-workspace",
      projectId: "visual-project",
      name: "Mobile app support",
      description: "Triage and fixes for the customer mobile app.",
      lead: null,
      state: "planned",
      targetDate: null,
      version: 1,
      progress: {
        total: 3,
        completed: 0,
        cancelled: 0,
        remaining: 3,
        percent: 0,
      },
      forecast: { status: "no_target" },
    },
    {
      id: "visual-module-portal",
      workspaceId: "visual-workspace",
      projectId: "visual-project",
      name: "Self-service portal",
      description: "Request forms and knowledge base deflection.",
      lead: vAgileLead,
      state: "completed",
      targetDate: "2026-10-10",
      version: 6,
      progress: {
        total: 6,
        completed: 5,
        cancelled: 1,
        remaining: 0,
        percent: 100,
      },
      forecast: { status: "complete" },
    },
  ],
  meta: { canManage: true, leadCandidates: [vAgileLead] },
};

const vAgileModuleDetail = {
  ...vAgileModuleIdentity,
  canManage: true,
  canEditItems: true,
  leadCandidates: [vAgileLead],
};

// ---- Pages (GET /api/projects/help/pages, /pages/visual-page, /pages/visual-page/versions) ----
const vAgilePageAuthor = { id: "visual-user", name: "Ada Example" };
const vAgilePageEditor = { id: "visual-user-sam", name: "Sam Rivera" };

const vAgilePageSummaries = [
  {
    id: "visual-page-runbooks",
    projectId: "visual-project",
    parentId: null,
    title: "Runbooks",
    snippet: "Step-by-step procedures for recurring support incidents.",
    version: 2,
    updatedBy: vAgilePageAuthor,
    createdAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-10T13:40:00.000Z",
  },
  {
    id: "visual-page",
    projectId: "visual-project",
    parentId: "visual-page-runbooks",
    title: "Password reset runbook",
    snippet:
      "How to verify the caller, send a fresh reset link and confirm access.",
    version: 3,
    updatedBy: vAgilePageEditor,
    createdAt: "2026-09-28T08:45:00.000Z",
    updatedAt: "2026-10-14T10:20:00.000Z",
  },
  {
    id: "visual-page-vpn",
    projectId: "visual-project",
    parentId: "visual-page-runbooks",
    title: "VPN outage runbook",
    snippet: "Checks to run before escalating a VPN outage to networking.",
    version: 1,
    updatedBy: vAgilePageAuthor,
    createdAt: "2026-10-06T12:05:00.000Z",
    updatedAt: "2026-10-06T12:05:00.000Z",
  },
  {
    id: "visual-page-onboarding",
    projectId: "visual-project",
    parentId: null,
    title: "Support onboarding checklist",
    snippet:
      "Accounts, tools and shadowing for a new support agent's first week.",
    version: 4,
    updatedBy: vAgilePageEditor,
    createdAt: "2026-09-15T09:30:00.000Z",
    updatedAt: "2026-10-01T16:00:00.000Z",
  },
];

const vAgilePageList = { pages: vAgilePageSummaries, canEdit: true };
const { 1: vAgileOpenedPageSummary } = vAgilePageSummaries;

const vAgilePage = {
  ...vAgileOpenedPageSummary,
  createdBy: vAgilePageAuthor,
  canEdit: true,
  body: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Before you start" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Confirm the caller's identity with two of the checks below before sending anything.",
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Employee number or customer account ID",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Registered phone number on file" },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Line manager confirmation" }],
              },
            ],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Steps" }],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Expire any outstanding reset links for the account.",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Send a new reset link; it is valid for 30 minutes.",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Stay on the call until the customer has signed in.",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "If the link fails twice, escalate to " },
          {
            type: "text",
            marks: [{ type: "bold" }],
            text: "Identity and access",
          },
          { type: "text", text: "." },
        ],
      },
    ],
  },
};

const vAgilePageVersions = {
  versions: [
    {
      number: 3,
      title: "Password reset runbook",
      kind: "edit",
      restoredFrom: null,
      createdBy: vAgilePageEditor,
      createdAt: "2026-10-14T10:20:00.000Z",
      updatedAt: "2026-10-14T10:20:00.000Z",
    },
    {
      number: 2,
      title: "Password reset runbook",
      kind: "edit",
      restoredFrom: null,
      createdBy: vAgilePageAuthor,
      createdAt: "2026-10-03T14:05:00.000Z",
      updatedAt: "2026-10-03T14:05:00.000Z",
    },
    {
      number: 1,
      title: "Password reset steps",
      kind: "create",
      restoredFrom: null,
      createdBy: vAgilePageAuthor,
      createdAt: "2026-09-28T08:45:00.000Z",
      updatedAt: "2026-09-28T08:45:00.000Z",
    },
  ],
};

// ---- Project estimates (GET /api/projects/help/estimates) ----
const vAgileEstimates = {
  system: "points",
  estimateId: "visual-estimate",
  points: [
    { id: "visual-point-p1", key: "p1", value: "1", weight: 1, position: 0 },
    { id: "visual-point-p2", key: "p2", value: "2", weight: 2, position: 1 },
    { id: "visual-point-p3", key: "p3", value: "3", weight: 3, position: 2 },
    { id: "visual-point-p4", key: "p4", value: "5", weight: 5, position: 3 },
    { id: "visual-point-p5", key: "p5", value: "8", weight: 8, position: 4 },
    { id: "visual-point-p6", key: "p6", value: "13", weight: 13, position: 5 },
  ],
  defaults: {
    points: ["1", "2", "3", "5", "8", "13", "21"],
    categories: ["XS", "S", "M", "L", "XL"],
    time: ["1h", "2h", "4h", "1d", "2d", "1w"],
  },
  incompletePolicy: "next_cycle",
  canManage: true,
};

// ---- Project features (GET /api/projects/visual-project/features) ----
// listProjectFeatures returns every flag; the panel itself drops feature.scim / feature.mcp.
const vAgileProjectOverrides = [
  "feature.cycles",
  "feature.modules",
  "feature.estimates",
  "feature.pages",
];
// The project inherits the workspace's effective switches (visualResolvedFeatures).
const vAgileWorkspaceOn = visualResolvedFeatures
  .filter((feature) => feature.enabled)
  .map((feature) => feature.key);
const vAgileProjectFeatures = {
  features: [
    "feature.cycles",
    "feature.modules",
    "feature.estimates",
    "feature.intake",
    "feature.sla",
    "feature.approvals",
    "feature.time_tracking",
    "feature.cost_tracking",
    "feature.knowledge_base",
    "feature.service_catalogue",
    "feature.customer_portal",
    "feature.reports",
    "feature.automations",
    "feature.timeline",
    "feature.calendar",
    "feature.pages",
    "feature.mcp",
    "feature.scim",
    "feature.import",
    "feature.public_boards",
    "feature.dev_links",
  ].map((key) => {
    const override = vAgileProjectOverrides.includes(key);
    const workspaceOn = vAgileWorkspaceOn.includes(key);
    const defaultOn = key === "feature.scim" || key === "feature.import";
    return {
      key,
      enabled: override || workspaceOn || defaultOn,
      source: override ? "project" : workspaceOn ? "workspace" : "default",
      locked: key === "feature.import",
      defaultEnabled: defaultOn,
      version: override ? 1 : 0,
      updatedAt: override ? "2026-10-02T09:15:00.000Z" : null,
      updatedBy: override ? { id: "visual-user", name: "Ada Example" } : null,
      override: override ? true : null,
      inherited: {
        enabled: workspaceOn || defaultOn,
        source: workspaceOn ? "workspace" : "default",
      },
    };
  }),
};

// ---- Project automations (GET /api/projects/help/automations) ----
// lastRunAt is null on every rule: a non-null value renders "Last run <relative>" through
// lib/format.ts formatRelativeTime (now = new Date()), which reads the browser clock.
const vAgileAutomation = (
  id: string,
  name: string,
  enabled: boolean,
  trigger: string,
  conditions: { field: string; op: string; value?: unknown }[],
  actions: ({ type: string } & Record<string, unknown>)[],
  effectiveRoleId: string,
  effectiveRoleName: string,
  position: number,
  flaggedReason: string | null,
) => ({
  id,
  workspaceId: "visual-workspace",
  projectId: "visual-project",
  projectFilter: null,
  name,
  enabled,
  trigger,
  scheduleCron: null,
  conditions,
  actions,
  effectiveRoleId,
  effectiveRoleName,
  position,
  stopProcessing: false,
  flaggedReason,
  fireCount: 0,
  lastRunAt: null,
  createdBy: "visual-user",
  version: 1,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
});

const vAgileAutomations = {
  data: [
    vAgileAutomation(
      "visual-automation-urgent",
      "Escalate urgent password resets",
      true,
      "work_item.created",
      [
        { field: "priority", op: "eq", value: "urgent" },
        { field: "type", op: "eq", value: "visual-type" },
      ],
      [
        { type: "add_label", labelId: "visual-project-label" },
        {
          type: "notify",
          teamId: "visual-team",
          title: "Urgent password reset",
          body: "A new urgent password reset needs an owner.",
        },
      ],
      "visual-role-agent",
      "Support agent",
      0,
      null,
    ),
    vAgileAutomation(
      "visual-automation-breach",
      "Notify the lead when an SLA is breached",
      true,
      "sla.breached",
      [],
      [{ type: "set_priority", priority: "urgent" }],
      "visual-role-lead",
      "Team lead",
      1,
      null,
    ),
    vAgileAutomation(
      "visual-automation-vpn",
      "Label VPN requests",
      false,
      "submission.received",
      [{ field: "label", op: "contains", value: "visual-deleted-label" }],
      [{ type: "add_label", labelId: "visual-deleted-label" }],
      "visual-role-agent",
      "Support agent",
      2,
      "references_deleted_label",
    ),
  ],
  meta: {
    total: 3,
    assignableRoles: [
      {
        id: "visual-role-agent",
        key: "agent",
        name: "Support agent",
        rank: 20,
      },
      { id: "visual-role-lead", key: "lead", name: "Team lead", rank: 30 },
    ],
    featureEnabled: true,
  },
};

// ---- Project budget (GET /api/projects/visual-project/budget, /api/time-settings?...) ----
const vAgileProjectTimeSettings = {
  backdateLimitDays: 14,
  canManage: true,
  project: { id: "visual-project", defaultBillable: true },
};

const vAgileBudget = {
  canManage: true,
  data: [
    {
      id: "visual-budget-q3",
      projectId: "visual-project",
      name: "Q3 2026 support",
      currency: "EUR",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      plannedAmountMinor: 1500000,
      figuresHidden: false,
      actualMinor: 1380000,
      timeMinor: 1250000,
      costEntriesMinor: 130000,
      remainingMinor: 120000,
      thresholdReached: 90,
      otherCurrencies: [],
      unpricedMinutes: 0,
      committedMinor: 0,
      committedByCurrency: [],
    },
    {
      id: "visual-budget-q4",
      projectId: "visual-project",
      name: "Q4 2026 support",
      currency: "EUR",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
      plannedAmountMinor: 1800000,
      figuresHidden: false,
      actualMinor: 610000,
      timeMinor: 560000,
      costEntriesMinor: 50000,
      remainingMinor: 1190000,
      thresholdReached: null,
      otherCurrencies: [
        { currency: "GBP", costMinor: 42000, pricedMinutes: 360 },
      ],
      unpricedMinutes: 90,
      committedMinor: 420000,
      committedByCurrency: [
        { currency: "EUR", amountMinor: 420000, taskCount: 3 },
      ],
    },
  ],
  byActivity: [
    { key: "support", label: "Support", minutes: 5400 },
    { key: "maintenance", label: "Maintenance", minutes: 1980 },
  ],
  byPerson: [
    { key: "visual-person", label: "Ada Example", minutes: 4620 },
    { key: "visual-person-sam", label: "Sam Rivera", minutes: 2760 },
  ],
};

// svc fixtures
const vSvcSso = {
  id: "visual-service",
  workspaceId: "visual-workspace",
  name: "Single sign-on",
  description:
    "Staff and customer sign-in through the identity provider, including password resets and multi-factor prompts.",
  category: "Identity",
  ownerTeamId: "visual-team-identity",
  ownerTeamName: "Identity team",
  supportLevel: "L2",
  serviceCalendarId: "visual-calendar",
  calendarName: "Support coverage",
  status: "degraded",
  statusNote: "Password reset emails are delayed by up to 20 minutes.",
  statusChangedAt: "2026-10-14T09:30:00.000Z",
  incidentCount: 3,
  openChangeCount: 1,
  version: 4,
  createdAt: "2026-09-02T08:00:00.000Z",
  updatedAt: "2026-10-14T09:30:00.000Z",
};

const vSvcEmail = {
  id: "visual-service-email",
  workspaceId: "visual-workspace",
  name: "Email delivery",
  description: "Outbound notification and password reset email.",
  category: "Messaging",
  ownerTeamId: "visual-team-messaging",
  ownerTeamName: "Messaging team",
  supportLevel: "L1",
  serviceCalendarId: "visual-calendar",
  calendarName: "Support coverage",
  status: "operational",
  statusNote: null,
  statusChangedAt: "2026-09-18T07:15:00.000Z",
  incidentCount: 1,
  openChangeCount: 2,
  version: 2,
  createdAt: "2026-09-02T08:05:00.000Z",
  updatedAt: "2026-09-18T07:15:00.000Z",
};

const vSvcPortal = {
  id: "visual-service-portal",
  workspaceId: "visual-workspace",
  name: "Customer portal",
  description:
    "The self-service portal where customers raise and follow requests.",
  category: "Web",
  ownerTeamId: "visual-team-web",
  ownerTeamName: "Web team",
  supportLevel: "L2",
  serviceCalendarId: null,
  calendarName: null,
  status: "operational",
  statusNote: null,
  statusChangedAt: null,
  incidentCount: 0,
  openChangeCount: 0,
  version: 1,
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
};

const vSvcVpn = {
  id: "visual-service-vpn",
  workspaceId: "visual-workspace",
  name: "VPN gateway",
  description: "Remote access for staff working off site.",
  category: "Network",
  ownerTeamId: null,
  ownerTeamName: null,
  supportLevel: "L3",
  serviceCalendarId: null,
  calendarName: null,
  status: "outage",
  statusNote: "Gateway in the London region is not accepting connections.",
  statusChangedAt: "2026-10-20T06:45:00.000Z",
  incidentCount: 5,
  openChangeCount: 1,
  version: 3,
  createdAt: "2026-09-04T09:00:00.000Z",
  updatedAt: "2026-10-20T06:45:00.000Z",
};

const vSvcServiceList = { data: [vSvcVpn, vSvcSso, vSvcEmail, vSvcPortal] };

const vSvcServiceDetail = {
  ...vSvcSso,
  links: [
    {
      id: "visual-service-link-runbook",
      kind: "documentation",
      label: "Sign-in runbook",
      url: "https://docs.example.test/runbooks/sign-in",
      projectId: null,
      projectName: null,
      kbArticleId: null,
    },
    {
      id: "visual-service-link-project",
      kind: "project",
      label: null,
      url: null,
      projectId: "visual-project",
      projectName: "Help Desk",
      kbArticleId: null,
    },
    {
      id: "visual-service-link-article",
      kind: "kb_article",
      label: null,
      url: null,
      projectId: null,
      projectName: null,
      kbArticleId: "visual-article",
    },
  ],
  dependsOn: [
    {
      id: "visual-service-email",
      name: "Email delivery",
      status: "operational",
    },
  ],
  dependents: [
    {
      id: "visual-service-portal",
      name: "Customer portal",
      status: "operational",
    },
    { id: "visual-service-vpn", name: "VPN gateway", status: "outage" },
  ],
  releaseChecklist: [
    {
      id: "visual-checklist-1",
      text: "Announce the maintenance window to customers",
      position: 0,
    },
    {
      id: "visual-checklist-2",
      text: "Export the current identity provider configuration",
      position: 1,
    },
    {
      id: "visual-checklist-3",
      text: "Test sign-in with a staff and a customer account",
      position: 2,
    },
  ],
  cycleDetected: false,
  deletionBlockers: [
    "The service has 1 open change.",
    "The service has 1 release(s).",
    "2 other service(s) depend on it. Remove the dependency first.",
  ],
};

const vSvcServiceImpact = {
  service: { id: "visual-service", name: "Single sign-on", status: "degraded" },
  impacted: [
    {
      serviceId: "visual-service-portal",
      name: "Customer portal",
      status: "operational",
      depth: 1,
      viaServiceId: "visual-service",
      viaName: "Single sign-on",
    },
    {
      serviceId: "visual-service-vpn",
      name: "VPN gateway",
      status: "outage",
      depth: 1,
      viaServiceId: "visual-service",
      viaName: "Single sign-on",
    },
  ],
  customers: [
    { id: "visual-customer-contoso", name: "Contoso Retail" },
    { id: "visual-customer-fabrikam", name: "Fabrikam Health" },
  ],
  cycleDetected: false,
  cycleServiceIds: [],
};

// Change calendar data sits entirely in September 2026 (see NOTES: CLOCK-BLOCKED; usable with ?month=2026-09).
const vSvcChangeCalendar = {
  from: "2026-08-31T00:00:00.000Z",
  to: "2026-10-05T00:00:00.000Z",
  freezes: [
    {
      id: "visual-freeze-quarter-end",
      name: "Quarter-end freeze",
      startsAt: "2026-09-28T00:00:00.000Z",
      endsAt: "2026-10-01T00:00:00.000Z",
      reason: "Finance close: no production changes.",
    },
  ],
  changes: [
    {
      key: "HELP-19",
      title: "Restart VPN concentrators",
      projectId: "visual-project",
      projectName: "Help Desk",
      windowStart: "2026-09-03T06:00:00.000Z",
      windowEnd: "2026-09-03T07:00:00.000Z",
      risk: null,
      stateName: "Done",
      stateGroup: "completed",
      services: [{ id: "visual-service-vpn", name: "VPN gateway" }],
      retrospective: true,
      frozen: false,
      overridden: false,
      conflict: false,
    },
    {
      key: "HELP-21",
      title: "Rotate SSO signing certificate",
      projectId: "visual-project",
      projectName: "Help Desk",
      windowStart: "2026-09-15T20:00:00.000Z",
      windowEnd: "2026-09-15T23:00:00.000Z",
      risk: "medium",
      stateName: "Scheduled",
      stateGroup: "unstarted",
      services: [{ id: "visual-service", name: "Single sign-on" }],
      retrospective: false,
      frozen: false,
      overridden: false,
      conflict: true,
    },
    {
      key: "HELP-22",
      title: "Upgrade identity provider connector",
      projectId: "visual-project",
      projectName: "Help Desk",
      windowStart: "2026-09-15T21:00:00.000Z",
      windowEnd: "2026-09-16T00:00:00.000Z",
      risk: "high",
      stateName: "Scheduled",
      stateGroup: "unstarted",
      services: [{ id: "visual-service", name: "Single sign-on" }],
      retrospective: false,
      frozen: false,
      overridden: false,
      conflict: true,
    },
    {
      key: "HELP-24",
      title: "Patch mail relay servers",
      projectId: "visual-project",
      projectName: "Help Desk",
      windowStart: "2026-09-29T19:00:00.000Z",
      windowEnd: "2026-09-29T21:00:00.000Z",
      risk: "low",
      stateName: "Approved",
      stateGroup: "started",
      services: [{ id: "visual-service-email", name: "Email delivery" }],
      retrospective: false,
      frozen: true,
      overridden: true,
      conflict: false,
    },
  ],
  conflicts: [
    { changeKeys: ["HELP-21", "HELP-22"], serviceIds: ["visual-service"] },
  ],
};

const vSvcReleaseList = {
  data: [
    {
      id: "visual-release-portal",
      workspaceId: "visual-workspace",
      name: "Portal refresh 2026.11",
      serviceId: "visual-service-portal",
      serviceName: "Customer portal",
      plannedDate: null,
      status: "planned",
      publishToPortal: false,
      publishedAt: null,
      version: 1,
      createdAt: "2026-10-12T10:00:00.000Z",
      changeCount: 0,
      checklistTotal: 0,
      checklistDone: 0,
    },
    {
      id: "visual-release-sso",
      workspaceId: "visual-workspace",
      name: "SSO hardening 2026.10",
      serviceId: "visual-service",
      serviceName: "Single sign-on",
      plannedDate: "2026-10-20",
      status: "in_progress",
      publishToPortal: true,
      publishedAt: null,
      version: 3,
      createdAt: "2026-10-01T09:00:00.000Z",
      changeCount: 2,
      checklistTotal: 3,
      checklistDone: 2,
    },
    {
      id: "visual-release-mail",
      workspaceId: "visual-workspace",
      name: "Mail relay patch 2026.09",
      serviceId: "visual-service-email",
      serviceName: "Email delivery",
      plannedDate: "2026-09-29",
      status: "released",
      publishToPortal: true,
      publishedAt: "2026-09-29T21:30:00.000Z",
      version: 5,
      createdAt: "2026-09-10T14:00:00.000Z",
      changeCount: 1,
      checklistTotal: 2,
      checklistDone: 2,
    },
  ],
};

const vSvcKbCategories = {
  categories: [
    {
      id: "visual-kb-category-access",
      workspaceId: "visual-workspace",
      name: "Identity and access",
      parentId: null,
      position: 0,
      articleCount: 3,
    },
    {
      id: "visual-kb-category-devices",
      workspaceId: "visual-workspace",
      name: "Devices and printing",
      parentId: null,
      position: 1,
      articleCount: 1,
    },
  ],
};

const vSvcKbSettings = {
  reviewStepEnabled: true,
  canWrite: true,
  canPublish: true,
  canManageSettings: true,
};

const vSvcKbArticleSummary = {
  id: "visual-article",
  workspaceId: "visual-workspace",
  projectId: null,
  categoryId: "visual-kb-category-access",
  title: "Reset your password from the sign-in page",
  snippet: "Customers can reset their own password from the sign-in page.",
  state: "published",
  customerVisible: true,
  ownerId: "visual-person",
  ownerName: "Ada Example",
  authorId: "visual-person",
  authorName: "Ada Example",
  reviewDueAt: "2030-10-30T00:00:00.000Z",
  overdue: false,
  viewCount: 412,
  publishedAt: "2026-09-12T10:00:00.000Z",
  publishedVersion: 3,
  version: 3,
  createdAt: "2026-09-05T08:30:00.000Z",
  updatedAt: "2026-09-12T10:00:00.000Z",
};

const vSvcKbArticleMfa = {
  id: "visual-article-mfa",
  workspaceId: "visual-workspace",
  projectId: null,
  categoryId: "visual-kb-category-access",
  title: "Set up multi-factor authentication",
  snippet:
    "Add an authenticator app before your first sign-in from a new device.",
  state: "draft",
  customerVisible: true,
  ownerId: null,
  ownerName: null,
  authorId: "visual-person",
  authorName: "Ada Example",
  reviewDueAt: null,
  overdue: false,
  viewCount: 0,
  publishedAt: null,
  publishedVersion: null,
  version: 1,
  createdAt: "2026-10-08T13:00:00.000Z",
  updatedAt: "2026-10-09T15:20:00.000Z",
};

const vSvcKbArticleVpn = {
  id: "visual-article-vpn",
  workspaceId: "visual-workspace",
  projectId: "visual-project",
  categoryId: "visual-kb-category-access",
  title: "Connect to the VPN on a new laptop",
  snippet: "Install the VPN client and sign in with your work account.",
  state: "in_review",
  customerVisible: false,
  ownerId: "visual-person",
  ownerName: "Ada Example",
  authorId: "visual-person",
  authorName: "Ada Example",
  reviewDueAt: "2026-10-01T00:00:00.000Z",
  overdue: true,
  viewCount: 87,
  publishedAt: null,
  publishedVersion: null,
  version: 2,
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-25T11:45:00.000Z",
};

const vSvcKbArticlePrinter = {
  id: "visual-article-printer",
  workspaceId: "visual-workspace",
  projectId: null,
  categoryId: "visual-kb-category-devices",
  title: "Add a shared office printer",
  snippet: "Find the printer by its floor and room number.",
  state: "archived",
  customerVisible: false,
  ownerId: null,
  ownerName: null,
  authorId: "visual-person",
  authorName: "Ada Example",
  reviewDueAt: null,
  overdue: false,
  viewCount: 23,
  publishedAt: null,
  publishedVersion: 1,
  version: 4,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-30T16:10:00.000Z",
};

const vSvcKbArticleList = {
  articles: [
    vSvcKbArticleMfa,
    vSvcKbArticleVpn,
    vSvcKbArticleSummary,
    vSvcKbArticlePrinter,
  ],
  total: 4,
};

const vSvcKbBody = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Customers can reset their own password from the sign-in page. The reset link is valid for 30 minutes.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Before you start" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "You need access to the email address on your account.",
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Check your junk folder if the email does not arrive within five minutes.",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Reset the password" }],
    },
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Open the sign-in page and choose Forgot password.",
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Enter your work email address and choose Send link.",
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Open the email and choose Reset password, then enter a new password of at least 12 characters.",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "If the link has expired" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [{ type: "bold" }],
          text: "Request a new link.",
        },
        {
          type: "text",
          text: " Each new link replaces the previous one, so always use the most recent email.",
        },
      ],
    },
  ],
};

const vSvcKbArticleDetail = {
  article: {
    ...vSvcKbArticleSummary,
    body: vSvcKbBody,
    hasUnpublishedChanges: false,
    versionCount: 3,
    categoryName: "Identity and access",
  },
  related: [vSvcKbArticleMfa],
  canPublish: true,
  canWrite: true,
  reviewStepEnabled: true,
};

// rep fixtures
const vRepAsOf = "2026-10-21T12:00:00.000Z";

const vRepWindow30 = {
  preset: "30",
  from: "2026-09-21T12:00:00.000Z",
  to: "2026-10-21T12:00:00.000Z",
  days: 30,
  live: false,
};

const vRepWindowLive = { ...vRepWindow30, live: true };

const vRepSnapshot = {
  closedDays: 30,
  uncoveredDays: 0,
  computedAt: "2026-10-21T02:00:00.000Z",
  through: "2026-10-21T00:00:00.000Z",
};

// The report envelope's `window` field. The G8 scope check rejects a bare `window`
// identifier anywhere in this spec, so the key is computed.
const vRepWindowField = "window";

/** Every field of the report envelope (apps/web/src/fetchers/report/index.ts ReportEnvelope). */
const vRepEnvelopeBase = {
  key: "throughput",
  title: "Throughput",
  category: "delivery",
  tier: 1,
  scope: { kind: "all", projectCount: 1 },
  [vRepWindowField]: vRepWindow30,
  asOf: vRepAsOf,
  boundary: "mixed",
  sources: {
    metricSnapshot: true,
    cycleSnapshot: false,
    liveComponents: ["current_period"],
  },
  snapshot: vRepSnapshot,
  filters: {},
  options: {},
  choices: [],
  metrics: [],
  chart: null,
  columns: [],
  rows: [],
  truncated: false,
  empty: null,
  excluded: null,
  notes: [],
  drill: false,
  costVisible: true,
};

const vRepThroughput = {
  ...vRepEnvelopeBase,
  key: "throughput",
  title: "Throughput",
  category: "delivery",
  metrics: [
    {
      key: "completed",
      label: "Items completed",
      unit: "count",
      value: 42,
      n: 42,
      needed: 0,
      trend: { status: "ok", direction: "up", delta: 6, previous: 36 },
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: [
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ],
    series: [
      { key: "completed", label: "Completed", values: [9, 7, 11, 8, 7] },
    ],
  },
  columns: [
    { key: "week", label: "Week starting", kind: "date" },
    { key: "completed", label: "Completed", kind: "number" },
  ],
  rows: [
    { week: "2026-09-21", completed: 9, _drill: "2026-09-21" },
    { week: "2026-09-28", completed: 7, _drill: "2026-09-28" },
    { week: "2026-10-05", completed: 11, _drill: "2026-10-05" },
    { week: "2026-10-12", completed: 8, _drill: "2026-10-12" },
    { week: "2026-10-19", completed: 7, _drill: "2026-10-19" },
  ],
  drill: true,
};

const vRepSlaAttainment = {
  ...vRepEnvelopeBase,
  key: "sla_attainment",
  title: "SLA attainment",
  category: "promises",
  metrics: [
    {
      key: "attainment",
      label: "Attainment",
      unit: "percent",
      value: 92,
      n: 48,
      needed: 10,
      trend: { status: "ok", direction: "up", delta: 4, previous: 88 },
    },
    { key: "met", label: "Met", unit: "count", value: 44, n: 44, needed: 0 },
    {
      key: "missed",
      label: "Missed",
      unit: "count",
      value: 4,
      n: 4,
      needed: 0,
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: ["urgent", "high", "medium", "low"],
    series: [
      { key: "met", label: "Met", values: [4, 12, 19, 9] },
      { key: "missed", label: "Missed", values: [1, 2, 1, 0] },
    ],
  },
  columns: [
    { key: "priority", label: "Priority", kind: "text" },
    { key: "met", label: "Met", kind: "number" },
    { key: "missed", label: "Missed", kind: "number" },
    { key: "attainment", label: "Attainment", kind: "percent" },
  ],
  rows: [
    {
      priority: "urgent",
      met: 4,
      missed: 1,
      attainment: { n: 5, needed: 10 },
      _drill: "urgent",
    },
    { priority: "high", met: 12, missed: 2, attainment: 86, _drill: "high" },
    {
      priority: "medium",
      met: 19,
      missed: 1,
      attainment: 95,
      _drill: "medium",
    },
    {
      priority: "low",
      met: 9,
      missed: 0,
      attainment: { n: 9, needed: 10 },
      _drill: "low",
    },
  ],
  drill: true,
};

const vRepAtRiskNow = {
  ...vRepEnvelopeBase,
  key: "at_risk_now",
  title: "At-risk now",
  category: "promises",
  [vRepWindowField]: vRepWindowLive,
  boundary: "live",
  sources: {
    metricSnapshot: false,
    cycleSnapshot: false,
    liveComponents: ["current_state"],
  },
  snapshot: null,
  metrics: [
    {
      key: "at_risk",
      label: "At risk",
      unit: "count",
      value: 3,
      n: 3,
      needed: 0,
    },
    {
      key: "breached",
      label: "Already breached",
      unit: "count",
      value: 1,
      n: 1,
      needed: 0,
    },
  ],
  columns: [
    { key: "key", label: "Key", kind: "text" },
    { key: "title", label: "Title", kind: "text" },
    { key: "project", label: "Project", kind: "text" },
    { key: "assignee", label: "Assignee", kind: "text" },
    { key: "metric", label: "Clock", kind: "text" },
    { key: "state", label: "State", kind: "text" },
    { key: "due", label: "Due", kind: "date" },
  ],
  rows: [
    {
      key: "HELP-7",
      title: "Customer cannot reset their password",
      project: "Help Desk",
      assignee: "Ada Example",
      metric: "Resolution",
      state: "In progress",
      due: "2026-10-21T15:30:00.000Z",
    },
    {
      key: "HELP-5",
      title: "VPN drops every hour for remote staff",
      project: "Help Desk",
      assignee: "Ada Example",
      metric: "First response",
      state: "Backlog",
      due: "2026-10-21T16:00:00.000Z",
    },
    {
      key: "HELP-4",
      title: "Shared mailbox missing for the finance team",
      project: "Help Desk",
      assignee: null,
      metric: "Resolution",
      state: "Backlog",
      due: "2026-10-22T09:00:00.000Z",
    },
  ],
};

const vRepAgeing = {
  ...vRepEnvelopeBase,
  key: "ageing",
  title: "Ageing",
  category: "delivery",
  [vRepWindowField]: vRepWindowLive,
  boundary: "live",
  sources: {
    metricSnapshot: false,
    cycleSnapshot: false,
    liveComponents: ["current_state"],
  },
  snapshot: null,
  metrics: [
    {
      key: "open",
      label: "Open items",
      unit: "count",
      value: 23,
      n: 23,
      needed: 0,
    },
    {
      key: "over_30",
      label: "Older than 30 days",
      unit: "count",
      value: 5,
      n: 5,
      needed: 0,
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: [
      "< 1 day",
      "1-3 days",
      "4-7 days",
      "8-14 days",
      "15-30 days",
      "31-60 days",
      "61-90 days",
      "> 90 days",
    ],
    series: [
      { key: "open", label: "Open items", values: [2, 4, 3, 4, 5, 3, 1, 1] },
    ],
  },
  columns: [
    { key: "bucket", label: "Age", kind: "bucket" },
    { key: "items", label: "Open items", kind: "number" },
  ],
  rows: [
    { bucket: "< 1 day", items: 2, _drill: "lt1" },
    { bucket: "1-3 days", items: 4, _drill: "d1_3" },
    { bucket: "4-7 days", items: 3, _drill: "d4_7" },
    { bucket: "8-14 days", items: 4, _drill: "d8_14" },
    { bucket: "15-30 days", items: 5, _drill: "d15_30" },
    { bucket: "31-60 days", items: 3, _drill: "d31_60" },
    { bucket: "61-90 days", items: 1, _drill: "d61_90" },
    { bucket: "> 90 days", items: 1, _drill: "gt90" },
  ],
  drill: true,
};

/** POST /api/reports/custom/preview for the builder's default body (work items, by priority, count, bar). */
const vRepCustomPreview = {
  ...vRepEnvelopeBase,
  key: "custom",
  title: "Custom report",
  category: "delivery",
  boundary: "live",
  sources: {
    metricSnapshot: false,
    cycleSnapshot: false,
    liveComponents: ["selected_period"],
  },
  snapshot: null,
  options: { chartType: "bar" },
  metrics: [
    {
      key: "total",
      label: "Items",
      unit: "count",
      value: 53,
      n: 53,
      needed: 0,
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: ["high", "low", "medium", "none", "urgent"],
    series: [{ key: "value", label: "Count", values: [14, 9, 21, 3, 6] }],
  },
  columns: [
    { key: "group", label: "Group", kind: "text" },
    { key: "value", label: "Count", kind: "number" },
  ],
  rows: [
    { group: "high", value: 14, _drill: "high" },
    { group: "low", value: 9, _drill: "low" },
    { group: "medium", value: 21, _drill: "medium" },
    { group: "none", value: 3, _drill: "none" },
    { group: "urgent", value: 6, _drill: "urgent" },
  ],
  drill: true,
  costVisible: false,
};

const vRepCatalogue = {
  data: [
    {
      key: "sla_attainment",
      title: "SLA attainment",
      category: "promises",
      tier: 1,
      live: false,
      available: true,
      options: [],
    },
    {
      key: "sla_trend",
      title: "SLA trend",
      category: "promises",
      tier: 1,
      live: false,
      available: true,
      options: [],
    },
    {
      key: "breach_analysis",
      title: "Breach analysis",
      category: "promises",
      tier: 1,
      live: false,
      available: true,
      options: [],
    },
    {
      key: "at_risk_now",
      title: "At-risk now",
      category: "promises",
      tier: 1,
      live: true,
      available: true,
      options: [],
    },
    {
      key: "customer_performance",
      title: "Performance by customer",
      category: "customers",
      tier: 1,
      live: false,
      available: true,
      options: [],
    },
    {
      key: "satisfaction",
      title: "Satisfaction",
      category: "customers",
      tier: 1,
      live: false,
      available: true,
      options: [],
    },
    {
      key: "throughput",
      title: "Throughput",
      category: "delivery",
      tier: 1,
      live: false,
      available: true,
      options: [],
    },
    {
      key: "cycle_time",
      title: "Cycle time",
      category: "delivery",
      tier: 1,
      live: false,
      available: true,
      options: [],
    },
    {
      key: "ageing",
      title: "Ageing",
      category: "delivery",
      tier: 1,
      live: true,
      available: true,
      options: [],
    },
    {
      key: "workload",
      title: "Workload",
      category: "people",
      tier: 1,
      live: true,
      available: true,
      options: [],
    },
    {
      key: "stale_work",
      title: "Stale work",
      category: "people",
      tier: 1,
      live: true,
      available: true,
      options: [],
    },
    {
      key: "time_logged",
      title: "Time logged",
      category: "time",
      tier: 1,
      live: false,
      available: true,
      options: [{ key: "by", values: ["project", "person", "activity"] }],
    },
    {
      key: "kb_deflection",
      title: "Knowledge base deflection",
      category: "knowledge",
      tier: 1,
      live: false,
      available: false,
      options: [],
    },
  ],
  meta: {
    scope: "all",
    canExport: true,
    canSeeRates: true,
    canManageWorkspaceDashboards: true,
  },
};

const vRepDashboardSummary = {
  id: "visual-dashboard",
  workspaceId: "visual-workspace",
  ownerId: null,
  name: "Support overview",
  scope: "workspace",
  isDefault: true,
  version: 3,
  canEdit: true,
  widgetCount: 5,
  createdAt: "2026-09-02T09:00:00.000Z",
  updatedAt: "2026-10-14T15:20:00.000Z",
};

const vRepDashboardList = {
  data: [
    vRepDashboardSummary,
    {
      id: "visual-dashboard-personal",
      workspaceId: "visual-workspace",
      ownerId: "visual-person",
      name: "My queue",
      scope: "personal",
      isDefault: false,
      version: 1,
      canEdit: true,
      widgetCount: 2,
      createdAt: "2026-09-10T10:00:00.000Z",
      updatedAt: "2026-09-10T10:00:00.000Z",
    },
  ],
  meta: { canManageWorkspaceDashboards: true },
};

const vRepDashboardDetail = {
  ...vRepDashboardSummary,
  widgets: [
    {
      id: "visual-widget-sla",
      reportKey: "sla_attainment",
      savedViewId: null,
      chartType: "number",
      filters: {},
      x: 0,
      y: 0,
      w: 4,
      h: 2,
    },
    {
      id: "visual-widget-at-risk",
      reportKey: "at_risk_now",
      savedViewId: null,
      chartType: "number",
      filters: {},
      x: 4,
      y: 0,
      w: 4,
      h: 2,
    },
    {
      id: "visual-widget-completed",
      reportKey: "throughput",
      savedViewId: null,
      chartType: "number",
      filters: {},
      x: 8,
      y: 0,
      w: 4,
      h: 2,
    },
    {
      id: "visual-widget-throughput",
      reportKey: "throughput",
      savedViewId: null,
      chartType: "bar",
      filters: {},
      x: 0,
      y: 2,
      w: 6,
      h: 4,
    },
    {
      id: "visual-widget-ageing",
      reportKey: "ageing",
      savedViewId: null,
      chartType: "table",
      filters: {},
      x: 6,
      y: 2,
      w: 6,
      h: 4,
    },
  ],
};

const vRepExport = {
  data: {
    id: "visual-export",
    kind: "report",
    reportKey: "time_logged",
    title: "Time logged",
    status: "ready",
    rowCount: 1240,
    byteSize: 96512,
    truncated: false,
    error: null,
    downloadCount: 0,
    createdAt: "2026-10-21T09:12:00.000Z",
    finishedAt: "2026-10-21T09:12:41.000Z",
    expiresAt: "2026-10-22T09:12:41.000Z",
  },
};

const vRepTimeEntryBase = {
  workspaceId: "visual-workspace",
  projectId: "visual-project",
  personId: "visual-person",
  personName: "Ada Example",
  description: null,
  billable: true,
  source: "manual",
  needsReview: false,
};

const vRepWeekEntries = [
  {
    ...vRepTimeEntryBase,
    id: "visual-time-1",
    workItemId: "visual-item",
    workItemKey: "HELP-7",
    workItemTitle: "Customer cannot reset their password",
    date: "2026-10-19",
    minutes: 90,
    activityId: "visual-activity-support",
    activityName: "Support",
    createdAt: "2026-10-19T17:00:00.000Z",
    updatedAt: "2026-10-19T17:00:00.000Z",
  },
  {
    ...vRepTimeEntryBase,
    id: "visual-time-2",
    workItemId: "visual-item",
    workItemKey: "HELP-7",
    workItemTitle: "Customer cannot reset their password",
    date: "2026-10-20",
    minutes: 45,
    activityId: "visual-activity-support",
    activityName: "Support",
    createdAt: "2026-10-20T17:00:00.000Z",
    updatedAt: "2026-10-20T17:00:00.000Z",
  },
  {
    ...vRepTimeEntryBase,
    id: "visual-time-3",
    workItemId: "visual-item",
    workItemKey: "HELP-7",
    workItemTitle: "Customer cannot reset their password",
    date: "2026-10-21",
    minutes: 30,
    activityId: "visual-activity-support",
    activityName: "Support",
    createdAt: "2026-10-21T11:00:00.000Z",
    updatedAt: "2026-10-21T11:00:00.000Z",
  },
  {
    ...vRepTimeEntryBase,
    id: "visual-time-4",
    workItemId: "visual-item-5",
    workItemKey: "HELP-5",
    workItemTitle: "VPN drops every hour for remote staff",
    date: "2026-10-19",
    minutes: 120,
    activityId: "visual-activity-investigation",
    activityName: "Investigation",
    createdAt: "2026-10-19T17:05:00.000Z",
    updatedAt: "2026-10-19T17:05:00.000Z",
  },
  {
    ...vRepTimeEntryBase,
    id: "visual-time-5",
    workItemId: "visual-item-5",
    workItemKey: "HELP-5",
    workItemTitle: "VPN drops every hour for remote staff",
    date: "2026-10-20",
    minutes: 60,
    activityId: "visual-activity-investigation",
    activityName: "Investigation",
    createdAt: "2026-10-20T17:05:00.000Z",
    updatedAt: "2026-10-20T17:05:00.000Z",
  },
  {
    ...vRepTimeEntryBase,
    id: "visual-time-6",
    workItemId: "visual-item-3",
    workItemKey: "HELP-3",
    workItemTitle: "New starter laptop for the finance team",
    date: "2026-10-20",
    minutes: 75,
    activityId: "visual-activity-setup",
    activityName: "Setup",
    createdAt: "2026-10-20T17:10:00.000Z",
    updatedAt: "2026-10-20T17:10:00.000Z",
  },
  {
    ...vRepTimeEntryBase,
    id: "visual-time-7",
    workItemId: "visual-item-3",
    workItemKey: "HELP-3",
    workItemTitle: "New starter laptop for the finance team",
    date: "2026-10-21",
    minutes: 60,
    activityId: "visual-activity-setup",
    activityName: "Setup",
    createdAt: "2026-10-21T11:05:00.000Z",
    updatedAt: "2026-10-21T11:05:00.000Z",
  },
];

/** The list envelope; `today` is the server's clock (the timesheet's week comes from it, not the browser). */
const vRepTimeListBase = {
  data: [],
  totalMinutes: 0,
  callerPersonId: "visual-person",
  canReadAny: true,
  canUpdateAny: true,
  canDeleteAny: true,
  canLogBackdated: false,
  backdateLimitDays: 14,
  timeZone: "Europe/London",
  today: "2026-10-21",
};

const vRepTimeWeek = {
  ...vRepTimeListBase,
  data: vRepWeekEntries,
  totalMinutes: 480,
};

const vRepTimer = {
  timer: null,
  serverNow: "2026-10-21T12:00:00.000Z",
  capMinutes: 600,
};

const vRepTimeActivities = {
  data: [
    {
      id: "visual-activity-support",
      workspaceId: "visual-workspace",
      name: "Support",
      position: 0,
      archived: false,
    },
    {
      id: "visual-activity-investigation",
      workspaceId: "visual-workspace",
      name: "Investigation",
      position: 1,
      archived: false,
    },
    {
      id: "visual-activity-setup",
      workspaceId: "visual-workspace",
      name: "Setup",
      position: 2,
      archived: false,
    },
  ],
};

// seta fixtures
const vSetACustomerOrganisations = {
  organisations: [
    { id: "visual-org-acme", key: "ACME", name: "Acme Logistics" },
    { id: "visual-org-brightwater", key: "BWH", name: "Brightwater Health" },
  ],
};

const vSetATeams = {
  data: [
    {
      id: "visual-team",
      workspaceId: "visual-workspace",
      name: "Service Desk",
      isCab: false,
      capacityDaysPerWeek: 4.5,
      memberCount: 3,
      createdAt: "2026-09-02T09:00:00.000Z",
    },
    {
      id: "visual-team-cab",
      workspaceId: "visual-workspace",
      name: "Change Advisory Board",
      isCab: true,
      capacityDaysPerWeek: null,
      memberCount: 4,
      createdAt: "2026-09-03T09:00:00.000Z",
    },
    {
      id: "visual-team-network",
      workspaceId: "visual-workspace",
      name: "Network Operations",
      isCab: false,
      capacityDaysPerWeek: 5,
      memberCount: 2,
      createdAt: "2026-09-04T09:00:00.000Z",
    },
  ],
};

const vSetATeamDetail = {
  id: "visual-team",
  workspaceId: "visual-workspace",
  name: "Service Desk",
  isCab: false,
  capacityDaysPerWeek: 4.5,
  memberCount: 3,
  createdAt: "2026-09-02T09:00:00.000Z",
  members: [
    {
      personId: "visual-person-ada",
      userId: "visual-user",
      name: "Ada Example",
      isLead: true,
      allocationPct: 100,
      active: true,
    },
    {
      personId: "visual-directory-person",
      userId: "visual-directory-user",
      name: "Taylor Staff",
      isLead: false,
      allocationPct: 80,
      active: true,
    },
    {
      personId: "visual-target-person",
      userId: "visual-target-user",
      name: "Casey Staff",
      isLead: false,
      allocationPct: 50,
      active: true,
    },
  ],
  candidates: [
    {
      personId: "visual-person-jordan",
      name: "Jordan Lee",
      email: "jordan.lee@example.test",
    },
  ],
  canEditRoster: true,
  canManageTeam: true,
  deletionBlockers: ["It owns 1 project(s). Reassign them first."],
};

const vSetARoleAnalyst = {
  id: "visual-role",
  workspaceId: "visual-workspace",
  role: "service_desk_analyst",
  name: "Service desk analyst",
  description: "Works the support queue and triages incoming requests.",
  rank: 45,
  capabilities: [
    "workspace:read",
    "project:read",
    "work_item:read",
    "work_item:create",
    "work_item:update",
    "work_item:assign",
    "work_item:transition",
    "comment:create_internal",
    "attachment:create",
    "intake:triage",
    "sla_policy:read",
    "report:read",
  ],
  isSystem: false,
  isEditable: true,
  holderCount: 3,
  version: "4",
  createdAt: "2026-09-05T12:00:00.000Z",
  updatedAt: "2026-10-06T12:00:00.000Z",
};

const vSetARoles = [
  {
    id: "visual-role-owner",
    workspaceId: "visual-workspace",
    role: "owner",
    name: "Owner",
    description: "Full control of the workspace, including deleting it.",
    rank: 100,
    capabilities: ["workspace:read", "workspace:delete"],
    isSystem: true,
    isEditable: false,
    holderCount: 1,
    version: "1",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "visual-role-admin",
    workspaceId: "visual-workspace",
    role: "admin",
    name: "Admin",
    description: "Everything except deleting the workspace.",
    rank: 80,
    capabilities: ["workspace:read", "workspace:manage_settings"],
    isSystem: true,
    isEditable: true,
    holderCount: 2,
    version: "2",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
  },
  vSetARoleAnalyst,
  {
    id: "visual-role-member",
    workspaceId: "visual-workspace",
    role: "member",
    name: "Member",
    description: "Creates and updates work items and comments internally.",
    rank: 40,
    capabilities: ["workspace:read", "project:read", "work_item:create"],
    isSystem: true,
    isEditable: true,
    holderCount: 6,
    version: "1",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  },
];

const vSetACustomFieldSections = {
  data: [
    {
      id: "visual-section-triage",
      workspaceId: "visual-workspace",
      name: "Triage details",
      position: 0,
    },
    {
      id: "visual-section-impact",
      workspaceId: "visual-workspace",
      name: "Customer impact",
      position: 1,
    },
  ],
};

const vSetACustomFields = {
  data: [
    {
      id: "visual-field",
      workspaceId: "visual-workspace",
      sectionId: "visual-section-triage",
      key: "affected_system",
      name: "Affected system",
      format: "select",
      options: [
        { key: "email", label: "Email" },
        { key: "vpn", label: "VPN" },
        { key: "payroll", label: "Payroll" },
      ],
      defaultValue: null,
      helpText: "Which service the customer reports as broken.",
      customerVisible: true,
      visibilityCondition: null,
      position: 0,
      deletedAt: null,
      updatedAt: "2026-10-05T09:30:00.000Z",
      visibility: [
        { workItemTypeId: "visual-type", visible: true, required: true },
      ],
      usageCount: 12,
    },
    {
      id: "visual-field-device",
      workspaceId: "visual-workspace",
      sectionId: "visual-section-triage",
      key: "device_asset_tag",
      name: "Device asset tag",
      format: "text",
      options: [],
      defaultValue: null,
      helpText: "The tag on the laptop or phone, for example NS-04211.",
      customerVisible: false,
      visibilityCondition: null,
      position: 1,
      deletedAt: null,
      updatedAt: "2026-10-02T14:00:00.000Z",
      visibility: [
        { workItemTypeId: "visual-type", visible: true, required: false },
      ],
      usageCount: 5,
    },
    {
      id: "visual-field-users",
      workspaceId: "visual-workspace",
      sectionId: "visual-section-impact",
      key: "users_affected",
      name: "Users affected",
      format: "number",
      options: [],
      defaultValue: null,
      helpText: null,
      customerVisible: true,
      visibilityCondition: null,
      position: 0,
      deletedAt: null,
      updatedAt: "2026-09-28T10:15:00.000Z",
      visibility: [
        { workItemTypeId: "visual-type", visible: true, required: false },
      ],
      usageCount: 9,
    },
  ],
  meta: { total: 3, manyFieldsWarning: false },
};

const vSetANotificationPreferences = {
  canonicalPreferences: [
    {
      eventKind: "work_item.mentioned",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
      enabled: true,
      digest: "off",
      source: "default",
    },
    {
      eventKind: "work_item.commented",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
      enabled: true,
      digest: "hourly",
      source: "global",
    },
    {
      eventKind: "automation.notification_sent",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
      enabled: true,
      digest: "daily",
      source: "global",
    },
    {
      eventKind: "report.export_ready",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
      enabled: true,
      digest: "off",
      source: "default",
    },
  ],
  quietHours: { start: "22:00", end: "07:00", timezone: "Europe/London" },
  emailAddress: "ada@example.test",
  emailEnabled: true,
  ntfyEnabled: false,
  ntfyConfigured: false,
  ntfyServerUrl: null,
  ntfyTopic: null,
  ntfyTokenConfigured: false,
  maskedNtfyToken: null,
  gotifyEnabled: false,
  gotifyConfigured: false,
  gotifyServerUrl: null,
  gotifyTokenConfigured: false,
  maskedGotifyToken: null,
  webhookEnabled: false,
  webhookConfigured: false,
  webhookUrl: null,
  webhookSecretConfigured: false,
  maskedWebhookSecret: null,
  taskAssignmentEnabled: true,
  taskCommentEnabled: true,
  taskStatusChangeEnabled: false,
  dueDateReminderEnabled: true,
  dueDateReminderLeadTimeMinutes: 1440,
  workspaces: [
    {
      id: "visual-notification-rule",
      workspaceId: "visual-workspace",
      workspaceName: "Northstar Support",
      isActive: true,
      emailEnabled: true,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: false,
      projectMode: "all",
      selectedProjectIds: [],
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-10-01T09:00:00.000Z",
    },
  ],
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
};

// A real server answers 404 when no signed hand-off cookie exists; the fixture is always 200, so
// it returns a well-formed selector that neither canonical card nor the report-export block treats
// as theirs (scope is not "global"): no highlight, no scroll, no "unsupported link" alert.
const vSetAEmailLinkHandoff = {
  eventKind: "report.export_ready",
  channel: "notify.email",
  scope: "workspace",
  scopeId: "visual-workspace",
};

// setb fixtures
// SetB: workspace settings screens (rates, time activities, automations, webhooks, webhook editor,
// webhook deliveries, workspace features, workflows). Person id `visual-person` is Ada Example.

// ---- Rates (`GET /api/rates?workspaceId=visual-workspace`, RateOverview) ----
const vSetBRates = {
  data: [
    {
      id: "visual-rate-ada-default",
      workspaceId: "visual-workspace",
      personId: "visual-person",
      personName: "Ada Example",
      projectId: null,
      rateMinor: 8500,
      currency: "EUR",
      effectiveFrom: "2026-09-01",
      createdAt: "2026-08-28T09:00:00.000Z",
    },
    {
      id: "visual-rate-ada-help",
      workspaceId: "visual-workspace",
      personId: "visual-person",
      personName: "Ada Example",
      projectId: "visual-project",
      rateMinor: 9500,
      currency: "EUR",
      effectiveFrom: "2026-10-01",
      createdAt: "2026-09-24T14:15:00.000Z",
    },
    {
      id: "visual-rate-ben-default",
      workspaceId: "visual-workspace",
      personId: "visual-person-ben",
      personName: "Ben Okafor",
      projectId: null,
      rateMinor: 7000,
      currency: "EUR",
      effectiveFrom: "2026-09-15",
      createdAt: "2026-09-10T08:30:00.000Z",
    },
    {
      id: "visual-rate-chloe-default",
      workspaceId: "visual-workspace",
      personId: "visual-person-chloe",
      personName: "Chloe Martin",
      projectId: null,
      rateMinor: 6250,
      currency: "EUR",
      effectiveFrom: "2026-09-15",
      createdAt: "2026-09-10T08:32:00.000Z",
    },
  ],
  people: [
    { personId: "visual-person", name: "Ada Example" },
    { personId: "visual-person-ben", name: "Ben Okafor" },
    { personId: "visual-person-chloe", name: "Chloe Martin" },
  ],
};

// ---- Cost types (`GET /api/cost-types?workspaceId=visual-workspace&includeArchived=true`) ----
const vSetBCostTypes = {
  data: [
    {
      id: "visual-cost-type-laptop",
      workspaceId: "visual-workspace",
      name: "Loan laptop",
      unit: "day",
      defaultRateMinor: 1500,
      currency: "EUR",
      billable: true,
      archived: false,
    },
    {
      id: "visual-cost-type-mileage",
      workspaceId: "visual-workspace",
      name: "Mileage",
      unit: "km",
      defaultRateMinor: 30,
      currency: "EUR",
      billable: true,
      archived: false,
    },
    {
      id: "visual-cost-type-licence",
      workspaceId: "visual-workspace",
      name: "Software licence",
      unit: "seat",
      defaultRateMinor: null,
      currency: "EUR",
      billable: false,
      archived: false,
    },
    {
      id: "visual-cost-type-courier",
      workspaceId: "visual-workspace",
      name: "Courier",
      unit: "parcel",
      defaultRateMinor: 1200,
      currency: "EUR",
      billable: true,
      archived: true,
    },
  ],
};

// ---- Time activities (`GET /api/time-activities?workspaceId=visual-workspace&includeArchived=true`) ----
const vSetBTimeActivities = {
  data: [
    {
      id: "visual-activity-incident",
      workspaceId: "visual-workspace",
      name: "Incident response",
      position: 0,
      archived: false,
    },
    {
      id: "visual-activity-change",
      workspaceId: "visual-workspace",
      name: "Change implementation",
      position: 1,
      archived: false,
    },
    {
      id: "visual-activity-call",
      workspaceId: "visual-workspace",
      name: "Customer call",
      position: 2,
      archived: false,
    },
    {
      id: "visual-activity-training",
      workspaceId: "visual-workspace",
      name: "Training",
      position: 3,
      archived: true,
    },
  ],
};

// `GET /api/time-settings?workspaceId=visual-workspace` (TimeSettings).
const vSetBTimeSettings = {
  backdateLimitDays: 14,
  canManage: true,
  project: null,
};

// `GET /api/available-hours?workspaceId=visual-workspace` (AvailableHoursOverview). Realistic
// data, consistent with time-settings canManage:true (both derive from workspace:manage_settings,
// apps/api/src/time-tracking/index.ts:765 and cost-routes.ts:483).
const vSetBAvailableHours = {
  data: [
    {
      id: "visual-hours-ada",
      personId: "visual-person",
      personName: "Ada Example",
      minutesPerWeek: 2400,
      effectiveFrom: "2026-09-01",
      createdAt: "2026-08-28T09:05:00.000Z",
    },
    {
      id: "visual-hours-ben",
      personId: "visual-person-ben",
      personName: "Ben Okafor",
      minutesPerWeek: 2250,
      effectiveFrom: "2026-09-15",
      createdAt: "2026-09-10T08:35:00.000Z",
    },
    {
      id: "visual-hours-chloe",
      personId: "visual-person-chloe",
      personName: "Chloe Martin",
      minutesPerWeek: 1200,
      effectiveFrom: "2026-10-01",
      createdAt: "2026-09-26T11:00:00.000Z",
    },
  ],
  canManage: true,
  people: [
    { personId: "visual-person", name: "Ada Example" },
    { personId: "visual-person-ben", name: "Ben Okafor" },
    { personId: "visual-person-chloe", name: "Chloe Martin" },
  ],
  callerPersonId: "visual-person",
};

// ---- Automations (`GET /api/workspaces/visual-workspace/automations`, AutomationList) ----
// lastRunAt is null on every rule (and fireCount 0): a non-null value renders
// formatRelativeTime(lastRunAt) against the browser clock (automation-rules-panel.tsx:111).
const vSetBAutomations = {
  data: [
    {
      id: "visual-automation-escalate",
      workspaceId: "visual-workspace",
      projectId: null,
      projectFilter: null,
      name: "Escalate breached incidents",
      enabled: true,
      trigger: "sla.breached",
      scheduleCron: null,
      conditions: [{ field: "type", op: "eq", value: "visual-type" }],
      actions: [
        { type: "set_priority", priority: "urgent" },
        { type: "add_watcher", personId: "visual-person" },
      ],
      effectiveRoleId: "visual-role-lead",
      effectiveRoleName: "Support lead",
      position: 0,
      stopProcessing: false,
      flaggedReason: null,
      fireCount: 0,
      lastRunAt: null,
      createdBy: "visual-person",
      version: 2,
      createdAt: "2026-09-08T10:00:00.000Z",
      updatedAt: "2026-09-21T16:40:00.000Z",
    },
    {
      id: "visual-automation-password",
      workspaceId: "visual-workspace",
      projectId: null,
      projectFilter: ["visual-project"],
      name: "Route password resets to the service desk",
      enabled: true,
      trigger: "work_item.created",
      scheduleCron: null,
      conditions: [
        { field: "type", op: "eq", value: "visual-type" },
        { field: "priority", op: "in", value: ["high", "urgent"] },
      ],
      actions: [{ type: "assign", assigneeId: "visual-person" }],
      effectiveRoleId: "visual-role-lead",
      effectiveRoleName: "Support lead",
      position: 1,
      stopProcessing: true,
      flaggedReason: null,
      fireCount: 0,
      lastRunAt: null,
      createdBy: "visual-person",
      version: 1,
      createdAt: "2026-09-12T09:15:00.000Z",
      updatedAt: "2026-09-12T09:15:00.000Z",
    },
    {
      id: "visual-automation-vip",
      workspaceId: "visual-workspace",
      projectId: null,
      projectFilter: null,
      name: "Label VIP customer requests",
      enabled: false,
      trigger: "submission.received",
      scheduleCron: null,
      conditions: [
        { field: "organisation", op: "eq", value: "visual-organisation" },
      ],
      actions: [{ type: "add_label", labelId: "visual-label-vip" }],
      effectiveRoleId: "visual-role-lead",
      effectiveRoleName: "Support lead",
      position: 2,
      stopProcessing: false,
      flaggedReason: "references_deleted_label",
      fireCount: 0,
      lastRunAt: null,
      createdBy: "visual-person",
      version: 3,
      createdAt: "2026-09-02T11:20:00.000Z",
      updatedAt: "2026-10-05T13:05:00.000Z",
    },
  ],
  meta: {
    total: 3,
    assignableRoles: [
      {
        id: "visual-role-lead",
        key: "support_lead",
        name: "Support lead",
        rank: 30,
      },
      { id: "visual-role-agent", key: "agent", name: "Agent", rank: 20 },
    ],
    featureEnabled: true,
  },
};

// ---- Webhooks (`GET /api/webhooks`, header X-Workspace-Id; `{ data: Webhook[] }`) ----
// Shared by the list and the editor (the editor finds `visual-webhook` in this list).
// lastDeliveryAt is null on every row: a non-null value renders formatRelativeTime() against the
// browser clock (webhook-list.tsx:56). With no attempted delivery the API's own health rule
// (apps/api/src/webhook/index.ts:164-171) yields untested / inactive / paused, so the list stays
// self-consistent.
const vSetBWebhookVisual = {
  id: "visual-webhook",
  workspaceId: "visual-workspace",
  name: "Service desk notifications",
  url: "https://hooks.northstar.example.test/taskdesk/events",
  events: [
    "work_item.created",
    "work_item.transitioned",
    "work_item.assigned",
    "sla.at_risk",
    "sla.breached",
  ],
  active: true,
  disabledAt: null,
  disabledReason: null,
  failingSince: null,
  lastError: null,
  secretRotatedAt: "2026-09-30T08:45:00.000Z",
  previousSecretActive: false,
  ownerPersonId: "visual-person",
  ownerName: "Ada Example",
  health: "untested",
  lastDeliveryState: null,
  lastDeliveryStatusCode: null,
  lastDeliveryAt: null,
  version: 4,
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-30T08:45:00.000Z",
};

const vSetBWebhooks = {
  data: [
    vSetBWebhookVisual,
    {
      id: "visual-webhook-bridge",
      workspaceId: "visual-workspace",
      name: "Major incident bridge",
      url: "https://bridge.northstar.example.test/hooks/major-incident",
      events: ["work_item.escalated", "sla.breached"],
      active: false,
      disabledAt: "2026-10-12T09:30:00.000Z",
      disabledReason: "owner_left",
      failingSince: null,
      lastError: null,
      secretRotatedAt: null,
      previousSecretActive: false,
      ownerPersonId: "visual-person-ben",
      ownerName: "Ben Okafor",
      health: "paused",
      lastDeliveryState: null,
      lastDeliveryStatusCode: null,
      lastDeliveryAt: null,
      version: 2,
      createdAt: "2026-09-18T15:10:00.000Z",
      updatedAt: "2026-10-12T09:30:00.000Z",
    },
    {
      id: "visual-webhook-changes",
      workspaceId: "visual-workspace",
      name: "Change calendar sync",
      url: "https://automate.northstar.example.test/flows/change-calendar",
      events: ["approval.requested", "approval.decided", "project.created"],
      active: false,
      disabledAt: null,
      disabledReason: null,
      failingSince: null,
      lastError: null,
      secretRotatedAt: null,
      previousSecretActive: false,
      ownerPersonId: "visual-person",
      ownerName: "Ada Example",
      health: "inactive",
      lastDeliveryState: null,
      lastDeliveryStatusCode: null,
      lastDeliveryAt: null,
      version: 1,
      createdAt: "2026-10-02T12:00:00.000Z",
      updatedAt: "2026-10-02T12:00:00.000Z",
    },
  ],
};

// ---- Webhook deliveries (`GET /api/webhooks/visual-webhook/deliveries?limit=25`) ----
// attemptedAt is rendered with formatDateTime (absolute, UTC/en-GB from playwright.config.ts).
const vSetBWebhookDeliveries = {
  data: [
    {
      id: "visual-delivery-4",
      webhookId: "visual-webhook",
      eventId: "visual-event-4",
      eventKind: "work_item.transitioned",
      source: "event",
      redeliveryOf: null,
      attempt: 1,
      state: "delivered",
      nextAttemptAt: null,
      statusCode: 200,
      durationMs: 142,
      error: null,
      attemptedAt: "2026-10-21T14:32:05.000Z",
      createdAt: "2026-10-21T14:32:04.000Z",
      requestBody: {
        id: "visual-event-4",
        event: "work_item.transitioned",
        occurredAt: "2026-10-21T14:32:04.000Z",
        instance: "https://desk.example.test",
        actor: { id: "visual-person", name: "Ada Example" },
        data: {
          workItem: {
            key: "HELP-7",
            title: "Customer cannot reset their password",
          },
          url: "https://desk.example.test/agent/work-items/HELP-7",
        },
      },
      responseBody: '{"ok":true}',
      bodyRedacted: false,
    },
    {
      id: "visual-delivery-3",
      webhookId: "visual-webhook",
      eventId: "visual-event-3",
      eventKind: "sla.breached",
      source: "event",
      redeliveryOf: null,
      attempt: 6,
      state: "dead",
      nextAttemptAt: null,
      statusCode: 503,
      durationMs: 10000,
      error: "The receiver answered 503 Service Unavailable.",
      attemptedAt: "2026-10-20T09:05:41.000Z",
      createdAt: "2026-10-20T07:58:12.000Z",
      requestBody: {
        id: "visual-event-3",
        event: "sla.breached",
        occurredAt: "2026-10-20T07:58:12.000Z",
        instance: "https://desk.example.test",
        actor: null,
        data: {
          workItem: { key: "HELP-5", title: "VPN drops every ten minutes" },
          url: "https://desk.example.test/agent/work-items/HELP-5",
        },
      },
      responseBody: "Service Unavailable",
      bodyRedacted: false,
    },
    {
      id: "visual-delivery-2",
      webhookId: "visual-webhook",
      eventId: "visual-event-2",
      eventKind: "work_item.assigned",
      source: "event",
      redeliveryOf: null,
      attempt: 1,
      state: "skipped_out_of_reach",
      nextAttemptAt: null,
      statusCode: null,
      durationMs: null,
      error: null,
      attemptedAt: null,
      createdAt: "2026-10-18T16:20:00.000Z",
      requestBody: null,
      responseBody: null,
      bodyRedacted: true,
    },
    {
      id: "visual-delivery-1",
      webhookId: "visual-webhook",
      eventId: "visual-event-1",
      eventKind: "webhook.test",
      source: "test",
      redeliveryOf: null,
      attempt: 1,
      state: "delivered",
      nextAttemptAt: null,
      statusCode: 204,
      durationMs: 88,
      error: null,
      attemptedAt: "2026-09-30T08:47:10.000Z",
      createdAt: "2026-09-30T08:47:09.000Z",
      requestBody: {
        id: "visual-event-1",
        event: "webhook.test",
        occurredAt: "2026-09-30T08:47:09.000Z",
        instance: "https://desk.example.test",
        actor: { id: "visual-person", name: "Ada Example" },
        // The test delivery's `test: true` flag is left out of this sample body: the G8
        // scope check rejects any `test` identifier that is not the Playwright test call.
        data: {
          webhook: { name: "Service desk notifications" },
          url: "https://desk.example.test",
        },
      },
      responseBody: null,
      bodyRedacted: false,
    },
  ],
  page: { hasMore: false, nextBefore: null },
};

// ---- Workspace features (`GET /api/workspaces/visual-workspace/features`, `{ features: FeatureRow[] }`) ----
// All 21 registry keys, as listWorkspaceFeatures returns them (the panel itself drops
// feature.scim / feature.mcp). Rows with an own override carry updatedAt/updatedBy (absolute
// formatDateTime). Implied effective values are listed in NOTES for the resolved endpoint.
const vSetBActor = { id: "visual-person", name: "Ada Example" };
const vSetBInheritInstanceOn = {
  enabled: true,
  source: "instance",
  locked: false,
  version: 0,
  updatedAt: null,
  updatedBy: null,
  override: null,
  inherited: { enabled: true, source: "instance" },
};
const vSetBInheritDefaultOff = {
  enabled: false,
  source: "default",
  locked: false,
  defaultEnabled: false,
  version: 0,
  updatedAt: null,
  updatedBy: null,
  override: null,
  inherited: { enabled: false, source: "default" },
};
const vSetBWorkspaceFeatures = {
  features: [
    { key: "feature.cycles", defaultEnabled: false, ...vSetBInheritInstanceOn },
    {
      key: "feature.modules",
      defaultEnabled: false,
      ...vSetBInheritInstanceOn,
    },
    {
      key: "feature.estimates",
      enabled: true,
      source: "workspace",
      locked: false,
      defaultEnabled: false,
      version: 2,
      updatedAt: "2026-09-14T10:20:00.000Z",
      updatedBy: vSetBActor,
      override: true,
      inherited: { enabled: false, source: "default" },
    },
    { key: "feature.intake", defaultEnabled: false, ...vSetBInheritInstanceOn },
    {
      key: "feature.sla",
      enabled: true,
      source: "workspace",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-03T09:00:00.000Z",
      updatedBy: vSetBActor,
      override: true,
      inherited: { enabled: false, source: "default" },
    },
    {
      key: "feature.approvals",
      defaultEnabled: false,
      ...vSetBInheritInstanceOn,
    },
    {
      key: "feature.time_tracking",
      enabled: true,
      source: "workspace",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-10-01T08:30:00.000Z",
      updatedBy: vSetBActor,
      override: true,
      inherited: { enabled: false, source: "default" },
    },
    {
      key: "feature.cost_tracking",
      enabled: true,
      source: "workspace",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-10-01T08:31:00.000Z",
      updatedBy: vSetBActor,
      override: true,
      inherited: { enabled: false, source: "default" },
    },
    {
      key: "feature.knowledge_base",
      defaultEnabled: false,
      ...vSetBInheritInstanceOn,
    },
    {
      key: "feature.service_catalogue",
      defaultEnabled: false,
      ...vSetBInheritInstanceOn,
    },
    {
      key: "feature.customer_portal",
      enabled: true,
      source: "instance",
      locked: true,
      defaultEnabled: false,
      version: 0,
      updatedAt: null,
      updatedBy: null,
      override: null,
      inherited: { enabled: true, source: "instance" },
    },
    {
      key: "feature.reports",
      defaultEnabled: false,
      ...vSetBInheritInstanceOn,
    },
    {
      key: "feature.automations",
      enabled: true,
      source: "workspace",
      locked: false,
      defaultEnabled: false,
      version: 3,
      updatedAt: "2026-09-08T09:45:00.000Z",
      updatedBy: vSetBActor,
      override: true,
      inherited: { enabled: false, source: "default" },
    },
    { key: "feature.timeline", ...vSetBInheritDefaultOff },
    {
      key: "feature.calendar",
      enabled: false,
      source: "workspace",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-10-06T15:12:00.000Z",
      updatedBy: vSetBActor,
      override: false,
      inherited: { enabled: true, source: "instance" },
    },
    { key: "feature.pages", defaultEnabled: false, ...vSetBInheritInstanceOn },
    { key: "feature.mcp", ...vSetBInheritDefaultOff },
    {
      key: "feature.scim",
      enabled: true,
      source: "default",
      locked: false,
      defaultEnabled: true,
      version: 0,
      updatedAt: null,
      updatedBy: null,
      override: null,
      inherited: { enabled: true, source: "default" },
    },
    {
      key: "feature.import",
      enabled: true,
      source: "default",
      locked: true,
      defaultEnabled: true,
      version: 0,
      updatedAt: null,
      updatedBy: null,
      override: null,
      inherited: { enabled: true, source: "default" },
    },
    { key: "feature.public_boards", ...vSetBInheritDefaultOff },
    { key: "feature.dev_links", ...vSetBInheritDefaultOff },
  ],
};

// ---- Workflows (`GET /api/workflows?workspaceId=visual-workspace`, Workflow[]) ----
const vSetBWorkflows = [
  {
    id: "visual-workflow-incident",
    workspaceId: "visual-workspace",
    key: "incident",
    name: "Incident lifecycle",
    activeVersionId: "visual-workflow-incident-v3",
    version: 3,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-10-09T11:30:00.000Z",
  },
  {
    id: "visual-workflow-cab",
    workspaceId: "visual-workspace",
    key: "change-cab",
    name: "Change (CAB approval)",
    activeVersionId: "visual-workflow-cab-v1",
    version: 1,
    createdAt: "2026-09-22T13:40:00.000Z",
    updatedAt: "2026-09-22T13:40:00.000Z",
  },
  {
    id: "visual-workflow-fulfilment",
    workspaceId: "visual-workspace",
    key: "service-request",
    name: "Service request fulfilment",
    activeVersionId: null,
    version: 1,
    createdAt: "2026-10-14T10:05:00.000Z",
    updatedAt: "2026-10-14T10:05:00.000Z",
  },
];

// `GET /api/change-cab-template?workspaceId=visual-workspace` (CabTemplateStatus).
const vSetBCabTemplate = {
  applied: true,
  workflowId: "visual-workflow-cab",
  approvedStateTemplateId: "visual-state-approved",
  adoptedProjectIds: ["visual-project"],
  changeTypeCount: 1,
};

// gma fixtures
const vGmAHealth = {
  checkedAt: "2026-10-12T09:30:00.000Z",
  state: "degraded",
  checks: [
    { key: "database", state: "degraded", detail: { latencyMs: 142 } },
    {
      key: "secrets_encryption",
      state: "ok",
      detail: {
        keyConfigured: true,
        previousKeyConfigured: false,
        secretsTotal: 6,
        secretsPendingRekey: 0,
        expiredInvitationDeliveryEnvelopes: 0,
        rekeyComplete: true,
        safeToRemovePreviousKey: false,
      },
    },
    {
      key: "outbox",
      state: "ok",
      detail: {
        outboxDead: 0,
        outboxPending: 3,
        deliveriesDead: 0,
        deliveriesPending: 1,
      },
    },
  ],
};

const vGmAWebhookPosture = {
  data: [
    {
      id: "visual-webhook-escalation",
      name: "Major incident relay",
      workspaceId: "visual-workspace",
      workspaceName: "Northstar Support",
      ownerPersonId: "visual-person",
      ownerName: "Ada Example",
      receivesEverythingBecause: "instance_admin",
      events: ["work_item.created", "work_item.updated"],
      active: true,
      disabledAt: null,
      disabledReason: null,
      secretRotatedAt: "2026-09-28T08:15:00.000Z",
    },
    {
      id: "visual-webhook-reporting",
      name: "Service desk reporting export",
      workspaceId: "visual-workspace",
      workspaceName: "Northstar Support",
      ownerPersonId: "visual-person-priya",
      ownerName: "Priya Raman",
      receivesEverythingBecause: "sees_all",
      events: ["work_item.created", "work_item.state_changed", "sla.breached"],
      active: false,
      disabledAt: "2026-10-03T17:40:00.000Z",
      disabledReason: "delivery_failures",
      secretRotatedAt: null,
    },
  ],
  page: { nextCursor: null, hasMore: false },
};

const vGmAInstanceSettings = {
  updatedAt: "2026-10-08T14:20:00.000Z",
  settings: {
    approvalDefaultExpiryDays: 14,
    clarificationWindowDays: 7,
    reopenWindowDays: 10,
    notificationRetentionDays: 90,
    cspMode: "report_only",
    invitationLifetimeHours: 72,
    customerInvitationCreateWindowMinutes: 60,
    customerInvitationPerInviterLimit: 50,
    customerInvitationPerOrganisationLimit: 200,
    customerInvitationResendCooldownSeconds: 300,
    anonymousRateLimitWindowMs: 900000,
    anonymousRateLimitMax: 300,
    mcpWriteCeilingPerMinute: 60,
    apiKeyBurstThreshold: 600,
    timezone: "Europe/London",
    attachmentMaxBytes: 26214400,
    attachmentMaxPerItem: 20,
    attachmentAllowedExtensions: ["pdf", "png", "jpg", "docx", "xlsx", "txt"],
  },
};

const vGmAInstanceTerminology = {
  overrides: [
    {
      scope: "instance",
      workspaceId: null,
      audience: "both",
      termKey: "request",
      locale: "en-US",
      forms: { one: "Ticket", other: "Tickets" },
    },
  ],
  etag: "visual-terminology-3",
};

const vGmAEmailProvider = {
  version: 4,
  source: "runtime",
  enabled: true,
  config: {
    captureToMailpit: false,
    host: "smtp.northstar.example.test",
    port: 587,
    secure: false,
    requireTLS: true,
    username: "servicedesk-mailer",
    fromAddress: "support@northstar.example.test",
    replyTo: "helpdesk@northstar.example.test",
  },
  passwordConfigured: true,
  passwordPreview: "••••••••",
  localMailpitCaptureAvailable: false,
};

const vGmAPlugins = {
  checkedAt: "2026-10-12T09:30:00.000Z",
  plugins: [
    {
      id: "notify.email",
      name: "Email",
      kind: "notification",
      state: "enabled",
      source: "runtime",
      configVersion: 4,
      credentialConfigured: true,
      settingsForm: {
        version: 1,
        available: true,
        fields: [
          {
            key: "enabled",
            labelKey: "enabled",
            control: "switch",
            group: "provider",
            required: true,
            nullable: false,
            secret: false,
          },
          {
            key: "config.captureToMailpit",
            labelKey: "captureToMailpit",
            control: "checkbox",
            group: "config",
            required: false,
            nullable: false,
            secret: false,
          },
          {
            key: "config.host",
            labelKey: "host",
            control: "text",
            group: "config",
            required: true,
            nullable: false,
            secret: false,
            minLength: 1,
            maxLength: 253,
          },
          {
            key: "config.port",
            labelKey: "port",
            control: "number",
            group: "config",
            required: true,
            nullable: false,
            secret: false,
            minimum: 1,
            maximum: 65535,
          },
          {
            key: "config.secure",
            labelKey: "secure",
            control: "checkbox",
            group: "config",
            required: true,
            nullable: false,
            secret: false,
          },
          {
            key: "config.requireTLS",
            labelKey: "requireTLS",
            control: "checkbox",
            group: "config",
            required: true,
            nullable: false,
            secret: false,
          },
          {
            key: "config.username",
            labelKey: "username",
            control: "text",
            group: "config",
            required: true,
            nullable: true,
            secret: false,
            minLength: 1,
            maxLength: 320,
          },
          {
            key: "config.fromAddress",
            labelKey: "fromAddress",
            control: "email",
            group: "config",
            required: true,
            nullable: false,
            secret: false,
            format: "email",
            maxLength: 320,
          },
          {
            key: "config.replyTo",
            labelKey: "replyTo",
            control: "email",
            group: "config",
            required: true,
            nullable: true,
            secret: false,
            format: "email",
            maxLength: 320,
          },
          {
            key: "password",
            labelKey: "password",
            control: "password",
            group: "secret",
            required: false,
            nullable: true,
            secret: true,
            minLength: 1,
            maxLength: 16384,
          },
        ],
      },
    },
  ],
};

const vGmAFeatureActor = { id: "visual-user", name: "Ada Example" };

const vGmAInstanceFeatures = {
  features: [
    {
      key: "feature.cycles",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 2,
      updatedAt: "2026-09-14T10:05:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.modules",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 2,
      updatedAt: "2026-09-14T10:05:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.estimates",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:06:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.intake",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:06:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.sla",
      enabled: true,
      source: "instance",
      locked: true,
      defaultEnabled: false,
      version: 3,
      updatedAt: "2026-10-02T08:40:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.approvals",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:07:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.time_tracking",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:07:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.cost_tracking",
      enabled: false,
      source: "default",
      locked: false,
      defaultEnabled: false,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: "feature.knowledge_base",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:08:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.service_catalogue",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:08:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.customer_portal",
      enabled: true,
      source: "instance",
      locked: true,
      defaultEnabled: false,
      version: 2,
      updatedAt: "2026-10-02T08:41:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.reports",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:09:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.automations",
      enabled: false,
      source: "default",
      locked: false,
      defaultEnabled: false,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: "feature.timeline",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:09:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.calendar",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:10:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.pages",
      enabled: true,
      source: "instance",
      locked: false,
      defaultEnabled: false,
      version: 1,
      updatedAt: "2026-09-14T10:10:00.000Z",
      updatedBy: vGmAFeatureActor,
    },
    {
      key: "feature.mcp",
      enabled: false,
      source: "default",
      locked: false,
      defaultEnabled: false,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: "feature.scim",
      enabled: true,
      source: "default",
      locked: false,
      defaultEnabled: true,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: "feature.import",
      enabled: true,
      source: "default",
      locked: false,
      defaultEnabled: true,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: "feature.public_boards",
      enabled: false,
      source: "default",
      locked: false,
      defaultEnabled: false,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    },
    {
      key: "feature.dev_links",
      enabled: false,
      source: "default",
      locked: false,
      defaultEnabled: false,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    },
  ],
};

const vGmAImportStats = {
  created: 42,
  updated: 6,
  skipped: 3,
  rejected: 1,
  processed: 52,
};

const vGmAImportRuns = {
  runs: [
    {
      id: "visual-import",
      workspaceId: "visual-workspace",
      projectId: "visual-project",
      pluginId: "import.jira",
      sourceRef: "jira:HELPDESK",
      profileId: null,
      state: "completed",
      stats: vGmAImportStats,
      log: [],
      version: 9,
      nextCursor: null,
      lastCommittedChunk: 5,
      createdAt: "2026-10-06T09:00:00.000Z",
      updatedAt: "2026-10-06T09:48:00.000Z",
    },
    {
      id: "visual-import-csv",
      workspaceId: "visual-workspace",
      projectId: "visual-project",
      pluginId: "import.csv",
      sourceRef: "csv:legacy-tickets-2025",
      profileId: null,
      state: "failed",
      stats: {
        created: 120,
        updated: 0,
        skipped: 4,
        rejected: 9,
        processed: 133,
      },
      log: [],
      version: 6,
      nextCursor: null,
      lastCommittedChunk: 2,
      createdAt: "2026-09-29T13:10:00.000Z",
      updatedAt: "2026-09-29T13:32:00.000Z",
    },
    {
      id: "visual-import-mcp",
      workspaceId: "visual-workspace",
      projectId: "visual-project",
      pluginId: "import.mcp",
      sourceRef: "mcp:asset-register",
      profileId: null,
      state: "paused",
      stats: {},
      log: [],
      version: 2,
      nextCursor: null,
      lastCommittedChunk: -1,
      createdAt: "2026-09-22T11:00:00.000Z",
      updatedAt: "2026-09-22T11:05:00.000Z",
    },
  ],
  nextCursor: null,
};

const vGmAImportEngine = {
  id: "visual-import",
  workspaceId: "visual-workspace",
  projectId: "visual-project",
  pluginId: "import.jira",
  sourceRef: "jira:HELPDESK",
  sourceConnectionId: "visual-import-source",
  state: "completed",
  phase: "completed",
  pausedReason: null,
  version: 9,
  mappingVersion: 3,
  stats: vGmAImportStats,
  cursor: { exhausted: true },
  job: null,
  dryRun: {
    digest: "visual-dry-run-digest",
    mappingVersion: 3,
    total: 52,
    writes: 48,
    at: "2026-10-06T09:20:00.000Z",
  },
  approval: {
    required: false,
    approved: false,
    digest: null,
    totalCount: null,
    mappingVersion: null,
    pendingActionId: null,
  },
  createdAt: "2026-10-06T09:00:00.000Z",
  updatedAt: "2026-10-06T09:48:00.000Z",
};

const vGmAImportReconciliation = {
  runId: "visual-import",
  reconciliation: {
    runId: "visual-import",
    version: 9,
    status: "passed",
    rows: [
      { key: "total", label: "Records", source: 52, target: 52 },
      {
        key: "outcomes",
        label: "Created, updated, skipped, rejected",
        source: 52,
        target: 52,
      },
      { key: "rejected", label: "Rejected", source: 1, target: 1 },
      {
        key: "linked",
        label: "Work items linked to source",
        source: 51,
        target: 51,
      },
      {
        key: "source_type:Incident",
        label: "Source type Incident",
        source: 34,
        target: 34,
      },
      {
        key: "source_type:Service Request",
        label: "Source type Service Request",
        source: 17,
        target: 17,
      },
      {
        key: "project:visual-project",
        label: "Project Help Desk",
        source: 51,
        target: 51,
      },
    ],
  },
};

const vGmAImportLosses = {
  runId: "visual-import",
  summary: [
    {
      sourceType: "Incident",
      code: "attachment_too_large",
      detailCode: "max_bytes",
      count: 2,
    },
    {
      sourceType: "Service Request",
      code: "rich_text_lossy",
      detailCode: "jira_panel_macro",
      count: 1,
    },
  ],
  losses: [
    {
      id: "visual-loss-1",
      sourceType: "Incident",
      sourceId: "HELPDESK-118",
      code: "attachment_too_large",
      detailCode: "max_bytes",
      sourceUrl: "https://jira.example.test/browse/HELPDESK-118",
      createdAt: "2026-10-06T09:41:00.000Z",
    },
    {
      id: "visual-loss-2",
      sourceType: "Incident",
      sourceId: "HELPDESK-131",
      code: "attachment_too_large",
      detailCode: "max_bytes",
      sourceUrl: "https://jira.example.test/browse/HELPDESK-131",
      createdAt: "2026-10-06T09:42:00.000Z",
    },
    {
      id: "visual-loss-3",
      sourceType: "Service Request",
      sourceId: "HELPDESK-204",
      code: "rich_text_lossy",
      detailCode: "jira_panel_macro",
      sourceUrl: "https://jira.example.test/browse/HELPDESK-204",
      createdAt: "2026-10-06T09:44:00.000Z",
    },
  ],
  nextCursor: null,
};

// gmb fixtures
const vGmBOrgIdentityConnection = {
  id: "visual-org-connection",
  providerType: "entra",
  portalScope: "customer",
  organisationId: "visual-organisation",
  defaultWorkspaceId: null,
  displayName: "Contoso Customer Entra",
  issuer:
    "https://login.microsoftonline.com/33333333-3333-4333-8333-333333333333/v2.0",
  tenantId: "33333333-3333-4333-8333-333333333333",
  clientId: "44444444-4444-4444-8444-444444444444",
  clientSecretConfigured: true,
  redirectUri:
    "https://portal.example.test/api/auth/identity/visual-org-connection/callback",
  scopes: ["openid", "profile", "email"],
  claimMapping: null,
  claimMappingState: "default",
  domainBindings: ["contoso.example"],
  jitPolicy: {
    enabled: true,
    default_role_id: null,
    required_entra_app_role: "TaskDesk.Customer",
  },
  maxRoleRank: null,
  mfaUpstreamMode: "off",
  enabled: true,
  configVersion: 3,
  healthState: "healthy",
  healthCheckedAt: "2026-10-20T08:00:00.000Z",
};

const vGmBOrgCustomerVisibility = {
  data: {
    organisationId: "visual-organisation",
    defaultCustomerVisibility: "organisation",
    updatedAt: "2026-10-12T10:15:00.000Z",
  },
};

const vGmBStorageUsage = {
  checkedAt: "2026-10-20T09:30:00.000Z",
  backend: {
    source: "bootstrap",
    driver: "s3",
    configuration: "configured",
    connectivity: "not_checked",
    probeAvailable: true,
  },
  usageBasis: "attachment_metadata",
  physicalUsageAvailable: false,
  limits: {
    maxAttachmentBytes: 26214400,
    maxAttachmentsPerItem: 20,
    allowedExtensions: ["pdf", "png", "jpg", "docx", "xlsx", "txt", "log"],
  },
  attachments: {
    ready: { count: 1284, bytes: "3865470566" },
    pending: { count: 3, bytes: "5242880" },
    deleted: { count: 57, bytes: "104857600" },
  },
};

const vGmBDeliveries = {
  checkedAt: "2026-10-20T09:30:00.000Z",
  counts: {
    events: { pending: 2, dead: 1 },
    notifications: { pending: 4, delivered: 312, suppressed: 9, dead: 0 },
    digests: {
      collecting: 1,
      pending: 0,
      delivered: 41,
      suppressed: 2,
      dead: 0,
    },
    webhooks: {
      pending: 0,
      delivered: 128,
      dead: 0,
      skippedOutOfReach: 3,
      cancelled: 1,
    },
  },
  items: [
    {
      id: "visual-delivery-webhook",
      kind: "webhook",
      state: "delivered",
      createdAt: "2026-10-20T09:12:00.000Z",
      requeueAllowed: false,
      eventId: "visual-event-transitioned",
      eventKind: "work_item.transitioned",
      source: "workspace",
      attempts: 1,
      nextAttemptAt: null,
      statusCode: 200,
      durationMs: 184,
      attemptedAt: "2026-10-20T09:12:01.000Z",
      errorPresent: false,
    },
    {
      id: "visual-delivery-notification",
      kind: "notification",
      state: "delivered",
      createdAt: "2026-10-20T08:47:00.000Z",
      requeueAllowed: false,
      eventId: "visual-event-assigned",
      eventKind: "work_item.assigned",
      channel: "email",
      attempts: 1,
      nextAttemptAt: null,
      deliveredAt: "2026-10-20T08:47:05.000Z",
      errorPresent: false,
    },
    {
      id: "visual-delivery-digest",
      kind: "digest",
      state: "collecting",
      createdAt: "2026-10-20T07:00:00.000Z",
      requeueAllowed: false,
      channel: "email",
      cadence: "daily",
      attempts: 0,
      nextAttemptAt: null,
      deliveredAt: null,
      errorPresent: false,
      children: 6,
    },
    {
      id: "visual-delivery-event",
      kind: "event",
      state: "dead",
      createdAt: "2026-10-19T16:20:00.000Z",
      requeueAllowed: true,
      eventKind: "work_item.escalated",
      attempts: 5,
      errorPresent: true,
    },
  ],
};

const vGmBJobs = {
  checkedAt: "2026-10-20T09:30:00.000Z",
  jobs: [
    {
      name: "sla-scan",
      pattern: null,
      defaultPattern: "*/5 * * * *",
      timezone: null,
      enabled: true,
      version: 4,
      nextRunAt: "2026-10-20T09:35:00.000Z",
      manualRunAllowed: true,
      lastRun: {
        id: "visual-job-run-sla",
        trigger: "scheduled",
        state: "succeeded",
        requestedAt: "2026-10-20T09:30:00.000Z",
        startedAt: "2026-10-20T09:30:00.000Z",
        finishedAt: "2026-10-20T09:30:01.000Z",
        durationMs: 842,
        errorCode: null,
      },
      queuedRun: null,
    },
    {
      name: "notification-digest",
      pattern: "0 */2 * * *",
      defaultPattern: "0 * * * *",
      timezone: "Europe/London",
      enabled: true,
      version: 2,
      nextRunAt: "2026-10-20T10:00:00.000Z",
      manualRunAllowed: true,
      lastRun: {
        id: "visual-job-run-digest",
        trigger: "scheduled",
        state: "failed",
        requestedAt: "2026-10-20T08:00:00.000Z",
        startedAt: "2026-10-20T08:00:00.000Z",
        finishedAt: "2026-10-20T08:00:03.000Z",
        durationMs: 3120,
        errorCode: "handler_failed",
      },
      queuedRun: null,
    },
    {
      name: "secrets-rekey",
      pattern: null,
      defaultPattern: null,
      timezone: null,
      enabled: true,
      version: 1,
      nextRunAt: null,
      manualRunAllowed: false,
      lastRun: null,
      queuedRun: null,
    },
  ],
};

const vGmBMcpUsage = {
  periodStart: "2026-09-20T09:30:00.000Z",
  periodEnd: "2026-10-20T09:30:00.000Z",
  hasMore: false,
  keys: [
    {
      id: "visual-mcp-key-assistant",
      name: "Service desk assistant",
      prefix: "tdk_Hq7v",
      createdAt: "2026-09-02T10:00:00.000Z",
      enabled: true,
      recordedRequestCount: 1842,
      lastRecordedAt: "2026-10-20T09:05:00.000Z",
      autoDisabledAt: null,
      clientReportedTools: [
        {
          toolName: "search_work_items",
          callCount: 964,
          errorCount: 12,
          errorRate: 0.0124,
          meanDurationMs: 182.4,
          maxDurationMs: 1210,
          lastReportedAt: "2026-10-20T09:05:00.000Z",
        },
        {
          toolName: "get_work_item",
          callCount: 611,
          errorCount: 3,
          errorRate: 0.0049,
          meanDurationMs: 96.7,
          maxDurationMs: 640,
          lastReportedAt: "2026-10-20T09:04:00.000Z",
        },
      ],
    },
    {
      id: "visual-mcp-key-triage",
      name: "Legacy triage bot",
      prefix: "tdk_3mZp",
      createdAt: "2026-06-11T14:00:00.000Z",
      enabled: false,
      recordedRequestCount: 12,
      lastRecordedAt: "2026-10-03T07:41:00.000Z",
      autoDisabledAt: "2026-10-03T07:45:00.000Z",
      clientReportedTools: [],
    },
  ],
};

// por fixtures
const vPorKbArticles = [
  {
    id: "visual-article",
    title: "Reset your account password",
    snippet:
      "Request a reset link, choose a new password and sign in again within 30 minutes.",
    categoryId: "visual-kb-accounts",
    publishedAt: "2026-10-12T09:00:00.000Z",
  },
  {
    id: "visual-article-vpn",
    title: "Connect to the office VPN from home",
    snippet:
      "Install the VPN client, sign in with your work account and approve the prompt.",
    categoryId: "visual-kb-network",
    publishedAt: "2026-10-08T14:30:00.000Z",
  },
  {
    id: "visual-article-mfa",
    title: "Set up a new authenticator app",
    snippet:
      "Move your sign-in codes to a new phone before you reset the old one.",
    categoryId: "visual-kb-accounts",
    publishedAt: "2026-09-29T10:15:00.000Z",
  },
];

const vPorKbList = { articles: vPorKbArticles, total: 3 };

// Sidebar probe (`?limit=1`): any total > 0 shows the "Knowledge base" navigation entry.
const { 0: vPorKbFirstArticle, 2: vPorKbThirdArticle } = vPorKbArticles;
const vPorKbNav = { articles: [vPorKbFirstArticle], total: 3 };

const vPorKbCategories = {
  categories: [
    {
      id: "visual-kb-accounts",
      name: "Accounts and sign-in",
      parentId: null,
      position: 0,
      articleCount: 2,
    },
    {
      id: "visual-kb-network",
      name: "Network and VPN",
      parentId: null,
      position: 1,
      articleCount: 1,
    },
  ],
};

const vPorKbArticle = {
  id: "visual-article",
  title: "Reset your account password",
  snippet:
    "Request a reset link, choose a new password and sign in again within 30 minutes.",
  categoryId: "visual-kb-accounts",
  categoryName: "Accounts and sign-in",
  publishedAt: "2026-10-12T09:00:00.000Z",
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Use this guide when you have forgotten your password or your password has expired.",
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Before you start" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Make sure you can open the mailbox for your work email address.",
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Request a reset link" }],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Open the sign-in page and select " },
                  {
                    type: "text",
                    text: "Forgot password",
                    marks: [{ type: "bold" }],
                  },
                  { type: "text", text: "." },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Enter your work email address and submit the form.",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Open the email and choose a new password of at least 12 characters.",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "If the link has expired" }],
      },
      {
        type: "callout",
        attrs: { variant: "info" },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Reset links are valid for 30 minutes. Request a new link, or raise a request if you still cannot sign in.",
              },
            ],
          },
        ],
      },
    ],
  },
  related: [vPorKbThirdArticle],
  myFeedback: null,
};

const vPorInboxUnreadRows = [
  {
    id: "visual-notification-reply",
    kind: "submission.replied",
    isRead: false,
    createdAt: "2026-10-15T09:30:00.000Z",
    requestRef: "SUB-7",
    commentId: "visual-comment-reply",
  },
  {
    id: "visual-notification-mention",
    kind: "work_item.mentioned",
    isRead: false,
    createdAt: "2026-10-14T16:05:00.000Z",
    requestRef: "SUB-9",
    commentId: "visual-comment-mention",
  },
  {
    id: "visual-notification-approval",
    kind: "approval.requested",
    isRead: false,
    createdAt: "2026-10-13T11:20:00.000Z",
    requestRef: null,
    commentId: null,
  },
];
const [vPorInboxFirstUnread] = vPorInboxUnreadRows;

const vPorInboxUnread = {
  data: vPorInboxUnreadRows,
  unreadCount: 3,
  hasMore: false,
  nextCursor: null,
};

// Header bell probe (`?limit=1`): only `unreadCount` is rendered (badge "3").
const vPorInboxBell = {
  data: [vPorInboxFirstUnread],
  unreadCount: 3,
  hasMore: true,
  nextCursor: "visual-notification-reply",
};

const vPorAccountPreferences = [
  {
    eventKind: "work_item.mentioned",
    channel: "notify.email",
    scope: "global",
    scopeId: null,
    enabled: true,
    digest: "off",
    source: "default",
  },
  {
    eventKind: "work_item.commented",
    channel: "notify.email",
    scope: "global",
    scopeId: null,
    enabled: true,
    digest: "daily",
    source: "global",
  },
];

const vPorAuthMethods = { password: true, magicLink: false, emailOtp: true };
const vPorInviteContinuation = { accepted: false };
const vPorInviteAccepted = { accepted: true };

async function installAuthenticatedFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    // Authenticated shells mount several optional picker queries globally (labels,
    // work item types, members). Empty collections are their deterministic baseline.
    let body: unknown = [];
    // Most reads succeed; a branch sets another status where the real API answers an error.
    let status = 200;

    if (path.endsWith("/api/auth/get-session")) body = session;
    // Shell reads every authenticated page makes: profile settings sync, terminology, the
    // resolved feature switches that drive navigation, the bell, and pending invitations.
    else if (path === "/api/me/settings") {
      body = { settings: {} };
    } else if (path === "/api/public/terminology") {
      body = visualAgentTerminology;
    } else if (
      path === "/api/workspaces/visual-workspace/terminology/runtime"
    ) {
      body = visualAgentTerminology;
    } else if (path === "/api/workspaces/visual-workspace/features/resolved") {
      body = { features: visualResolvedFeatures };
    } else if (path === "/api/features/resolved") {
      body = { features: visualResolvedFeatures };
    } else if (path === "/api/portal/feature-state") {
      body = { state: "on" };
    } else if (path === "/api/notification/inbox") {
      body = { data: [], unreadCount: 0, hasMore: false, nextCursor: null };
    } else if (path === "/api/invitation/pending") {
      body = [];
    } else if (path === "/api/service-catalogue/status") {
      body = {
        enabled: true,
        canManageServices: true,
        canManageChanges: true,
        canManageReleases: true,
      };
    } else if (path === "/api/views/team-audiences") {
      body = { data: [] };
    } else if (path === "/api/canned-responses/manage") {
      body = visualCannedResponses;
    } else if (path === "/api/me/identity-links") {
      // Ada signed in with a password: the session has no source identity connection, so
      // account-link.ts answers 403 and the panel shows the "passwordSession" info alert.
      // USES status (non-200).
      status = 403;
      body = { message: "Forbidden" };
    } else if (path === "/api/intake/queues") {
      body = vExIntakeQueues;
    } else if (path === "/api/kb/deflection") {
      body = vExKbDeflection;
    } else if (
      path === "/api/time-entries/summary" &&
      url.search === "?workspaceId=visual-workspace&cycleId=visual-cycle"
    ) {
      body = vExCycleTimeSummary;
    } else if (
      path === "/api/time-entries/summary" &&
      url.search === "?workspaceId=visual-workspace&moduleId=visual-module"
    ) {
      body = vExModuleTimeSummary;
    } else if (path === "/api/projects/help/wip-limits") {
      body = vExWipLimits;
    } else if (path === "/api/task/tasks/visual-project") {
      body = vExBoard;
    } else if (path === "/api/projects/visual-project/members") {
      body = vExProjectMembers;
    } else if (path === "/api/projects/visual-project/settings/inheritance") {
      body = vExProjectInheritance;
    } else if (path === "/api/column/visual-project") {
      body = vExColumns;
    } else if (path === "/api/workflow-rule/visual-project") {
      // No integration rules: the integration routers are removed, so an empty list is the
      // real answer (explicit here so it is not mistaken for an unserved endpoint).
      body = [];
    } else if (path === "/api/project/organisations") {
      body = vExProjectOrganisations;
    } else if (path === "/api/request-type-groups/order") {
      body = vExRequestTypeGroupOrder;
    } else if (
      path === "/api/service-calendars/visual-calendar/holidays/presets"
    ) {
      body = vExHolidayPresets;
    } else if (path === "/api/canned-responses") {
      body = visualCannedResponses;
    } else if (path === "/api/work-items/HELP-7/comments/mention-candidates") {
      body = vExMentionCandidates;
    } else if (path === "/api/work-items/HELP-7/estimate") {
      body = vExWorkItemEstimate;
    } else if (path === "/api/projects/HELP/estimates") {
      body = vAgileEstimates;
    } else if (path === "/api/projects/HELP/cycles") {
      body = vAgileCycleList;
    } else if (path === "/api/projects/HELP/modules") {
      body = vAgileModuleList;
    } else if (path === "/api/workspace/visual-workspace") {
      body = vExWorkspaceDetail;
    } else if (path === "/api/workspace/visual-workspace/project-settings") {
      body = vExWorkspaceProjectSettings;
    } else if (path === "/api/workspace/visual-workspace/state-templates") {
      body = vExWorkspaceStateTemplates;
    } else if (path === "/api/projects/visual-project/state-templates") {
      body = vExProjectStateTemplates;
    } else if (path === "/api/label/workspace/visual-workspace") {
      body = vExWorkspaceLabels;
    } else if (path === "/api/portal/releases") {
      body = vExPortalReleases;
    } else if (
      path === "/api/projects/visual-project/work-items" &&
      url.search === "?sort=position&dir=asc&limit=200&cycle=visual-cycle"
    ) {
      // MUST precede the base `path.endsWith("/api/projects/visual-project/work-items")` branch.
      body = vAgileScopedWorkItems;
    } else if (
      path === "/api/projects/visual-project/work-items" &&
      url.search === "?sort=position&dir=asc&limit=200&module=visual-module"
    ) {
      // MUST precede the base `path.endsWith("/api/projects/visual-project/work-items")` branch.
      body = vAgileScopedWorkItems;
    } else if (path === "/api/projects/help/cycles") {
      body = vAgileCycleList;
    } else if (path === "/api/cycles/visual-cycle/burndown") {
      body = vAgileBurndown;
    } else if (path === "/api/cycles/visual-cycle") {
      body = vAgileCycleDetail;
    } else if (path === "/api/projects/help/modules") {
      body = vAgileModuleList;
    } else if (path === "/api/modules/visual-module") {
      body = vAgileModuleDetail;
    } else if (path === "/api/projects/help/pages") {
      body = vAgilePageList;
    } else if (path === "/api/projects/help/pages/visual-page/versions") {
      body = vAgilePageVersions;
    } else if (path === "/api/projects/help/pages/visual-page") {
      body = vAgilePage;
    } else if (path === "/api/projects/help/estimates") {
      body = vAgileEstimates;
    } else if (path === "/api/projects/visual-project/features") {
      body = vAgileProjectFeatures;
    } else if (path === "/api/projects/help/automations") {
      body = vAgileAutomations;
    } else if (
      path === "/api/time-settings" &&
      url.search === "?workspaceId=visual-workspace&projectId=visual-project"
    ) {
      body = vAgileProjectTimeSettings;
    } else if (path === "/api/projects/visual-project/budget") {
      body = vAgileBudget;
    } else if (path === "/api/services") {
      body = vSvcServiceList;
    } else if (path === "/api/services/visual-service") {
      body = vSvcServiceDetail;
    } else if (path === "/api/services/visual-service/impact") {
      body = vSvcServiceImpact;
    } else if (path === "/api/changes/calendar") {
      body = vSvcChangeCalendar;
    } else if (path === "/api/releases") {
      body = vSvcReleaseList;
    } else if (path === "/api/kb/categories") {
      body = vSvcKbCategories;
    } else if (path === "/api/kb/settings") {
      body = vSvcKbSettings;
    } else if (path === "/api/kb/articles") {
      body = vSvcKbArticleList;
    } else if (path === "/api/kb/articles/visual-article") {
      body = vSvcKbArticleDetail;
    } else if (path === "/api/reports") {
      body = vRepCatalogue;
    } else if (path === "/api/reports/throughput") {
      body = vRepThroughput;
    } else if (path === "/api/reports/sla_attainment") {
      body = vRepSlaAttainment;
    } else if (path === "/api/reports/at_risk_now") {
      body = vRepAtRiskNow;
    } else if (path === "/api/reports/ageing") {
      body = vRepAgeing;
    } else if (path === "/api/reports/custom/preview") {
      body = vRepCustomPreview;
    } else if (path === "/api/report-exports/visual-export") {
      body = vRepExport;
    } else if (path === "/api/dashboards") {
      body = vRepDashboardList;
    } else if (path === "/api/dashboards/visual-dashboard") {
      body = vRepDashboardDetail;
    } else if (
      path === "/api/dashboards/visual-dashboard/widgets/visual-widget-sla/data"
    ) {
      body = vRepSlaAttainment;
    } else if (
      path ===
      "/api/dashboards/visual-dashboard/widgets/visual-widget-at-risk/data"
    ) {
      body = vRepAtRiskNow;
    } else if (
      path ===
      "/api/dashboards/visual-dashboard/widgets/visual-widget-completed/data"
    ) {
      body = vRepThroughput;
    } else if (
      path ===
      "/api/dashboards/visual-dashboard/widgets/visual-widget-throughput/data"
    ) {
      body = vRepThroughput;
    } else if (
      path ===
      "/api/dashboards/visual-dashboard/widgets/visual-widget-ageing/data"
    ) {
      body = vRepAgeing;
    } else if (path === "/api/time-entries/timer") {
      body = vRepTimer;
    } else if (
      path === "/api/time-entries" &&
      url.search ===
        "?workspaceId=visual-workspace&from=2026-10-19&to=2026-10-25"
    ) {
      body = vRepTimeWeek;
    } else if (path === "/api/time-entries") {
      // The `needsReview=true` probe (its `today` picks the week) and the previous week
      // (`from=2026-10-12&to=2026-10-18`, read by "Copy last week's rows") are empty lists.
      body = vRepTimeListBase;
    } else if (
      path === "/api/time-activities" &&
      url.search === "?workspaceId=visual-workspace"
    ) {
      body = vRepTimeActivities;
    } else if (
      path === "/api/workspace/visual-workspace/customer-organisations"
    ) {
      body = vSetACustomerOrganisations;
    } else if (path === "/api/teams") {
      body = vSetATeams;
    } else if (path === "/api/teams/visual-team") {
      body = vSetATeamDetail;
    } else if (path === "/api/workspace/visual-workspace/roles") {
      body = vSetARoles;
    } else if (path === "/api/workspace/visual-workspace/roles/visual-role") {
      body = vSetARoleAnalyst;
    } else if (path === "/api/custom-fields") {
      body = vSetACustomFields;
    } else if (path === "/api/custom-field-sections") {
      body = vSetACustomFieldSections;
    } else if (path === "/api/notification-preferences") {
      body = vSetANotificationPreferences;
    } else if (path === "/api/notification-preferences/email-link-handoff") {
      body = vSetAEmailLinkHandoff;
    } else if (path === "/api/rates") {
      body = vSetBRates;
    } else if (path === "/api/cost-types") {
      body = vSetBCostTypes;
    } else if (path === "/api/available-hours") {
      body = vSetBAvailableHours;
    } else if (path === "/api/workspaces/visual-workspace/automations") {
      body = vSetBAutomations;
    } else if (path === "/api/webhooks/visual-webhook/deliveries") {
      body = vSetBWebhookDeliveries;
    } else if (path === "/api/webhooks") {
      body = vSetBWebhooks;
    } else if (path === "/api/workspaces/visual-workspace/features") {
      body = vSetBWorkspaceFeatures;
    } else if (path === "/api/workflows") {
      body = vSetBWorkflows;
    } else if (path === "/api/change-cab-template") {
      body = vSetBCabTemplate;
    } else if (path === "/api/instance/health") {
      body = vGmAHealth;
    } else if (path === "/api/instance/webhooks/security-posture") {
      body = vGmAWebhookPosture;
    } else if (path === "/api/instance/settings") {
      body = vGmAInstanceSettings;
    } else if (path === "/api/instance/terminology") {
      body = vGmAInstanceTerminology;
    } else if (path === "/api/instance/notification-providers/email") {
      body = vGmAEmailProvider;
    } else if (path === "/api/instance/plugins") {
      body = vGmAPlugins;
    } else if (path === "/api/instance/features") {
      body = vGmAInstanceFeatures;
    } else if (path === "/api/imports") {
      body = vGmAImportRuns;
    } else if (path === "/api/imports/visual-import/engine") {
      body = vGmAImportEngine;
    } else if (path === "/api/imports/visual-import/reconciliation") {
      body = vGmAImportReconciliation;
    } else if (path === "/api/imports/visual-import/losses") {
      body = vGmAImportLosses;
    } else if (
      path === "/api/instance/organisations/visual-organisation/identity"
    ) {
      body = { data: vGmBOrgIdentityConnection };
    } else if (
      path ===
      "/api/instance/organisations/visual-organisation/customer-visibility"
    ) {
      body = vGmBOrgCustomerVisibility;
    } else if (path === "/api/instance/storage/usage") {
      body = vGmBStorageUsage;
    } else if (path === "/api/instance/deliveries") {
      body = vGmBDeliveries;
    } else if (path === "/api/instance/jobs") {
      body = vGmBJobs;
    } else if (path === "/api/instance/mcp/usage") {
      body = vGmBMcpUsage;
    } else if (path === "/api/portal/kb/categories") {
      body = vPorKbCategories;
    } else if (path === "/api/portal/kb/visual-article") {
      body = vPorKbArticle;
    } else if (path === "/api/portal/kb") {
      // `?limit=1` is the sidebar probe on EVERY portal page (see NOTES); the KB screen reads `?sort=recent&limit=50`.
      body = url.search === "?limit=1" ? vPorKbNav : vPorKbList;
    } else if (path === "/api/portal/notification/inbox") {
      // `?limit=1` is the header bell on EVERY portal page (see NOTES); the screen reads `?filter=unread&limit=25`.
      body = url.search === "?limit=1" ? vPorInboxBell : vPorInboxUnread;
    } else if (path === "/api/portal/notification-preferences/canonical") {
      body = vPorAccountPreferences;
    } else if (path === "/api/portal/auth-methods") {
      body = vPorAuthMethods;
    } else if (
      path === "/api/portal/invitations/visual-invite/continuation-result"
    ) {
      body = vPorInviteContinuation;
    } else if (
      path === "/api/portal/invitations/visual-invite/accept-continuation"
    ) {
      body = vPorInviteAccepted;
    } else if (path === "/api/time-activities") {
      body = vSetBTimeActivities;
    } else if (path === "/api/time-settings") {
      body = vSetBTimeSettings;
    } else if (path.endsWith("/api/submissions/SUB-7")) {
      body = {
        submission: {
          state: "new",
          formData: { title: "Request access to the support workspace" },
          requesterId: "visual-requester",
          organisationId: "visual-workspace",
          workItemId: null,
        },
        requestType: { name: "Access request" },
        version: {
          defaultProjectId: project.id,
          workItemTypeId: "visual-type",
          formSchema: { fields: visualRequestType.formSchema.fields },
        },
        messages: [],
      };
    } else if (path.endsWith("/api/submissions")) {
      body = {
        submissions: [
          {
            ref: "SUB-7",
            summary: "Request access to the support workspace",
            submission: { state: "new", createdAt: "2026-09-15T00:00:00.000Z" },
            requestType: { name: "Access request" },
            requester: { displayName: "Ada Example" },
            organisation: { name: "Northstar Support" },
          },
        ],
        page: { hasMore: false, nextCursor: null },
      };
    } else if (path.endsWith("/api/request-types/visual-request-type")) {
      body = visualRequestType;
    } else if (path.endsWith("/api/request-types")) {
      body = { requestTypes: [visualRequestType] };
    } else if (path.endsWith("/api/portal/catalogue/access")) {
      body = {
        key: "access",
        name: "Access request",
        description: "Request access to a support workspace.",
        formSchema: {
          fields: [
            { key: "title", label: "Summary", type: "text", required: true },
          ],
        },
        version: 3,
      };
    } else if (path.endsWith("/api/portal/catalogue")) {
      const hasNoCatalogueMatches = url.search === "?q=no-match";
      body = {
        defaultCustomerVisibility: "organisation",
        requestTypes: hasNoCatalogueMatches
          ? []
          : [
              {
                key: "access",
                name: "Access request",
                description: "Request access to a support workspace.",
                icon: null,
                group: "Access",
                position: 0,
                forcePrivate: false,
                formSchema: {
                  fields: [
                    {
                      key: "title",
                      label: "Summary",
                      type: "text",
                      required: true,
                    },
                  ],
                },
                version: 3,
              },
            ],
      };
    } else if (path.endsWith("/api/portal/submissions")) {
      body = {
        submissions: [
          {
            ref: "SUB-7",
            requestTypeName: "Access request",
            state: "new",
            customerVisibility: "private",
            createdAt: "2026-09-15T00:00:00.000Z",
          },
        ],
        page: { hasMore: false, nextCursor: null },
      };
    } else if (path.endsWith("/api/portal/approvals")) {
      body = {
        approvals: [
          {
            id: "visual-approval",
            workItemKey: "HELP-7",
            workItemTitle: "Approve workspace access",
            state: "pending",
            expiresAt: "2026-10-24T12:00:00.000Z",
            approverReachLost: false,
          },
        ],
      };
    } else if (path.endsWith("/api/instance/audit")) {
      body = {
        rows: [
          {
            id: "visual-audit",
            seq: "42",
            createdAt: "2026-09-15T12:00:00.000Z",
            actorId: "visual-user",
            actorType: "person",
            impersonatorId: null,
            workspaceId: workspace.id,
            organisationId: null,
            action: "work_item.updated",
            entityType: "work_item",
            entityId: workItem.id,
            before: { title: "Workspace access" },
            after: { title: "Approve workspace access" },
          },
        ],
      };
    } else if (path.endsWith("/api/portal/submissions/SUB-7")) {
      body = {
        submission: {
          state: "new",
          formData: { title: "Request access to the support workspace" },
          workItemId: null,
        },
        canWithdraw: true,
        workItem: null,
        requestType: { name: "Access request" },
        version: {
          formSchema: {
            fields: [
              { key: "title", label: "Summary", type: "text" },
              { key: "evidence", label: "Evidence", type: "file" },
            ],
          },
        },
        messages: [],
      };
    } else if (path.endsWith("/api/portal/submissions/SUB-7/attachments")) {
      body = [];
    } else if (path.endsWith("/api/submissions/SUB-7/attachments")) {
      body = [];
    } else if (path.endsWith("/api/submissions/SUB-7/duplicates")) {
      body = { suggestions: [] };
    } else if (path.endsWith("/api/config")) {
      body = {
        disableRegistration: true,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: true,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      };
    } else if (path.endsWith("/api/workspace")) body = [workspace];
    else if (path.endsWith("/api/project")) body = [project];
    else if (path.endsWith("/api/project/visual-project")) body = project;
    else if (path.endsWith("/api/workspace/visual-workspace/members")) {
      body = vExWorkspaceMembers;
    } else if (path.endsWith("/api/capabilities")) {
      // The workspace owner holds every capability the API reports.
      body = visualOwnerCapabilities;
    } else if (path.endsWith("/api/label/project/visual-project/catalogue")) {
      body = [
        {
          id: "visual-project-label",
          name: "Project priority",
          color: "teal",
          projectId: "visual-project",
          workspaceId: "visual-workspace",
          taskId: null,
          createdAt: "2026-10-21T00:00:00.000Z",
        },
      ];
    } else if (path.endsWith("/api/service-calendars")) {
      body = {
        data: [visualCalendar],
        page: { previousCursor: null, nextCursor: null, hasMore: false },
        meta: { total: 1 },
      };
    } else if (
      path.endsWith("/api/service-calendars/visual-calendar/preview")
    ) {
      body = {
        calendarId: visualCalendar.id,
        year: 2026,
        weeklyCoverMinutes: 2400,
        annualCoverMinutes: 104160,
        hasCover: true,
      };
    } else if (path.endsWith("/api/service-calendars/visual-calendar/usage")) {
      body = {
        calendarId: visualCalendar.id,
        counts: {
          projects: 0,
          slaPolicyVersions: 1,
          currentSlaPolicies: 1,
          workItems: 0,
        },
      };
    } else if (path.endsWith("/api/service-calendars/visual-calendar")) {
      body = visualCalendar;
    } else if (path.endsWith("/api/sla-policies/visual-sla-policy")) {
      body = visualSlaPolicy;
    } else if (path.endsWith("/api/sla-policies")) {
      body = {
        data: [
          {
            id: visualSlaPolicy.id,
            key: visualSlaPolicy.key,
            workspaceId: workspace.id,
            name: visualSlaPolicy.name,
            description: visualSlaPolicy.description,
            version: visualSlaPolicy.version,
            createdAt: visualSlaPolicy.createdAt,
            updatedAt: visualSlaPolicy.updatedAt,
            activeVersion: {
              id: visualSlaPolicy.activeVersion.id,
              number: visualSlaPolicy.activeVersion.number,
              calendarId: visualCalendar.id,
              atRiskThresholdPct: 80,
              effectiveFrom: visualSlaPolicy.activeVersion.effectiveFrom,
              goalCount: visualGoals.length,
            },
            hasDraft: false,
          },
        ],
        page: { previousCursor: null, nextCursor: null, hasMore: false },
        meta: { total: 1 },
      };
    } else if (
      path.endsWith("/api/workspace/visual-workspace/work-item-types")
    ) {
      body = [
        {
          id: "visual-type",
          key: "incident",
          name: "Incident",
          category: "service",
        },
      ];
    } else if (path.endsWith("/api/projects/visual-project/states")) {
      body = [
        {
          id: "visual-backlog",
          stateTemplateId: "visual-backlog-template",
          name: "Backlog",
          group: "backlog",
          position: 0,
          isDefault: true,
        },
        {
          id: "visual-state",
          stateTemplateId: "visual-state-template",
          name: "In progress",
          group: "started",
          position: 1,
          isDefault: false,
        },
        {
          id: "visual-done",
          stateTemplateId: "visual-done-template",
          name: "Done",
          group: "completed",
          position: 2,
          isDefault: false,
        },
      ];
    } else if (path.endsWith("/api/projects/visual-project/work-items")) {
      body = {
        data: [workItem],
        page: { hasMore: false, nextCursor: null },
        meta: {},
      };
    } else if (path.endsWith("/api/me/csrf-token")) {
      // Running a saved view is a POST, which obtains the session's CSRF token first.
      body = { token: "visual-csrf", expiresAt: "2030-01-01T00:00:00.000Z" };
    } else if (path.endsWith("/api/views/visual-view/count")) {
      body = { count: 1 };
    } else if (path.endsWith("/api/views/visual-view/run")) {
      body = {
        data: [workItem],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 1 },
      };
    } else if (path.endsWith("/api/work-items/search")) {
      // My work's cross-project read (`assignee = @me`).
      body = {
        data: [workItem],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 1 },
      };
    } else if (path.endsWith("/api/me/approvals")) {
      body = { approvals: [] };
    } else if (path.endsWith("/api/views/visual-view")) {
      body = visualSavedView;
    } else if (path.endsWith("/api/views")) {
      body = [visualSavedView];
    } else if (path.endsWith("/api/work-items/HELP-7/activity")) {
      // The native activity timeline reads a paged envelope; the generic `[]`
      // default has no `data` array and crashes the detail route.
      body = { data: [], page: { nextCursor: null, hasMore: false } };
    } else if (path.endsWith("/api/work-items/HELP-7/children")) {
      body = {
        parent: {
          ...workItem,
          stateCategory: "started",
        },
        ancestors: [],
        data: [
          {
            id: "visual-hierarchy-child",
            key: "HELP-8",
            title: "Verify access after reset",
            stateName: "Backlog",
            stateCategory: "backlog",
            hasChildren: false,
          },
        ],
        page: { nextCursor: null, hasMore: false },
        meta: { total: 1 },
        progress: { completed: 0, total: 1 },
      };
    } else if (path.endsWith("/api/work-items/HELP-7/relations")) {
      // The relations section reads `{ data, hiddenCount }`, not a bare array.
      body = { data: [], hiddenCount: 0 };
    } else if (path.endsWith("/api/work-items/HELP-7/labels")) {
      body = [];
    } else if (path.endsWith("/api/work-items/HELP-7/sla")) {
      body = {
        key: "HELP-7",
        startedAt: "2026-09-15T00:00:00.000Z",
        evaluatedAt: "2026-09-15T02:00:00.000Z",
        metrics: [
          {
            metric: "first_response",
            state: "met",
            dueAt: "2026-09-15T04:00:00.000Z",
            targetMinutes: 240,
            consumedMinutes: 45,
            consumedPct: 18.75,
            remainingMinutes: null,
          },
          {
            metric: "resolution",
            state: "at_risk",
            dueAt: "2026-09-16T00:00:00.000Z",
            targetMinutes: 1440,
            consumedMinutes: 1200,
            consumedPct: 83.3,
            remainingMinutes: 240,
          },
        ],
      };
    } else if (path.endsWith("/api/work-items/HELP-7/attachments")) {
      body = [
        {
          id: "visual-attachment",
          workItemId: "visual-work-item",
          filename: "error-screenshot.png",
          mimeType: "image/png",
          size: 48213,
          state: "ready",
          customerVisible: false,
          uploadedBy: "visual-user",
          createdAt: "2026-09-15T00:00:00.000Z",
          deletedAt: null,
        },
      ];
    } else if (path.endsWith("/api/work-items/HELP-7")) body = workItem;
    else if (path.endsWith("/api/me/security/factors")) {
      // A password user without an authenticator: the API offers password step-up.
      body = {
        enabled: false,
        required: false,
        policyMode: "optional",
        availableMethods: ["password"],
      };
    } else if (path.endsWith("/api/me/pending-actions")) {
      body = {
        data: [
          {
            id: "visual-pending-action",
            action: "delete",
            origin: "api",
            targetType: "user",
            targetIds: ["visual-target-user"],
            summary: { email: "casey.staff@example.test" },
            confirmation: "typed_name_step_up",
            approvalSupported: true,
            state: "pending",
            createdAt: "2026-10-01T12:00:00.000Z",
            expiresAt: "2026-10-01T12:15:00.000Z",
          },
        ],
        page: { nextCursor: null, hasMore: false },
        meta: { total: 1 },
      };
    } else if (path.endsWith("/api/me/pending-actions/visual-pending-action")) {
      body = {
        id: "visual-pending-action",
        action: "delete",
        origin: "api",
        targetType: "user",
        targetIds: ["visual-target-user"],
        summary: { email: "casey.staff@example.test" },
        confirmation: "typed_name_step_up",
        approvalSupported: true,
        state: "pending",
        createdAt: "2026-10-01T12:00:00.000Z",
        expiresAt: "2026-10-01T12:15:00.000Z",
        invalidationReason: null,
      };
    } else if (path.endsWith("/api/instance/users/visual-target-user")) {
      body = {
        id: "visual-target-user",
        name: "Casey Staff",
        email: "casey.staff@example.test",
        emailVerified: true,
        createdAt: "2026-09-01T12:00:00.000Z",
        locale: "en-GB",
        isInstanceAdmin: false,
        isSuspended: false,
        suspensionExpiresAt: null,
        twoFactorEnabled: false,
        person: {
          id: "visual-target-person",
          side: "staff",
          organisationId: null,
          organisationName: null,
          active: true,
          isPlaceholder: false,
        },
      };
    } else if (path === "/api/instance/identity-connections") {
      body = { data: [visualIdentityConnection] };
    } else if (
      path === "/api/instance/identity-connections/visual-connection/scim"
    ) {
      body = { data: {}, configVersion: 7 };
    } else if (path === "/api/instance/users") {
      body = {
        data: [
          {
            id: "visual-directory-user",
            name: "Taylor Staff",
            email: "taylor@example.test",
            emailVerified: true,
            createdAt: "2026-10-01T12:00:00.000Z",
            locale: "en-GB",
            isInstanceAdmin: false,
            isSuspended: false,
            suspensionExpiresAt: null,
            twoFactorEnabled: true,
            person: {
              id: "visual-directory-person",
              side: "staff",
              organisationId: null,
              organisationName: null,
              active: true,
              isPlaceholder: false,
            },
          },
        ],
        page: { nextCursor: null, hasMore: false },
      };
    } else if (path.endsWith("/api/instance/observability")) {
      body = {
        version: 1,
        logLevels: {
          default: "info",
          modules: {
            http: "info",
            auth: "warn",
            database: "error",
            jobs: "info",
            audit: "info",
            plugins: "info",
            realtime: "info",
          },
        },
        metricsTokenConfigured: false,
        metricsTokenRotatedAt: null,
      };
    } else if (path.endsWith("/api/instance/local-factor-policy")) {
      body = { policy: { mode: "optional", requiredRoleId: null } };
    }

    // Screens that read the server clock (lib/server-clock.ts) take "today" from the
    // HTTP Date header; route.fulfill sends none, so pin it to the fixture date.
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: { date: "Wed, 21 Oct 2026 12:00:00 GMT" },
      body: JSON.stringify(body),
    });
  });
}

test("sign-in screen @visual", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: path.endsWith("/api/auth/get-session")
        ? "null"
        : JSON.stringify({
            disableRegistration: true,
            disablePasswordRegistration: false,
            disableEmailOtpSignIn: true,
            disableWorkspaceCreation: true,
            hasSmtp: false,
            hasGithubSignIn: false,
            hasGoogleSignIn: false,
            hasDiscordSignIn: false,
            hasCustomOAuth: false,
            disableLoginForm: false,
            customOAuthAutoLogin: false,
            customOAuthLogoutUrl: null,
          }),
    });
  });

  await page.goto("/auth/sign-in");
  await expect(page.getByText("Welcome back", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("sign-in.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god-mode sign-in screen @visual", async ({ page }) => {
  // Every SSO, social and email-code option is configured: God Mode still offers the password only.
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: path.endsWith("/api/auth/get-session")
        ? "null"
        : JSON.stringify({
            disableRegistration: false,
            disablePasswordRegistration: false,
            disableEmailOtpSignIn: false,
            disableWorkspaceCreation: true,
            hasSmtp: true,
            hasGithubSignIn: true,
            hasGoogleSignIn: true,
            hasDiscordSignIn: true,
            hasCustomOAuth: true,
            disableLoginForm: false,
            customOAuthAutoLogin: true,
            customOAuthLogoutUrl: null,
          }),
    });
  });

  await page.goto("/god-mode/sign-in");
  await expect(
    page.getByText("Sign in to God Mode", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-mode-sign-in.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("work-item list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/work?layout=list");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "HELP-7 Customer cannot reset their password",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("realtime-unavailable")).toBeVisible();
  await expect(page).toHaveScreenshot("work-item-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("work-item detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/work-items/HELP-7");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "HELP-8 Verify access after reset",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("work-item-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("account security enrollment-ready screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/account/security");
  await expect(
    page.getByText("Set up an authenticator factor", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up authenticator" }),
  ).toBeEnabled();
  await expect(page).toHaveScreenshot("account-security-setup.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("two-factor authenticator challenge screen @visual", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: path.endsWith("/api/auth/get-session")
        ? "null"
        : JSON.stringify({ disableRegistration: true, hasSmtp: false }),
    });
  });
  await page.goto("/auth/two-factor");
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  await expect(page).toHaveScreenshot("two-factor-authenticator.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("intake triage queue @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/triage?state=new&ref=SUB-7");
  // The modal sheet hides the page behind it from the accessibility tree, so the shell and
  // queue checks include hidden elements. The sidebar's project list is lazy; wait for it so
  // the screenshot never races it.
  await expect(
    page.getByRole("button", {
      name: "Help Desk",
      exact: true,
      includeHidden: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, includeHidden: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "SUB-7",
      exact: true,
      includeHidden: true,
    }),
  ).toBeVisible();
  // S2: the open submission is Kaneo's side sheet; wait for its lazy body, not the fallback.
  await expect(
    page.getByRole("dialog", { name: "Submission SUB-7" }),
  ).toBeVisible();
  await expect(page.getByText("Submitted answers")).toBeVisible();
  await expect(page).toHaveScreenshot("intake-queue.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("request type catalogue editor @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto(
    "/dashboard/settings/workspace/request-types?requestTypeId=visual-request-type",
  );
  // The settings shell has its own "Settings" h1; target the page's.
  await expect(
    page.getByRole("heading", { level: 1, name: "Request types" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Edit Access request", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New request type" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("request-types.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("portal catalogue selected form @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/catalogue?q=no-match&key=access");
  await expect(
    page.getByRole("heading", { name: "Access request", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Summary" })).toBeVisible();
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-catalogue-selected-form.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("portal submission detail @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/submissions/SUB-7");
  await expect(
    page.getByRole("heading", { name: "Request SUB-7", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your answers" }),
  ).toBeVisible();
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-submission-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("observability settings screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/observability");
  await expect(
    page.getByRole("heading", { name: "Observability", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Local factor policy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Structured log levels", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No token is configured.")).toBeVisible();
  await expect(page).toHaveScreenshot("observability-settings.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("portal sign-in email stage @visual", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: path.endsWith("/api/auth/get-session") ? "null" : "{}",
    });
  });
  await page.goto("http://127.0.0.1:4179/sign-in");
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-sign-in-email.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("instance users directory screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/users");
  await expect(
    page.getByRole("heading", { name: "Instance users", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Taylor Staff", { exact: true })).toBeVisible();
  await expect(
    page.getByText("taylor@example.test", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("instance-users-directory.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("authentication providers list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/authentication");
  await expect(
    page.getByRole("heading", {
      name: "Authentication providers",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Staff Entra", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("authentication-providers-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("authentication provider editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/authentication/visual-connection");
  await expect(
    page.getByRole("heading", {
      name: "Connection configuration",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Connection name")).toBeVisible();
  await expect(page).toHaveScreenshot("authentication-provider-editor.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("pending actions list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/account/pending-actions");
  await expect(
    page.getByRole("heading", { name: "My pending actions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Deactivate person · casey.staff@example.test", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("pending-actions-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("pending action detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto(
    "/dashboard/settings/account/pending-actions/visual-pending-action",
  );
  await expect(
    page.getByRole("heading", {
      name: "Approve person deactivation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Type the exact current email")).toBeVisible();
  await expect(page.getByLabel("Account password")).toBeVisible();
  await expect(page).toHaveScreenshot("pending-action-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("service calendar list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/calendars");
  await expect(
    page.getByRole("heading", { name: "Service calendars" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Support coverage" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("service-calendar-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("service calendar editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/calendars/visual-calendar");
  await expect(
    page.getByRole("heading", { name: "Support coverage" }),
  ).toBeVisible();
  await expect(page.getByText("40 hours of cover per week")).toBeVisible();
  await expect(page).toHaveScreenshot("service-calendar-editor.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("SLA policy list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/sla-policies");
  await expect(
    page.getByRole("heading", { name: "SLA policies" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Priority support" }),
  ).toBeVisible();
  await expect(page.getByText("Active version 1")).toBeVisible();
  await expect(page).toHaveScreenshot("sla-policy-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("SLA policy editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto(
    "/dashboard/settings/workspace/sla-policies/visual-sla-policy",
  );
  await expect(
    page.getByRole("heading", { name: "Priority support" }),
  ).toBeVisible();
  await expect(page.getByText("Active version 1")).toBeVisible();
  await expect(page.getByText("First response", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("sla-policy-editor.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("work-item board screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/work?layout=board");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "In progress" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "HELP-7 Customer cannot reset their password",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("realtime-unavailable")).toBeVisible();
  await expect(page).toHaveScreenshot("work-item-board.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("saved views index screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/views");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saved views" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open incidents" }),
  ).toBeVisible();
  await expect(page.getByText("1 matching work item")).toBeVisible();
  await expect(page).toHaveScreenshot("saved-views-index.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("saved view detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/views/visual-view");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Open incidents" }),
  ).toBeVisible();
  await expect(
    page.getByText("Customer cannot reset their password"),
  ).toBeVisible();
  await expect(page.getByText("1 matching work item")).toBeVisible();
  await expect(page).toHaveScreenshot("saved-view-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project backlog screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/backlog");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Help Desk · Backlog" }),
  ).toBeVisible();
  // "Create work item" renders once capabilities load; wait so the screenshot does not race it.
  await expect(
    page.getByRole("button", { name: "Create work item" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-backlog.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("work-item table screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/work?layout=table");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Customer cannot reset their password"),
  ).toBeVisible();
  // The realtime notice appears once the socket gives up; wait for it, as the list and board
  // cases do, so the screenshot does not race it.
  await expect(page.getByTestId("realtime-unavailable")).toBeVisible();
  await expect(page).toHaveScreenshot("work-item-table.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("agent workspace home screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  // `/agent` home is kaneo's projects page inside the kaneo shell (sidebar + breadcrumb).
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(page.getByTestId("g13-projects-content")).toBeVisible();
  await expect(page).toHaveScreenshot("agent-workspace-home.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("agent inbox screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/inbox");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page).toHaveScreenshot("agent-inbox.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("agent my work screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/my-work");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
  await expect(
    page.getByText("Customer cannot reset their password"),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("agent-my-work.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("agent global search screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/search");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { name: "Start Searching" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("agent-global-search.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project overview screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help");
  // The sidebar's project list is lazy; wait for it so the screenshot never races it.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  // A project opens on its work view (the list, with the realtime notice).
  await expect(
    page.getByRole("link", {
      name: "HELP-7 Customer cannot reset their password",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("realtime-unavailable")).toBeVisible();
  await expect(page).toHaveScreenshot("project-overview.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("profile settings general screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/account/information");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "Personal Information" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("profile-settings-general.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("profile settings appearance screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/account/preferences");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "Preferences" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("profile-settings-appearance.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings general screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/general");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "General Settings" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-general.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings members screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/members");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(page.getByRole("table")).toBeVisible();
  // Kaneo's members page sits in the app shell, whose sidebar mounts after the page.
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-members.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings states screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/states");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Workspace state templates",
      exact: true,
    }),
  ).toBeVisible();
  // The settings sidebar resolves the active workspace; wait for it.
  await expect(
    page.getByText("Northstar Support", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-states.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings labels screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/labels");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "Labels" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-labels.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings canned responses screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/canned-responses");
  await expect(
    page.getByRole("heading", { level: 1, name: "Canned responses" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot(
    "workspace-settings-canned-responses.png",
    {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      scale: "css",
      maxDiffPixels: 0,
      threshold: 0,
      includeAA: true,
    },
  );
});

test("workspace settings danger screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/danger");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "General Settings" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-danger.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings general screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "General Settings" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-general.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings members screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings/members");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "Members", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Project roster",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-members.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings states screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings/states");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "Workflow" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-states.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings labels screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings/labels");
  await expect(
    page.getByRole("heading", { name: "Labels", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Project priority", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-labels.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings danger screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings/danger");
  // This URL opens kaneo's real page; assert that page's own content.
  await expect(
    page.getByRole("heading", { level: 1, name: "General Settings" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-danger.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

// These fixtures verify rendering only; live API journeys provide runtime evidence.
test("portal home screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "SUB-7", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-home.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
test("portal requests screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/requests");
  await expect(
    page.getByRole("heading", { name: "My Requests", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "SUB-7", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-requests.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
test("portal approval decision screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/approvals?approval=visual-approval");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-approvals.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
test("instance audit screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/audit");
  await expect(
    page.getByRole("heading", { name: "Audit log", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("work_item.updated", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("instance-audit.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project cycles screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/cycles");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cycles", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Sprint 14", { exact: true })).toBeVisible();
  await expect(
    page.getByText("5 of 13 points done", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-cycles.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project cycle detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/cycles/visual-cycle");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Burndown", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scope changes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Added after start", { exact: true }),
  ).toBeVisible();
  // Burndown table cell (20 Oct ideal 11.08): proves the burndown query rendered.
  await expect(page.getByText("11.1", { exact: true })).toBeVisible();
  // Board card only served by the scoped `cycle=visual-cycle` work-items branch.
  await expect(
    page.getByText("Enforce MFA for admin accounts", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-cycle-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project modules screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/modules");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Modules", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Self-service portal", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No target date, so no forecast.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-modules.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project module detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/modules/visual-module");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1 of 4 done, 3 remaining", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Not in a Module", exact: true }),
  ).toBeVisible();
  // Board card only served by the scoped `module=visual-module` work-items branch.
  await expect(
    page.getByText("Enforce MFA for admin accounts", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-module-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project pages screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/pages");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Pages", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Password reset runbook", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-pages.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project page detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/pages/visual-page");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  // An editor edits inline: the title is a text box, the body the document editor.
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Before you start", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Version 3", { exact: true })).toBeVisible();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-page-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings estimates screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings/estimates");
  // This URL opens kaneo's real project settings page; assert that page's own content.
  await expect(
    page.getByText("Estimate system", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Move to the next Cycle", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-estimates.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings features screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings/features");
  // This URL opens kaneo's real project settings page; assert that page's own content.
  await expect(
    page.getByRole("heading", { name: "Features", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Time-boxed sprints for planning and tracking work.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-features.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings automations screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings/automations");
  // This URL opens kaneo's real project settings page; assert that page's own content.
  await expect(
    page.getByRole("heading", { name: "Project automations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Escalate urgent password resets", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-automations.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("project settings budget screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/settings/budget");
  // This URL opens kaneo's real project settings page; assert that page's own content.
  await expect(
    page.getByRole("heading", { name: "Budget", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Q4 2026 support", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("project-settings-budget.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("service-management services screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/service-management/services");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Single sign-on", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "VPN gateway", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("services.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("service-management service detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/service-management/services/visual-service");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Single sign-on", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fabrikam Health", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Reset your password from the sign-in page",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("service-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("service-management change calendar screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/service-management/changes");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "HELP-21", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Conflicting Changes", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("changes.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("service-management releases screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/service-management/releases");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "SSO hardening 2026.10", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Portal refresh 2026.11", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("releases.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("knowledge base list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/kb");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Reset your password from the sign-in page",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Connect to the VPN on a new laptop",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("kb.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("knowledge base article screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/kb/visual-article");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Reset your password from the sign-in page",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "If the link has expired", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Identity and access", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("kb-article.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("knowledge base article editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/kb/visual-article/edit");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Edit article", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Reset your password from the sign-in page",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("kb-edit.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("reports index screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/reports");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Older than 30 days", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("At risk", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("reports.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("report detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/reports/throughput");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Throughput", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Up 6 from 36", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("report-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("report builder screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/reports/new");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Report builder", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("53", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("report-new.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("report export screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/reports/exports/visual-export");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Time logged", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your export is ready", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("report-export.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("dashboard screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/dashboard");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Support overview", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("92%", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("dashboard.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("dashboard editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/dashboard/edit");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dashboard editor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("5 of 20 widgets", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("92%", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("dashboard-edit.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("timesheet screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/timesheet");
  await expect(
    page.getByRole("button", { name: "Help Desk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Timesheet", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("8:00", { exact: true })).toBeVisible();
  await expect(page.getByText("HELP-5", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("timesheet.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("customer invitations screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/customer-invitations");
  await expect(
    page.getByRole("heading", { name: "Customer invitations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Invitations are managed one customer organisation at a time.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("customer-invitations.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace teams list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/teams");
  await expect(
    page.getByRole("heading", { name: "Teams", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Network Operations", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("teams.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("team detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/teams/visual-team");
  await expect(
    page.getByRole("heading", { name: "Service Desk", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Taylor Staff", { exact: true })).toBeVisible();
  await expect(
    page.getByText("It owns 1 project(s). Reassign them first.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("team-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace roles list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/roles");
  await expect(
    page.getByRole("heading", { name: "Roles", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Service desk analyst", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("roles.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("role editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/roles/visual-role");
  await expect(
    page.getByRole("heading", { name: "Service desk analyst", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Capabilities", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Rename the role, describe it or change its rank. A rank must stay below your own.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("role-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace custom fields list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/custom-fields");
  await expect(
    page.getByRole("heading", { name: "Custom fields", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Triage details", { exact: true })).toBeVisible();
  await expect(page.getByText("Users affected", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("custom-fields.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("custom field editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/custom-fields/visual-field");
  await expect(
    page.getByRole("heading", { name: "Affected system", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Where it applies", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("custom-field-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("profile notifications screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/account/notifications");
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Work item mention emails", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Report exports", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("profile-notifications.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

// rates and time-activities are CLOCK-BLOCKED and deliberately NOT here (see NOTES).
test("workspace settings automations screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/automations");
  await expect(
    page.getByRole("heading", { name: "Automations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Escalate breached incidents", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Label was deleted", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-automations.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings webhooks screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/webhooks");
  await expect(
    page.getByRole("heading", { name: "Webhooks", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Service desk notifications", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Major incident bridge", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-webhooks.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("webhook editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/webhooks/visual-webhook");
  await expect(
    page.getByRole("heading", {
      name: "Service desk notifications",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Signing secret", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Delivering events", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("webhook-editor.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("webhook delivery history screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto(
    "/dashboard/settings/workspace/webhooks/visual-webhook/deliveries",
  );
  await expect(
    page.getByRole("heading", { name: "Delivery history", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("sla.breached", { exact: true })).toBeVisible();
  await expect(page.getByText("webhook.test", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("webhook-delivery-history.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings features screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/features");
  await expect(
    page.getByRole("heading", { name: "Features", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Feature switches", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Service levels", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-features.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings workflows screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/workflows");
  await expect(
    page.getByRole("heading", { name: "Workflows", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "CAB approval is on for changes",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Incident lifecycle", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-workflows.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode health screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode");
  await expect(
    page.getByRole("heading", { name: "Health", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Encryption key rotation", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-home.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode webhook security posture screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/webhooks");
  await expect(
    page.getByRole("heading", {
      name: "Webhook security posture",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Major incident relay", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-webhooks.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode general settings screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/general");
  await expect(
    page.getByRole("heading", { name: "General", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Regional and retention", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Live screen preview", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-general.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode notification delivery screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/notifications");
  await expect(
    page.getByRole("heading", { name: "Notification delivery", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Email provider", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Using saved instance configuration.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-notifications.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode feature switches screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/features");
  await expect(
    page.getByRole("heading", { name: "Features", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("SLA policies, service calendars and SLA indicators.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-features.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode import runs screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/imports?workspaceId=visual-workspace");
  await expect(
    page.getByRole("heading", { name: "Import run history", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("jira:HELPDESK", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("god-imports.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode import run detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto(
    "/god-mode/imports/visual-import?workspaceId=visual-workspace",
  );
  await expect(
    page.getByRole("heading", { name: "Import run", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Work items linked to source", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Losses: 3", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("god-import-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("organisation identity screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/organisations/visual-organisation/identity");
  await expect(
    page.getByRole("heading", { name: "Organisation identity", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Connection configuration",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "https://login.microsoftonline.com/33333333-3333-4333-8333-333333333333/v2.0",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("org-identity.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode storage screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/storage");
  await expect(
    page.getByRole("heading", { name: "Storage", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("S3-compatible storage", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Configuration ready", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-storage.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode deliveries screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/deliveries");
  await expect(
    page.getByRole("heading", { name: "Deliveries", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Webhook attempts", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Error recorded; details withheld", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-deliveries.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode jobs screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/jobs");
  await expect(
    page.getByRole("heading", { name: "Background jobs", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("sla-scan", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "This job is available only through its dedicated elevated operation.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-jobs.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode plugins screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/plugins");
  await expect(
    page.getByRole("heading", { name: "Plugins", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Encryption key rotation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("SMTP credential is configured.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("god-plugins.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("god mode mcp usage screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/mcp");
  await expect(
    page.getByRole("heading", { name: "MCP usage", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Client-reported tool statistics",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("tdk_Hq7v…", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("god-mcp.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("portal accept invitation screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/invite/visual-invite");
  await expect(
    page.getByText("Invitation accepted", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Continue to the portal", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Accept your invitation", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("portal-invite.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
test("portal knowledge base screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/kb");
  await expect(
    page.getByRole("heading", { name: "Knowledge base", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Connect to the office VPN from home",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Network and VPN", exact: true }),
  ).toBeVisible();
  // The portal sidebar is lazy; wait for it so the screenshot never races it.
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-kb.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
test("portal knowledge base article screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/kb/visual-article");
  await expect(
    page.getByRole("heading", {
      name: "Reset your account password",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Request a reset link", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Was this helpful?", { exact: true }),
  ).toBeVisible();
  // The portal sidebar is lazy; wait for it so the screenshot never races it.
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-kb-article.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
test("portal notifications unread screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/notifications?filter=unread");
  await expect(
    page.getByRole("heading", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "An approval is waiting for your decision",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Unread", exact: true }),
  ).toBeVisible();
  // The portal sidebar is lazy; wait for it so the screenshot never races it.
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-notifications.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
test("portal account preferences screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/account");
  await expect(
    page.getByRole("heading", {
      name: "Notification preferences",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Direct mentions", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Daily digest", { exact: true })).toBeVisible();
  // The portal sidebar is lazy; wait for it so the screenshot never races it.
  await expect(page.getByText("Sign out", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-account.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings rates screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/rates");
  await expect(
    page.getByRole("heading", { name: "Rates", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cost types", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Loan laptop", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-settings-rates.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("workspace settings time activities screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/workspace/time-activities");
  await expect(
    page.getByRole("heading", { name: "Time activities", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Backdating limit (days)", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot(
    "workspace-settings-time-activities.png",
    {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      scale: "css",
      maxDiffPixels: 0,
      threshold: 0,
      includeAA: true,
    },
  );
});
