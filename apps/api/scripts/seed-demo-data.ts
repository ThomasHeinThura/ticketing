import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSubmissionReference } from "@taskdesk/domain";
import {
  BUILT_IN_ROLES,
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
  INSTANCE_ONLY_FEATURES,
  LOCKED_FEATURE_DEFAULTS,
} from "@taskdesk/permissions";
import bcrypt from "bcryptjs";
import { config } from "dotenv-mono";
import { and, eq, inArray, isNull, not, sql } from "drizzle-orm";
import { createApproval } from "../src/approval/service";
import { appendAuditLog } from "../src/audit/audit-writer";
import { getStoredAuthPluginConfigRows } from "../src/auth/repository";
import db, { getDatabasePool, schema } from "../src/database";
import { resolveDatabaseConfig } from "../src/database/resolve-database-url";
import {
  cycleScopeEventTable,
  cycleTable,
  moduleTable,
} from "../src/database/schema-p5-agile";
import { kbArticleTable, kbCategoryTable } from "../src/database/schema-p5-kb";
import { projectPageTable } from "../src/database/schema-p5-pages";
import {
  announcementOrganisationTable,
  announcementProjectTable,
  announcementTable,
  changeDetailTable,
  changeFreezeTable,
  changeServiceTable,
  serviceDependencyTable,
  serviceTable,
} from "../src/database/schema-p5-service";
import {
  acceptSubmission,
  createRequestType,
  createSubmission,
  publishRequestType,
} from "../src/intake/repository";
import {
  createArticle,
  createCategory,
  reviewStepEnabled,
  transitionArticle,
} from "../src/kb/repository";
import { lockWorkspaceLabelNames } from "../src/label/repository";
import { createPage } from "../src/pages/repository";
import { resolveIdentity } from "../src/permissions/resolve-identity";
import { DEFAULT_PROJECT_COLUMNS } from "../src/project/controllers/create-project";
import { ensureProjectLeadRole } from "../src/project/project-creator-grant";
import { scanWorkItemSla } from "../src/scheduler/sla-scan";
import { seedDefaultCabWorkflowInTransaction } from "../src/service-management/cab-template";
import { ensureInternalOrganisation } from "../src/utils/seed-internal-organisation";
import { seedProjectStates } from "../src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../src/utils/seed-workspace-defaults";
import { recordWorkItemActivity } from "../src/work-item/activity";
import { assignWorkItem } from "../src/work-item/controllers/assign-work-item";
import { createComment } from "../src/work-item/controllers/create-comment";
import { seedWorkspaceBuiltInRoles } from "../src/workspace/built-in-roles.repository";
import { syncWorkspaceAdminReach } from "../src/workspace/workspace-admin-reach";
import {
  ensureSystemRole,
  type SeedAccount,
  type Tx,
  upsertPerson,
  upsertScopedMembership,
  upsertUserAndPassword,
} from "./seed-sit-users";
import {
  ensureById as ensureByIdFor,
  fixtureConflict,
  markdownToDoc,
  membershipExists,
  UAT_FEATURE_FLAGS,
  UAT_LIVE_DATABASE_NAME,
} from "./seed-uat-users";

/**
 * Demo seed: one workspace, `demo-ws` ("Litware Managed IT"), that makes a fresh instance look
 * like a working service desk for screen reviews and demos. It is opt-in (`--demo`) and
 * STRICTLY ADDITIVE:
 *
 * - every row it writes directly has a `demo-` id; rows written by domain helpers (state
 *   templates, request types, submissions, KB, Pages, and the reviewer's assignment, comment,
 *   SLA scan, approval and their notifications, audit and outbox rows) carry generated ids but
 *   belong to `demo-ws`, its projects or its people;
 * - it never updates or deletes a row it did not create, and on a rerun it writes nothing;
 * - a `demo-` row (or a reserved email, slug or key) that differs from this fixture is a
 *   conflict: the seed throws before writing;
 * - it refuses a database that already holds workspaces outside the demo namespace unless
 *   `--allow-existing-data` is passed, and it never touches the live database name.
 *
 * Feature switches come on through `workspace_feature_flag` rows for `demo-ws` only; instance
 * rows are never written, except the customer password sign-in row that
 * `--enable-customer-password` adds when no such row exists. Sign-in details go to a private
 * file outside the checkout and are never printed.
 */

export const DEMO_WORKSPACE_ID = "demo-ws";
const DEMO_WORKSPACE_SLUG = "litware-managed-it-demo";
const DOMAIN = "demo.taskdesk.test";
const SEED = "Demo";
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** The same workspace-level switch set UAT uses: everything a reviewer can open is on. */
export const DEMO_FEATURE_FLAGS = UAT_FEATURE_FLAGS;

type Side = "staff" | "customer";
type WorkspaceRole = "owner" | "admin" | "lead" | "member" | "viewer";
type ProjectRole = "admin" | "cab" | "agent" | "viewer";

/**
 * The persona a reviewer signs in as to see a working day: the workspace admin. It holds
 * assigned work (My work) and an inbox written by the product's own producers.
 */
export const DEMO_REVIEWER_KEY = "admin";

export type DemoAccount = SeedAccount & {
  key: string;
  personId: string;
  side: Side;
  roleLabel: string;
  workspaceRole: WorkspaceRole | null;
  projectRole: ProjectRole | null;
};

function account(
  input: Omit<DemoAccount, "id" | "personId" | "password" | "userRole">,
): DemoAccount {
  return {
    ...input,
    id: `demo-user-${input.key}`,
    personId: `demo-person-${input.key}`,
    userRole: "user",
    password: randomBytes(24).toString("base64url"),
  };
}

// Display names are plain names; the role lives in the credentials file only (PH-11).
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  account({
    key: "owner",
    email: `hannah.brooks@${DOMAIN}`,
    name: "Hannah Brooks",
    roleLabel: "Workspace owner",
    side: "staff",
    workspaceRole: "owner",
    projectRole: null,
  }),
  account({
    key: "admin",
    email: `daniel.okafor@${DOMAIN}`,
    name: "Daniel Okafor",
    roleLabel: "Workspace admin and change approver",
    side: "staff",
    workspaceRole: "admin",
    // On every project roster so work can be assigned to them (AS-5).
    projectRole: "admin",
  }),
  account({
    key: "lead",
    email: `priya.raman@${DOMAIN}`,
    name: "Priya Raman",
    roleLabel: "Service delivery lead and change approver",
    side: "staff",
    workspaceRole: "lead",
    projectRole: "cab",
  }),
  account({
    key: "agent1",
    email: `tom.fischer@${DOMAIN}`,
    name: "Tom Fischer",
    roleLabel: "Service desk agent",
    side: "staff",
    workspaceRole: "member",
    projectRole: "agent",
  }),
  account({
    key: "agent2",
    email: `aisha.khan@${DOMAIN}`,
    name: "Aisha Khan",
    roleLabel: "Service desk agent",
    side: "staff",
    workspaceRole: "member",
    projectRole: "agent",
  }),
  account({
    key: "agent3",
    email: `lukas.novak@${DOMAIN}`,
    name: "Lukas Novak",
    roleLabel: "Infrastructure engineer",
    side: "staff",
    workspaceRole: "member",
    projectRole: "agent",
  }),
  account({
    key: "viewer",
    email: `grace.lee@${DOMAIN}`,
    name: "Grace Lee",
    roleLabel: "Read-only viewer",
    side: "staff",
    workspaceRole: "viewer",
    projectRole: "viewer",
  }),
  account({
    key: "contoso1",
    email: `megan.hall@contoso.${DOMAIN}`,
    name: "Megan Hall",
    roleLabel: "Customer, Contoso Ltd (IT manager)",
    side: "customer",
    workspaceRole: null,
    projectRole: null,
  }),
  account({
    key: "contoso2",
    email: `oliver.grant@contoso.${DOMAIN}`,
    name: "Oliver Grant",
    roleLabel: "Customer, Contoso Ltd (finance)",
    side: "customer",
    workspaceRole: null,
    projectRole: null,
  }),
];

const CONTOSO = {
  id: "demo-org-contoso",
  key: "demo-contoso",
  name: "Contoso Ltd",
  domain: [`contoso.${DOMAIN}`],
} as const;

const PROJECT_ROLES: Record<
  ProjectRole,
  { id: string; key: string; name: string; capabilities: string[] }
> = {
  // A project role overrides the workspace role on that project (rbac.md, "scopes narrow"),
  // so the admin's roster role carries the admin capability set and narrows nothing.
  admin: {
    id: "demo-role-project-admin",
    key: "demo-project-admin",
    name: "Workspace admin",
    capabilities: [...BUILT_IN_ROLES.admin.capabilities],
  },
  cab: {
    id: "demo-role-project-cab",
    key: "demo-project-cab",
    name: "Delivery lead and change approver",
    capabilities: [...BUILT_IN_ROLES.lead.capabilities, "approval:decide_cab"],
  },
  agent: {
    id: "demo-role-project-agent",
    key: "demo-project-agent",
    name: "Service desk agent",
    capabilities: [
      ...BUILT_IN_ROLES.member.capabilities,
      "approval:request_cab",
    ],
  },
  viewer: {
    id: "demo-role-project-viewer",
    key: "demo-project-viewer",
    name: "Read-only project viewer",
    capabilities: [...BUILT_IN_ROLES.viewer.capabilities],
  },
};

const CALENDARS = {
  business: "demo-calendar-business",
  always: "demo-calendar-24x7",
} as const;

type Priority = "low" | "medium" | "high" | "urgent";

const SLA_POLICIES = {
  business: {
    id: "demo-sla-business",
    key: "demo-contoso-support",
    name: "Contoso support SLA",
    description:
      "Business-hours response and resolution targets agreed with Contoso Ltd.",
    calendarId: CALENDARS.business,
    // [first response, resolution] in business minutes.
    targets: {
      urgent: [60, 480],
      high: [240, 960],
      medium: [480, 2400],
      low: [960, 4800],
    } satisfies Record<Priority, [number, number]>,
  },
  always: {
    id: "demo-sla-24x7",
    key: "demo-critical-infrastructure",
    name: "Critical infrastructure 24x7",
    description:
      "Round-the-clock targets for incidents on core infrastructure services.",
    calendarId: CALENDARS.always,
    targets: {
      urgent: [15, 240],
      high: [30, 480],
      medium: [120, 1440],
      low: [480, 4320],
    } satisfies Record<Priority, [number, number]>,
  },
} as const;
type SlaKey = keyof typeof SLA_POLICIES;
const SLA_TYPES = ["incident", "service-request", "problem", "change"] as const;

type ProjectKey = "CSD" | "MIG" | "INF";

const PROJECTS: Record<
  ProjectKey,
  {
    id: string;
    slug: string;
    name: string;
    description: string;
    icon: string;
    kind: "project" | "managed_service";
    org: boolean;
    sla: SlaKey | null;
  }
> = {
  CSD: {
    id: "demo-proj-contoso-desk",
    slug: "CSD",
    name: "Contoso Service Desk",
    description:
      "Managed service desk for Contoso Ltd: incidents, access and service requests from the customer portal, Monday to Friday 9:00 to 17:30.",
    icon: "Headset",
    kind: "managed_service",
    org: true,
    sla: "business",
  },
  MIG: {
    id: "demo-proj-contoso-m365",
    slug: "MIG",
    name: "Contoso Microsoft 365 Migration",
    description:
      "Fixed-scope project moving Contoso mailboxes, file shares and Teams to Microsoft 365 by the end of the year.",
    icon: "Globe",
    kind: "project",
    org: true,
    sla: null,
  },
  INF: {
    id: "demo-proj-infrastructure",
    slug: "INF",
    name: "Infrastructure Operations",
    description:
      "Internal infrastructure, monitoring and maintenance changes. Not visible to customers.",
    icon: "Server",
    kind: "project",
    org: false,
    sla: "always",
  },
};

const SERVICES = [
  {
    id: "demo-svc-email",
    name: "Email and calendar",
    description: "Exchange Online mailboxes, shared calendars and Outlook.",
    category: "Collaboration",
    supportLevel: "L1",
    calendar: CALENDARS.business,
    status: "operational",
    statusNote: null,
  },
  {
    id: "demo-svc-vpn",
    name: "Remote access VPN",
    description: "Always-on VPN for home and travelling staff.",
    category: "Network",
    supportLevel: "L2",
    calendar: CALENDARS.always,
    status: "degraded",
    statusNote:
      "Some home users are disconnected every 30 minutes. The provider is investigating.",
  },
  {
    id: "demo-svc-erp",
    name: "Finance ERP",
    description: "Dynamics 365 Finance: invoicing, approvals and month-end.",
    category: "Business applications",
    supportLevel: "L2",
    calendar: CALENDARS.business,
    status: "operational",
    statusNote: null,
  },
  {
    id: "demo-svc-files",
    name: "File shares and backup",
    description: "Department file shares and the nightly backup service.",
    category: "Infrastructure",
    supportLevel: "L2",
    calendar: CALENDARS.always,
    status: "operational",
    statusNote: null,
  },
  {
    id: "demo-svc-identity",
    name: "Identity and sign-in",
    description: "Entra ID accounts, multi-factor sign-in and single sign-on.",
    category: "Security",
    supportLevel: "L3",
    calendar: CALENDARS.always,
    status: "operational",
    statusNote: null,
  },
] as const;
type ServiceId = (typeof SERVICES)[number]["id"];

const SERVICE_DEPENDENCIES: [ServiceId, ServiceId][] = [
  ["demo-svc-email", "demo-svc-identity"],
  ["demo-svc-vpn", "demo-svc-identity"],
  ["demo-svc-erp", "demo-svc-identity"],
];

const LABELS = [
  { id: "demo-label-access", name: "Access", color: "teal" },
  { id: "demo-label-network", name: "Network", color: "blue" },
  { id: "demo-label-hardware", name: "Hardware", color: "orange" },
  { id: "demo-label-security", name: "Security", color: "red" },
  { id: "demo-label-email", name: "Email", color: "purple" },
  { id: "demo-label-migration", name: "Migration", color: "yellow" },
  { id: "demo-label-licensing", name: "Licensing", color: "green" },
] as const;
type LabelName = (typeof LABELS)[number]["name"];

type StateKey = "backlog" | "to-do" | "in-progress" | "done" | "cancelled";
type CycleKey = "s13" | "s14";
type ModuleKey = "mail" | "teams";

type ItemSpec = {
  n: number;
  title: string;
  type: string;
  priority: Priority;
  state: StateKey;
  assignee: string | null;
  requester?: string;
  /** Due date in days from now; negative for overdue or finished work. */
  due: number;
  /** Created this many hours before the seed runs. */
  ageHours: number;
  /** Minutes after creation of the first public response; omitted means none yet. */
  respondedAfterMin?: number;
  /** Hours after creation the item was resolved (done items). */
  resolvedAfterHours?: number;
  parent?: number;
  labels?: LabelName[];
  service?: ServiceId;
  cycle?: CycleKey;
  module?: ModuleKey;
  description: string;
};

const CSD_ITEMS: ItemSpec[] = [
  {
    n: 1,
    title: "VPN disconnects every 30 minutes when working from home",
    type: "incident",
    priority: "urgent",
    state: "in-progress",
    assignee: "agent1",
    requester: "contoso1",
    due: -1,
    ageHours: 144,
    respondedAfterMin: 45,
    labels: ["Network"],
    service: "demo-svc-vpn",
    description:
      "Several finance staff lose the VPN roughly every half hour and have to reconnect. Started after the provider maintenance last week.",
  },
  {
    n: 2,
    title: "Outlook asks for a password after the latest Windows update",
    type: "incident",
    priority: "high",
    state: "in-progress",
    assignee: "agent2",
    requester: "contoso2",
    due: 1,
    ageHours: 20,
    respondedAfterMin: 40,
    labels: ["Email"],
    service: "demo-svc-email",
    description:
      "Since Tuesday's update Outlook prompts for the password every few minutes. The web version works.",
  },
  {
    n: 3,
    title: "Laptops for three new starters in the Leeds finance team",
    type: "service-request",
    priority: "medium",
    state: "to-do",
    assignee: "agent3",
    requester: "contoso2",
    due: 6,
    ageHours: 30,
    respondedAfterMin: 90,
    labels: ["Hardware"],
    description:
      "Three new starters join on the 1st and need standard finance laptops with the accounting software installed.",
  },
  {
    n: 4,
    title: "Send-as access to the accounts shared mailbox",
    type: "service-request",
    priority: "low",
    state: "done",
    assignee: "admin",
    requester: "contoso2",
    due: -10,
    ageHours: 336,
    respondedAfterMin: 50,
    resolvedAfterHours: 6,
    labels: ["Access", "Email"],
    service: "demo-svc-email",
    description:
      "Please give Oliver Grant send-as access to the accounts shared mailbox.",
  },
  {
    n: 5,
    title: "Second floor printer shows as offline",
    type: "incident",
    priority: "medium",
    state: "backlog",
    // Assigned to the admin after seeding, through the assignment service (inbox row).
    assignee: null,
    requester: "contoso1",
    due: 9,
    ageHours: 8,
    labels: ["Hardware"],
    description:
      "The printer by the kitchen on the second floor shows as offline for everyone.",
  },
  {
    n: 6,
    title: "Increase the SharePoint storage quota for the projects site",
    type: "service-request",
    priority: "medium",
    state: "to-do",
    assignee: "agent1",
    requester: "contoso2",
    due: 12,
    ageHours: 50,
    respondedAfterMin: 120,
    description:
      "The projects site is at 95% of its quota. Please increase it or advise on archiving.",
  },
  {
    n: 7,
    title: "Phishing email reported by reception",
    type: "incident",
    priority: "urgent",
    state: "done",
    assignee: "lead",
    requester: "contoso1",
    due: -20,
    ageHours: 624,
    respondedAfterMin: 20,
    resolvedAfterHours: 3,
    labels: ["Security"],
    service: "demo-svc-email",
    description:
      "Reception received an email pretending to be from the bank. Nobody clicked the link. Please block the sender.",
  },
  {
    n: 8,
    title: "Teams calls drop audio after about ten minutes",
    type: "problem",
    priority: "high",
    state: "in-progress",
    assignee: "agent2",
    requester: "contoso1",
    due: 4,
    ageHours: 72,
    respondedAfterMin: 60,
    labels: ["Network"],
    description:
      "Several people report that call audio stops after around ten minutes. Rejoining fixes it for a while.",
  },
  {
    n: 9,
    title: "Reset multi-factor sign-in for a travelling sales manager",
    type: "service-request",
    priority: "high",
    state: "done",
    assignee: "agent1",
    requester: "contoso2",
    due: -5,
    ageHours: 168,
    respondedAfterMin: 15,
    resolvedAfterHours: 2,
    labels: ["Access", "Security"],
    service: "demo-svc-identity",
    description:
      "Lost phone while travelling. Identity confirmed by a call with the line manager.",
  },
  {
    n: 10,
    title: "Invoice approval emails from the finance system are not sent",
    type: "incident",
    priority: "high",
    state: "to-do",
    assignee: "agent3",
    requester: "contoso2",
    due: 2,
    ageHours: 4,
    service: "demo-svc-erp",
    description:
      "Approvers have not received invoice approval emails since this morning. Invoices are piling up in the queue.",
  },
  {
    n: 11,
    title: "Guest Wi-Fi vouchers for the client workshop on Thursday",
    type: "service-request",
    priority: "low",
    state: "to-do",
    assignee: "agent1",
    requester: "contoso1",
    due: 3,
    ageHours: 26,
    respondedAfterMin: 180,
    labels: ["Network"],
    description:
      "Twelve visitors need guest Wi-Fi for the day. Please send the voucher codes to Megan.",
  },
  {
    n: 12,
    title: "Install the accounting software update on finance PCs",
    type: "service-request",
    priority: "low",
    state: "cancelled",
    assignee: "agent3",
    requester: "contoso2",
    due: -12,
    ageHours: 480,
    respondedAfterMin: 240,
    description:
      "Cancelled: the update is already part of the new laptop build for the new starters.",
  },
  {
    n: 13,
    title: "Enable mailbox auditing for all Contoso users",
    type: "change",
    priority: "low",
    state: "to-do",
    assignee: "lead",
    requester: "contoso1",
    due: 5,
    ageHours: 72,
    respondedAfterMin: 60,
    labels: ["Security", "Email"],
    service: "demo-svc-email",
    description:
      "Turn on mailbox audit logging for every Contoso mailbox, as requested by their auditors.",
  },
  {
    n: 14,
    title: "Upgrade the finance system to the November release",
    type: "change",
    priority: "high",
    state: "to-do",
    assignee: "lead",
    requester: "contoso2",
    due: 13,
    ageHours: 120,
    respondedAfterMin: 30,
    service: "demo-svc-erp",
    description:
      "Apply the vendor's November release to Dynamics 365 Finance. Planned inside the month-end freeze and needs to move.",
  },
  {
    n: 15,
    title: "Roll out a conditional access policy for Contoso administrators",
    type: "change",
    priority: "medium",
    state: "backlog",
    assignee: "agent1",
    requester: "contoso1",
    due: 25,
    ageHours: 48,
    respondedAfterMin: 90,
    labels: ["Security", "Access"],
    service: "demo-svc-identity",
    description:
      "Require compliant devices and phishing-resistant sign-in for all Contoso admin accounts.",
  },
  {
    n: 16,
    title: "Mobile phone for the new finance director",
    type: "service-request",
    priority: "medium",
    state: "done",
    assignee: "agent3",
    requester: "contoso2",
    due: -30,
    ageHours: 912,
    respondedAfterMin: 70,
    resolvedAfterHours: 48,
    labels: ["Hardware"],
    description:
      "Standard company phone with email, Teams and the authenticator app set up before the first day.",
  },
];

const MIG_ITEMS: ItemSpec[] = [
  {
    n: 1,
    title: "Epic: Move Contoso mailboxes to Exchange Online",
    type: "epic",
    priority: "high",
    state: "in-progress",
    assignee: "lead",
    due: 21,
    ageHours: 900,
    module: "mail",
    description:
      "All 140 Contoso mailboxes and 18 shared mailboxes move to Exchange Online in three waves.",
  },
  {
    n: 2,
    title: "Inventory mailboxes and shared mailboxes",
    type: "story",
    priority: "medium",
    state: "done",
    assignee: "agent2",
    due: -14,
    ageHours: 860,
    resolvedAfterHours: 120,
    parent: 1,
    module: "mail",
    cycle: "s13",
    labels: ["Migration"],
    description:
      "Export every mailbox with its size, delegates and forwarding rules into the migration workbook.",
  },
  {
    n: 3,
    title: "Pilot migration for the IT team (12 mailboxes)",
    type: "story",
    priority: "high",
    state: "done",
    assignee: "agent1",
    due: -9,
    ageHours: 720,
    resolvedAfterHours: 200,
    parent: 1,
    module: "mail",
    cycle: "s13",
    labels: ["Migration"],
    description:
      "Move the IT team first and collect feedback before the department waves.",
  },
  {
    n: 4,
    title: "Migrate the finance department mailboxes",
    type: "story",
    priority: "high",
    state: "in-progress",
    assignee: "agent1",
    due: 3,
    ageHours: 400,
    parent: 1,
    module: "mail",
    cycle: "s14",
    labels: ["Migration", "Email"],
    description:
      "Wave two: 38 finance mailboxes over the weekend, outside month-end.",
  },
  {
    n: 5,
    title: "Update MX and autodiscover records after the cutover",
    type: "task",
    priority: "urgent",
    state: "to-do",
    assignee: "agent2",
    due: 6,
    ageHours: 380,
    parent: 1,
    module: "mail",
    cycle: "s14",
    labels: ["Network"],
    description:
      "Point mail flow at Exchange Online once wave two is complete, and lower the TTL a day before.",
  },
  {
    n: 6,
    title: "Write the end-user guide for the new Outlook profile",
    type: "task",
    priority: "medium",
    state: "in-progress",
    assignee: "agent3",
    due: 5,
    ageHours: 300,
    module: "mail",
    cycle: "s14",
    description:
      "One page with screenshots: what changes, what to do on Monday morning, who to call.",
  },
  {
    n: 7,
    title: "Mobile device re-enrolment checklist",
    type: "task",
    priority: "low",
    state: "to-do",
    assignee: "agent3",
    due: 7,
    ageHours: 280,
    cycle: "s14",
    description:
      "Steps for staff to remove and re-add their mail account on iPhone and Android.",
  },
  {
    n: 8,
    title: "Epic: Teams and SharePoint rollout",
    type: "epic",
    priority: "medium",
    state: "backlog",
    assignee: "lead",
    due: 45,
    ageHours: 880,
    module: "teams",
    description:
      "Replace department file shares with SharePoint sites and set up Teams for every department.",
  },
  {
    n: 9,
    title: "Map department file shares to SharePoint sites",
    type: "story",
    priority: "medium",
    state: "to-do",
    assignee: "agent2",
    due: 30,
    ageHours: 500,
    parent: 8,
    module: "teams",
    labels: ["Migration"],
    description:
      "Agree a site per department and list the folders that move, archive or stay.",
  },
  {
    n: 10,
    title: "Confirm E3 and E5 licence allocation with Contoso finance",
    type: "task",
    priority: "high",
    state: "in-progress",
    assignee: "admin",
    due: -1,
    ageHours: 200,
    cycle: "s14",
    labels: ["Licensing"],
    description:
      "Finance and directors need E5; everyone else gets E3. Confirm numbers before the next invoice.",
  },
  {
    n: 11,
    title: "Calendar sharing breaks for migrated users",
    type: "bug",
    priority: "urgent",
    state: "in-progress",
    assignee: "agent1",
    due: 1,
    ageHours: 30,
    cycle: "s14",
    labels: ["Email"],
    description:
      "Migrated users cannot see the calendars of colleagues who have not moved yet.",
  },
];

const INF_ITEMS: ItemSpec[] = [
  {
    n: 1,
    title: "Backup job failed overnight for the finance file share",
    type: "incident",
    priority: "urgent",
    state: "in-progress",
    assignee: "admin",
    due: 0,
    // 198 of 240 minutes used: at risk on the 24x7 policy.
    ageHours: 3.3,
    respondedAfterMin: 10,
    service: "demo-svc-files",
    description:
      "The 01:00 backup of the finance share failed with a snapshot timeout. Last good copy is from the night before.",
  },
  {
    n: 2,
    title: "Disk usage above 85% on the SQL01 database server",
    type: "incident",
    priority: "medium",
    state: "in-progress",
    assignee: "agent2",
    due: 1,
    ageHours: 1,
    respondedAfterMin: 20,
    service: "demo-svc-erp",
    description:
      "The data volume on SQL01 crossed 85%. Transaction log growth from the month-end jobs is the likely cause.",
  },
  {
    n: 3,
    title: "Monitoring alert storm from the Leeds switch stack",
    type: "incident",
    priority: "high",
    state: "to-do",
    assignee: "agent3",
    due: 1,
    ageHours: 30,
    labels: ["Network"],
    service: "demo-svc-vpn",
    description:
      "Over 300 interface flap alerts overnight from the Leeds stack. Users have not reported problems yet.",
  },
  {
    n: 4,
    title: "Patch hypervisor cluster HV-01 to HV-04",
    type: "change",
    priority: "medium",
    state: "to-do",
    assignee: "agent1",
    due: 2,
    ageHours: 96,
    respondedAfterMin: 30,
    labels: ["Security"],
    service: "demo-svc-files",
    description:
      "Apply the November hypervisor updates one host at a time, moving workloads before each reboot.",
  },
  {
    n: 5,
    title: "Replace the core switch in the Leeds office",
    type: "change",
    priority: "high",
    state: "to-do",
    assignee: "agent3",
    due: 2,
    ageHours: 110,
    respondedAfterMin: 45,
    labels: ["Network", "Hardware"],
    service: "demo-svc-vpn",
    description:
      "Swap the failing core switch. Overlaps the hypervisor patching window and touches the same storage links.",
  },
  {
    n: 6,
    title: "Renew the VPN gateway certificates",
    type: "change",
    priority: "medium",
    state: "done",
    assignee: "agent2",
    due: -6,
    ageHours: 240,
    respondedAfterMin: 25,
    resolvedAfterHours: 100,
    labels: ["Security", "Network"],
    service: "demo-svc-vpn",
    description:
      "Renewed both gateway certificates and updated the client profile. No user impact.",
  },
  {
    n: 7,
    title: "Move file share backups to the new storage account",
    type: "change",
    priority: "medium",
    state: "backlog",
    assignee: "agent2",
    due: 20,
    ageHours: 60,
    respondedAfterMin: 60,
    service: "demo-svc-files",
    description:
      "Point the backup jobs at the new storage account and run one full restore test.",
  },
  {
    n: 8,
    title: "Quarterly review of administrator accounts",
    type: "task",
    priority: "medium",
    state: "to-do",
    assignee: "admin",
    due: 14,
    ageHours: 150,
    labels: ["Security", "Access"],
    description:
      "Export every account with admin rights, confirm each with its owner and remove the rest.",
  },
  {
    n: 9,
    title: "Renew the wildcard TLS certificate",
    type: "task",
    priority: "urgent",
    state: "done",
    assignee: "agent1",
    due: -3,
    ageHours: 400,
    resolvedAfterHours: 30,
    labels: ["Security"],
    description:
      "Renewed, deployed to the load balancers and updated the expiry check in monitoring.",
  },
];

const ITEMS: Record<ProjectKey, ItemSpec[]> = {
  CSD: CSD_ITEMS,
  MIG: MIG_ITEMS,
  INF: INF_ITEMS,
};

/** Change windows, in days from today (UTC) and hours of that day. */
const CHANGES: {
  item: `${ProjectKey}-${number}`;
  risk: "low" | "medium" | "high";
  startDay: number;
  startHour: number;
  hours: number;
  services: ServiceId[];
  rollback: string;
  approved?: boolean;
}[] = [
  {
    item: "INF-4",
    risk: "medium",
    startDay: 2,
    startHour: 20,
    hours: 3,
    services: ["demo-svc-files"],
    rollback: "Move workloads back and boot each host from the previous image.",
    approved: true,
  },
  {
    // Overlaps INF-4 and shares the file service: a conflict on the change calendar.
    item: "INF-5",
    risk: "high",
    startDay: 2,
    startHour: 21,
    hours: 4,
    services: ["demo-svc-vpn", "demo-svc-files"],
    rollback: "Reconnect the old switch, which stays racked until Monday.",
  },
  {
    item: "INF-6",
    risk: "medium",
    startDay: -6,
    startHour: 19,
    hours: 2,
    services: ["demo-svc-vpn"],
    rollback: "Re-import the previous certificates from the vault.",
    approved: true,
  },
  {
    item: "INF-7",
    risk: "medium",
    startDay: 20,
    startHour: 18,
    hours: 6,
    services: ["demo-svc-files"],
    rollback: "Keep the old backup target until two restores succeed.",
  },
  {
    item: "CSD-13",
    risk: "low",
    startDay: 5,
    startHour: 18,
    hours: 1,
    services: ["demo-svc-email"],
    rollback: "Turn mailbox auditing off again with the same script.",
    approved: true,
  },
  {
    // Inside the month-end freeze: shown as frozen on the change calendar.
    item: "CSD-14",
    risk: "high",
    startDay: 13,
    startHour: 19,
    hours: 4,
    services: ["demo-svc-erp"],
    rollback: "Restore the pre-upgrade database snapshot and application tier.",
  },
  {
    item: "CSD-15",
    risk: "medium",
    startDay: 25,
    startHour: 17,
    hours: 2,
    services: ["demo-svc-identity"],
    rollback: "Switch the policy to report-only mode.",
  },
];

const FREEZES = [
  {
    id: "demo-freeze-month-end",
    name: "Month-end close freeze",
    reason:
      "Contoso finance closes the month. No changes to finance systems or their dependencies.",
    startDay: 12,
    days: 3,
  },
  {
    id: "demo-freeze-year-end",
    name: "Christmas and New Year change freeze",
    reason: "Reduced staffing over the holidays. Emergency changes only.",
    startDay: 40,
    days: 14,
  },
] as const;

const COMMENTS: {
  id: string;
  item: `${ProjectKey}-${number}`;
  author: string;
  visibility: "public" | "internal";
  hoursAgo: number;
  text: string;
}[] = [
  {
    id: "demo-comment-csd-1-a",
    item: "CSD-1",
    author: "agent1",
    visibility: "public",
    hoursAgo: 140,
    text: "Thanks Megan. Does it happen on the office Wi-Fi too, or only at home?",
  },
  {
    id: "demo-comment-csd-1-b",
    item: "CSD-1",
    author: "contoso1",
    visibility: "public",
    hoursAgo: 120,
    text: "Only at home. Three of us are affected, all on the same broadband provider.",
  },
  {
    id: "demo-comment-csd-1-c",
    item: "CSD-1",
    author: "lead",
    visibility: "internal",
    hoursAgo: 30,
    text: "This has breached its resolution target. Tom, please escalate to the VPN provider today.",
  },
  {
    id: "demo-comment-csd-2-a",
    item: "CSD-2",
    author: "agent2",
    visibility: "internal",
    hoursAgo: 18,
    text: "Looks like the cached credential issue from the October update. Trying the credential manager fix first.",
  },
  {
    id: "demo-comment-csd-14-a",
    item: "CSD-14",
    author: "lead",
    visibility: "internal",
    hoursAgo: 20,
    text: "This window sits inside the month-end freeze. Proposing the following Tuesday instead.",
  },
  {
    id: "demo-comment-mig-4-a",
    item: "MIG-4",
    author: "agent1",
    visibility: "internal",
    hoursAgo: 10,
    text: "22 of 38 finance mailboxes are synced. The rest finish tonight.",
  },
  {
    id: "demo-comment-inf-1-a",
    item: "INF-1",
    author: "agent1",
    visibility: "internal",
    hoursAgo: 3,
    text: "Snapshot timed out on the storage array. Rerunning the job manually now.",
  },
  {
    id: "demo-comment-inf-5-a",
    item: "INF-5",
    author: "agent3",
    visibility: "internal",
    hoursAgo: 20,
    text: "Conflicts with the hypervisor patching on the same night. Can we move one of them?",
  },
];

const CYCLES: Record<
  CycleKey,
  { id: string; name: string; startDay: number; endDay: number; done: boolean }
> = {
  s13: {
    id: "demo-cycle-mig-13",
    name: "Sprint 13",
    startDay: -21,
    endDay: -8,
    done: true,
  },
  s14: {
    id: "demo-cycle-mig-14",
    name: "Sprint 14",
    startDay: -7,
    endDay: 7,
    done: false,
  },
};

const MODULES: Record<
  ModuleKey,
  {
    id: string;
    name: string;
    description: string;
    state: "planned" | "in_progress";
    targetDay: number;
  }
> = {
  mail: {
    id: "demo-module-mig-mail",
    name: "Mailbox migration",
    description: "Every Contoso mailbox on Exchange Online, in three waves.",
    state: "in_progress",
    targetDay: 21,
  },
  teams: {
    id: "demo-module-mig-teams",
    name: "Teams and SharePoint rollout",
    description: "Department sites and Teams replacing the file shares.",
    state: "planned",
    targetDay: 45,
  },
};

const REQUEST_TYPES = [
  {
    name: "Report a problem",
    group: "Support",
    description: "Something is broken or not working as expected.",
    type: "incident",
    fields: [
      {
        key: "summary",
        type: "text",
        label: "Short summary",
        required: true,
        mapsTo: { field: "title" },
      },
      {
        key: "details",
        type: "textarea",
        label: "What happened?",
        required: true,
        mapsTo: { field: "description" },
      },
      {
        key: "impact",
        type: "select",
        label: "How badly does it affect you?",
        options: ["Blocked", "Slowed down", "Minor"],
        mapsTo: {
          field: "priority",
          map: { Blocked: "urgent", "Slowed down": "high", Minor: "low" },
        },
      },
    ],
  },
  {
    name: "Access request",
    group: "Accounts and access",
    description: "Ask for access to a system, application or shared folder.",
    type: "service-request",
    fields: [
      {
        key: "summary",
        type: "text",
        label: "What do you need access to?",
        required: true,
        mapsTo: { field: "title" },
      },
      {
        key: "details",
        type: "textarea",
        label: "Why do you need it?",
        mapsTo: { field: "description" },
      },
    ],
  },
  {
    name: "Change request",
    group: "Changes",
    description: "Ask us to plan a change to a system you use.",
    type: "change",
    fields: [
      {
        key: "summary",
        type: "text",
        label: "What should change?",
        required: true,
        mapsTo: { field: "title" },
      },
      {
        key: "details",
        type: "textarea",
        label: "When and why?",
        required: true,
        mapsTo: { field: "description" },
      },
    ],
  },
  {
    name: "General question",
    group: "Support",
    description: "Ask a question that does not fit another form.",
    type: "service-request",
    fields: [
      {
        key: "summary",
        type: "text",
        label: "Your question",
        required: true,
        mapsTo: { field: "title" },
      },
      {
        key: "details",
        type: "textarea",
        label: "Anything else we should know?",
        mapsTo: { field: "description" },
      },
    ],
  },
] as const;

const SUBMISSIONS: {
  requester: string;
  requestType: (typeof REQUEST_TYPES)[number]["name"];
  summary: string;
  details: string;
  impact?: "Blocked" | "Slowed down" | "Minor";
  visibility: "private" | "organisation";
  acceptedBy?: string;
}[] = [
  {
    // Close to CSD-1: triage shows it as a suspected duplicate.
    requester: "contoso2",
    requestType: "Report a problem",
    summary: "VPN disconnects every few minutes when working from home",
    details: "Since Monday the VPN drops all the time on my home broadband.",
    impact: "Slowed down",
    visibility: "organisation",
  },
  {
    requester: "contoso2",
    requestType: "Access request",
    summary: "Finance system access for a new accounts assistant",
    details: "Read-only access to invoices for Sam Patel from next Monday.",
    visibility: "private",
  },
  {
    requester: "contoso1",
    requestType: "General question",
    summary: "How do I add a shared calendar on my iPhone?",
    details: "I use the built-in Calendar app, not Outlook.",
    visibility: "organisation",
  },
  {
    requester: "contoso2",
    requestType: "Change request",
    summary: "Add two new cost centres for the Leeds team",
    details: "Cost centres 4410 and 4420 from 1 December.",
    visibility: "organisation",
    acceptedBy: "agent1",
  },
  {
    requester: "contoso1",
    requestType: "Report a problem",
    summary: "Meeting room screen will not share from laptops",
    details: "The screen in the Harbour room shows no signal when we plug in.",
    impact: "Minor",
    visibility: "organisation",
    acceptedBy: "agent2",
  },
];

const SAVED_VIEWS: {
  id: string;
  name: string;
  owner: string;
  scope: "workspace" | ProjectKey;
  layout: "list" | "table" | "board";
  query: Record<string, unknown>;
}[] = [
  {
    id: "demo-view-urgent-high",
    name: "Urgent and high priority",
    owner: "lead",
    scope: "workspace",
    layout: "list",
    query: {
      entity: "work_item",
      filter: { field: "priority", op: "in", value: ["urgent", "high"] },
      sort: [{ field: "dueDate", direction: "asc" }],
    },
  },
  {
    id: "demo-view-my-open-work",
    name: "My open work",
    owner: "lead",
    scope: "workspace",
    layout: "board",
    query: {
      entity: "work_item",
      filter: {
        op: "and",
        clauses: [
          { field: "assignee", op: "eq", value: "@me" },
          { field: "state.group", op: "in", value: ["unstarted", "started"] },
        ],
      },
    },
  },
  {
    id: "demo-view-csd-due-week",
    name: "Due in the next 7 days",
    owner: "agent1",
    scope: "CSD",
    layout: "table",
    query: {
      entity: "work_item",
      filter: { field: "dueDate", op: "lte", value: "7d" },
      sort: [{ field: "priority", direction: "desc" }],
    },
  },
];

const ANNOUNCEMENTS = [
  {
    id: "demo-announcement-vpn",
    title: "Intermittent VPN disconnects for home workers",
    body: "Some Contoso staff working from home are disconnected from the VPN every 30 minutes. Our provider is investigating. Reconnecting restores access; we will post an update by 16:00.",
    severity: "incident",
    audience: "projects",
    startHours: -3,
    endDays: null,
  },
  {
    id: "demo-announcement-maintenance",
    title: "Planned maintenance: finance system upgrade moved",
    body: "The finance system upgrade planned during month-end has moved to the following Tuesday evening, 19:00 to 23:00. The system will be unavailable during that window.",
    severity: "maintenance",
    audience: "organisations",
    startHours: -24,
    endDays: 20,
  },
] as const;

const KB_CATEGORIES = [
  "Getting started",
  "Accounts and access",
  "Troubleshooting",
] as const;

const KB_ARTICLES: {
  title: string;
  category: (typeof KB_CATEGORIES)[number];
  customerVisible: boolean;
  markdown: string;
}[] = [
  {
    title: "How to raise a request in the customer portal",
    category: "Getting started",
    customerVisible: true,
    markdown: `Use the customer portal to ask for help. Choose the form that fits best.

1. Sign in to the customer portal.
2. Choose a form, for example **Report a problem** or **Access request**.
3. Fill in the summary and the details, then submit.

You can follow progress and reply to the service desk from **My requests**.`,
  },
  {
    title: "Reset your password",
    category: "Accounts and access",
    customerVisible: true,
    markdown: `Use **Forgot password** on the sign-in page.

- The reset link is valid for one hour.
- Check your junk folder if the email does not arrive.
- Contact the service desk if your account is locked.`,
  },
  {
    title: "Connect to the VPN from home",
    category: "Troubleshooting",
    customerVisible: true,
    markdown: `1. Open the VPN client from the system tray.
2. Choose the **Head office** profile and select **Connect**.
3. Approve the sign-in request on your phone.

## If it keeps disconnecting

- Restart your home router.
- Make sure the client is the latest version.
- Report a problem in the portal and include the time it dropped.`,
  },
  {
    title: "What our priority levels mean",
    category: "Getting started",
    customerVisible: true,
    markdown: `- **Urgent**: you cannot work and there is no workaround. First response within 1 business hour.
- **High**: work is badly affected. First response within 4 business hours.
- **Medium**: work is affected but you can continue. First response within 1 business day.
- **Low**: questions and small requests. First response within 2 business days.`,
  },
  {
    title: "Set up multi-factor sign-in on a new phone",
    category: "Accounts and access",
    customerVisible: true,
    markdown: `1. Install the authenticator app on the new phone.
2. Sign in at the security info page from a computer.
3. Choose **Add sign-in method** and scan the QR code.

If you no longer have the old phone, raise an **Access request** and we will reset it after confirming your identity.`,
  },
  {
    title: "Triage checklist for new requests",
    category: "Troubleshooting",
    customerVisible: false,
    markdown: `1. Check the requester's organisation and the request type.
2. Look for duplicates before accepting.
3. Set the priority from the impact the customer selected.
4. Accept into the right project and assign an agent.`,
  },
];

const PAGES: { project: ProjectKey; title: string; markdown: string }[] = [
  {
    project: "CSD",
    title: "Contoso service desk handbook",
    markdown: `Contoso Ltd is supported Monday to Friday, 9:00 to 17:30 UK time, excluding UK bank holidays.

## Contacts

- Megan Hall: IT manager, main contact.
- Oliver Grant: finance, approves new starters and purchases.

## Agreed service levels

Response and resolution targets follow the **Contoso support SLA**.`,
  },
  {
    project: "MIG",
    title: "Migration plan and wave schedule",
    markdown: `Contoso moves to Microsoft 365 in three mailbox waves, then Teams and SharePoint.

## Waves

- Wave 1: IT team, 12 mailboxes (done).
- Wave 2: finance, 38 mailboxes (this sprint).
- Wave 3: everyone else, 90 mailboxes (after month-end).

## Risks

- Calendar sharing between migrated and not-yet-migrated users.
- Month-end freeze limits the weekends we can use.`,
  },
  {
    project: "INF",
    title: "Major incident runbook",
    markdown: `Use this when a service is down for more than one customer.

1. Open an urgent incident and assign the on-call engineer.
2. Tell the delivery lead and post a status update every 30 minutes.
3. Record each action as an internal comment on the incident.
4. After recovery, write a short review within two business days.`,
  },
  {
    project: "INF",
    title: "Change window guidelines",
    markdown: `- Standard window: weekdays from 18:00, weekends any time.
- No changes to finance systems during the month-end freeze.
- Every change names its rollback before approval.`,
  },
];

// ---------------------------------------------------------------------------------------------

function ensureById<T extends Parameters<typeof ensureByIdFor>[1]>(
  tx: Tx,
  table: T,
  values: T["$inferInsert"] & { id: string },
  identity: readonly string[],
  kind: string,
) {
  return ensureByIdFor(tx, table, values, identity, kind, SEED);
}

function conflict(kind: string, key: string): never {
  return fixtureConflict(kind, key, SEED);
}

type Args = {
  credentialsFile: string;
  allowExistingData: boolean;
  enableCustomerPassword: boolean;
};

export function parseDemoArgs(argv: readonly string[]): Args {
  if (!argv.includes("--demo"))
    throw new Error(
      "seed-demo requires --demo and a private --credentials-file destination. It adds a demo workspace; never run it on a live database.",
    );
  const index = argv.indexOf("--credentials-file");
  const credentialsFile = index >= 0 ? argv[index + 1] : undefined;
  if (!credentialsFile || credentialsFile.startsWith("--"))
    throw new Error(
      "Supply --credentials-file with a private file outside the source checkout.",
    );
  return {
    credentialsFile,
    allowExistingData: argv.includes("--allow-existing-data"),
    enableCustomerPassword: argv.includes("--enable-customer-password"),
  };
}

function assertNotLiveDatabase(name: string) {
  if (name === UAT_LIVE_DATABASE_NAME)
    throw new Error(
      `Demo seed refused: ${UAT_LIVE_DATABASE_NAME} is the live database and must never be seeded.`,
    );
}

function resolveCredentialsDestination(credentialsFile: string) {
  const destination = path.join(
    realpathSync(path.dirname(path.resolve(credentialsFile))),
    path.basename(credentialsFile),
  );
  const repository = realpathSync(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  const relative = path.relative(repository, destination);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
    throw new Error(
      "Demo credentials must be written outside the source checkout.",
    );
  return destination;
}

/** Reads an existing private credentials file into the account list; false when absent. */
function loadExistingCredentials(destination: string): boolean {
  let parsed: unknown;
  try {
    const info = lstatSync(destination);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
      throw new Error(
        "The credentials file must be a private regular file (mode 0600).",
      );
    parsed = JSON.parse(readFileSync(destination, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
  const rows = (parsed as { accounts?: unknown }).accounts;
  if (!Array.isArray(rows) || rows.length !== DEMO_ACCOUNTS.length)
    throw new Error(
      `The private credentials file must contain exactly the ${DEMO_ACCOUNTS.length} demo accounts.`,
    );
  for (const demo of DEMO_ACCOUNTS) {
    const matching = rows.filter((row) => row && row.email === demo.email);
    if (
      matching.length !== 1 ||
      typeof matching[0].password !== "string" ||
      matching[0].password.length < 24
    )
      throw new Error(
        "The private credentials file has missing, duplicate or weak account credentials.",
      );
    demo.password = matching[0].password;
  }
  return true;
}

/**
 * Read-only checks before anything is written: the live database name, data outside the demo
 * namespace, and every globally unique name this seed claims.
 */
async function precheck(
  credentialsLoaded: boolean,
  allowExistingData: boolean,
) {
  const [{ name } = { name: "" }] = (
    await db.execute<{ name: string }>(sql`SELECT current_database() AS name`)
  ).rows;
  assertNotLiveDatabase(name);

  const foreign = await db
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(not(sql`${schema.workspaceTable.id} LIKE 'demo-%'`));
  if (foreign.length > 0 && !allowExistingData)
    throw new Error(
      `Demo seed refused: the database already holds non-demo data (${foreign.length} workspace(s) outside the demo namespace). Pass --allow-existing-data to add the demo workspace beside it. Nothing was changed.`,
    );

  for (const demo of DEMO_ACCOUNTS) {
    const byEmail = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, demo.email));
    const byId = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, demo.id));
    if (byEmail.some((row) => row.id !== demo.id))
      conflict("user email", demo.email);
    if (byId.some((row) => row.email !== demo.email)) conflict("user", demo.id);
    if (byId[0]) {
      if (!credentialsLoaded)
        throw new Error(
          "Demo seed refused: demo accounts already exist. Supply the credentials file written by the first run.",
        );
      const [credential] = await db
        .select({ password: schema.accountTable.password })
        .from(schema.accountTable)
        .where(
          and(
            eq(schema.accountTable.userId, demo.id),
            eq(schema.accountTable.providerId, "credential"),
          ),
        );
      if (
        !credential?.password ||
        !(await bcrypt.compare(demo.password, credential.password))
      )
        throw new Error(
          "Demo seed refused: the credentials file does not match the existing demo accounts.",
        );
    }
    const [personByUser] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, demo.id));
    if (personByUser && personByUser.id !== demo.personId)
      conflict("person", demo.personId);
  }

  const organisations = await db
    .select()
    .from(schema.organisationTable)
    .where(
      sql`${schema.organisationTable.id} = ${CONTOSO.id} OR ${schema.organisationTable.key} = ${CONTOSO.key}`,
    );
  if (
    organisations.some(
      (row) => row.id !== CONTOSO.id || row.key !== CONTOSO.key,
    )
  )
    conflict("organisation", CONTOSO.key);

  const workspaces = await db
    .select()
    .from(schema.workspaceTable)
    .where(
      sql`${schema.workspaceTable.id} = ${DEMO_WORKSPACE_ID} OR ${schema.workspaceTable.slug} = ${DEMO_WORKSPACE_SLUG}`,
    );
  if (
    workspaces.some(
      (row) => row.id !== DEMO_WORKSPACE_ID || row.slug !== DEMO_WORKSPACE_SLUG,
    )
  )
    conflict("workspace", DEMO_WORKSPACE_SLUG);

  for (const project of Object.values(PROJECTS)) {
    const rows = await db
      .select()
      .from(schema.projectTable)
      .where(
        sql`${schema.projectTable.id} = ${project.id} OR ${schema.projectTable.slug} = ${project.slug}`,
      );
    if (
      rows.some(
        (row) =>
          row.id !== project.id ||
          row.slug !== project.slug ||
          row.workspaceId !== DEMO_WORKSPACE_ID,
      )
    )
      conflict("project", project.slug);
    const claims = await db
      .select()
      .from(schema.projectSlugClaimTable)
      .where(eq(schema.projectSlugClaimTable.slug, project.slug));
    if (claims.some((claim) => claim.projectId !== project.id))
      conflict("project slug claim", project.slug);
    const keyed = await db
      .select({ projectId: schema.workItemTable.projectId })
      .from(schema.workItemTable)
      .where(sql`${schema.workItemTable.key} LIKE ${`${project.slug}-%`}`);
    if (keyed.some((row) => row.projectId !== project.id))
      conflict("work item key", `${project.slug}-*`);
  }
}

type Seeded = {
  people: Map<string, string>;
  users: Map<string, string>;
  typeIds: Map<string, string>;
};

function itemId(ref: `${ProjectKey}-${number}`) {
  const [project, number] = ref.split("-") as [ProjectKey, string];
  return `demo-wi-${project.toLowerCase()}-${number}`;
}

async function seedCore(tx: Tx, now: Date): Promise<Seeded> {
  const date = (days: number) => new Date(now.getTime() + days * DAY);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const dayAt = (days: number, hour = 0) =>
    new Date(today + days * DAY + hour * HOUR);
  const isoDay = (days: number) => dayAt(days).toISOString().slice(0, 10);
  const internalOrg = await ensureInternalOrganisation(tx);

  await ensureById(
    tx,
    schema.organisationTable,
    {
      id: CONTOSO.id,
      key: CONTOSO.key,
      name: CONTOSO.name,
      isInternal: false,
      domain: [...CONTOSO.domain],
      active: true,
      portalAccess: true,
      defaultCustomerVisibility: "organisation",
      createdAt: now,
      updatedAt: now,
    },
    ["key", "isInternal"],
    "organisation",
  );

  // Accounts and people: written only when absent.
  const people = new Map<string, string>();
  const users = new Map<string, string>();
  for (const demo of DEMO_ACCOUNTS) {
    const [existingUser] = await tx
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, demo.id));
    const userId = existingUser
      ? existingUser.id
      : await upsertUserAndPassword(tx, demo, now, "demo");
    const organisationId =
      demo.side === "customer" ? CONTOSO.id : internalOrg.id;
    const [existingPerson] = await tx
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId));
    if (existingPerson) {
      if (
        existingPerson.id !== demo.personId ||
        existingPerson.side !== demo.side ||
        existingPerson.organisationId !== organisationId
      )
        conflict("person", demo.personId);
    } else {
      await upsertPerson(tx, {
        userId,
        preferredPersonId: demo.personId,
        organisationId,
        side: demo.side,
        displayName: demo.name,
        now,
      });
    }
    people.set(demo.key, demo.personId);
    users.set(demo.key, userId);
  }
  const person = (key: string) => {
    const id = people.get(key);
    if (!id) throw new Error(`Missing demo person ${key}`);
    return id;
  };
  const user = (key: string) => {
    const id = users.get(key);
    if (!id) throw new Error(`Missing demo user ${key}`);
    return id;
  };

  // Customers: organisation membership with the global customer role (read, never rewritten).
  const [customerRole] = await tx
    .select({ id: schema.roleTable.id })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "organisation"),
        isNull(schema.roleTable.workspaceId),
        eq(schema.roleTable.key, "customer"),
        eq(schema.roleTable.isSystem, true),
      ),
    )
    .limit(1);
  const customerRoleId =
    customerRole?.id ??
    (await ensureSystemRole(
      tx,
      { roleKey: "customer", workspaceId: null, now },
      "demo",
    ));
  for (const demo of DEMO_ACCOUNTS.filter((row) => row.side === "customer"))
    if (
      !(await membershipExists(tx, demo.personId, "organisation", CONTOSO.id))
    )
      await upsertScopedMembership(
        tx,
        {
          personId: demo.personId,
          scope: "organisation",
          scopeId: CONTOSO.id,
          roleId: customerRoleId,
          seesAll: false,
          now,
        },
        "demo",
      );

  // Workspace, mirroring create-workspace.ts for a workspace this seed owns.
  const workspaceCreated = await ensureById(
    tx,
    schema.workspaceTable,
    {
      id: DEMO_WORKSPACE_ID,
      organisationId: internalOrg.id,
      name: "Litware Managed IT",
      slug: DEMO_WORKSPACE_SLUG,
      description:
        "Managed IT services: the Contoso service desk, the Contoso Microsoft 365 migration and internal infrastructure.",
      createdAt: now,
    },
    ["slug", "organisationId"],
    "workspace",
  );
  if (workspaceCreated) {
    await seedWorkspaceBuiltInRoles(tx, DEMO_WORKSPACE_ID);
    await tx.insert(schema.workspaceRoleTable).values(
      DEFAULT_ROLE_NAMES.map((role) => ({
        workspaceId: DEMO_WORKSPACE_ID,
        role,
        permission: JSON.stringify(defaultRolePayloads[role]),
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await seedWorkspaceDefaults(DEMO_WORKSPACE_ID, tx);
    await seedDefaultCabWorkflowInTransaction(DEMO_WORKSPACE_ID, tx);
    await ensureProjectLeadRole(tx, DEMO_WORKSPACE_ID);
  }

  for (const demo of DEMO_ACCOUNTS) {
    if (!demo.workspaceRole) continue;
    const inserted = await ensureById(
      tx,
      schema.workspaceUserTable,
      {
        id: `demo-wm-${demo.key}`,
        workspaceId: DEMO_WORKSPACE_ID,
        userId: user(demo.key),
        role: demo.workspaceRole,
        joinedAt: now,
      },
      ["workspaceId", "userId", "role"],
      "workspace member",
    );
    if (
      inserted &&
      (demo.workspaceRole === "owner" || demo.workspaceRole === "admin")
    )
      await syncWorkspaceAdminReach(tx, DEMO_WORKSPACE_ID, user(demo.key));
  }

  for (const [id, name, isCab] of [
    ["demo-team-service-desk", "Service Desk", false],
    ["demo-team-cab", "Change Advisory Board", true],
  ] as const)
    await ensureById(
      tx,
      schema.teamTable,
      {
        id,
        workspaceId: DEMO_WORKSPACE_ID,
        name,
        isCab,
        createdAt: now,
        updatedAt: now,
      },
      ["workspaceId", "isCab"],
      "team",
    );
  for (const [teamId, key] of [
    ["demo-team-service-desk", "owner"],
    ["demo-team-service-desk", "agent1"],
    ["demo-team-service-desk", "agent2"],
    ["demo-team-service-desk", "agent3"],
    ["demo-team-cab", "lead"],
    ["demo-team-cab", "admin"],
  ] as const)
    await ensureById(
      tx,
      schema.teamMemberTable,
      {
        id: `${teamId}-${key}`,
        teamId,
        userId: user(key),
        createdAt: now,
      },
      ["teamId", "userId"],
      "team member",
    );

  for (const role of Object.values(PROJECT_ROLES))
    await ensureById(
      tx,
      schema.roleTable,
      {
        id: role.id,
        workspaceId: DEMO_WORKSPACE_ID,
        scope: "project",
        key: role.key,
        name: role.name,
        rank: 1,
        capabilities: role.capabilities,
        createdAt: now,
        updatedAt: now,
      },
      ["workspaceId", "scope", "key"],
      "role",
    );

  for (const flag of DEMO_FEATURE_FLAGS) {
    if (INSTANCE_ONLY_FEATURES.has(flag) || LOCKED_FEATURE_DEFAULTS.has(flag))
      continue;
    await tx
      .insert(schema.workspaceFeatureFlagTable)
      .values({
        workspaceId: DEMO_WORKSPACE_ID,
        featureKey: flag,
        enabled: true,
      })
      .onConflictDoNothing();
  }

  const types = await tx
    .select({
      id: schema.workItemTypeTable.id,
      key: schema.workItemTypeTable.key,
    })
    .from(schema.workItemTypeTable)
    .where(eq(schema.workItemTypeTable.workspaceId, DEMO_WORKSPACE_ID));
  const typeIds = new Map(types.map((row) => [row.key, row.id]));
  const typeId = (key: string) => {
    const id = typeIds.get(key);
    if (!id) throw new Error(`Missing demo work item type ${key}`);
    return id;
  };

  // Calendars and SLA policies.
  await ensureById(
    tx,
    schema.serviceCalendarTable,
    {
      id: CALENDARS.business,
      workspaceId: DEMO_WORKSPACE_ID,
      key: "demo-uk-business-hours",
      name: "UK business hours",
      timezone: "Europe/London",
      windows: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri"].map((day) => [
          day,
          [{ from: 540, to: 1050 }],
        ]),
      ),
      holidays: [
        { date: "2026-12-25", name: "Christmas Day" },
        { date: "2026-12-28", name: "Boxing Day (substitute day)" },
        { date: "2027-01-01", name: "New Year's Day" },
        { recurs: "annually", month: 12, day: 25, name: "Christmas Day" },
      ],
    },
    ["workspaceId", "key"],
    "service calendar",
  );
  await ensureById(
    tx,
    schema.serviceCalendarTable,
    {
      id: CALENDARS.always,
      workspaceId: DEMO_WORKSPACE_ID,
      key: "demo-24x7",
      name: "24x7 cover",
      timezone: "Europe/London",
      windows: Object.fromEntries(
        ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [
          day,
          [{ from: 0, to: 1440 }],
        ]),
      ),
      holidays: [],
    },
    ["workspaceId", "key"],
    "service calendar",
  );
  const versionOf = (key: SlaKey) => `${SLA_POLICIES[key].id}-v1`;
  for (const [key, policy] of Object.entries(SLA_POLICIES) as [
    SlaKey,
    (typeof SLA_POLICIES)[SlaKey],
  ][]) {
    const created = await ensureById(
      tx,
      schema.slaPolicyTable,
      {
        id: policy.id,
        workspaceId: DEMO_WORKSPACE_ID,
        key: policy.key,
        name: policy.name,
        description: policy.description,
      },
      ["workspaceId", "key"],
      "SLA policy",
    );
    await ensureById(
      tx,
      schema.slaPolicyVersionTable,
      {
        id: versionOf(key),
        workspaceId: DEMO_WORKSPACE_ID,
        policyId: policy.id,
        number: 1,
        calendarId: policy.calendarId,
        atRiskThresholdPct: 75,
        effectiveFrom: null,
      },
      ["workspaceId", "policyId", "number"],
      "SLA policy version",
    );
    if (!created) continue;
    // Like the policy publisher: complete the goals, then publish and activate.
    for (const type of SLA_TYPES)
      for (const metric of ["first_response", "resolution"] as const)
        for (const priority of ["low", "medium", "high", "urgent"] as const)
          await tx.insert(schema.slaGoalTable).values({
            id: `${policy.id}-goal-${type}-${metric}-${priority}`,
            workspaceId: DEMO_WORKSPACE_ID,
            versionId: versionOf(key),
            metric,
            workItemTypeId: typeId(type),
            priority,
            targetMinutes:
              policy.targets[priority][metric === "first_response" ? 0 : 1],
          });
    await tx
      .update(schema.slaPolicyVersionTable)
      .set({ effectiveFrom: date(-60) })
      .where(eq(schema.slaPolicyVersionTable.id, versionOf(key)));
    await tx
      .update(schema.slaPolicyTable)
      .set({ activeVersionId: versionOf(key) })
      .where(eq(schema.slaPolicyTable.id, policy.id));
  }

  // Projects, columns, states and memberships.
  for (const [key, project] of Object.entries(PROJECTS) as [
    ProjectKey,
    (typeof PROJECTS)[ProjectKey],
  ][]) {
    const created = await ensureById(
      tx,
      schema.projectTable,
      {
        id: project.id,
        workspaceId: DEMO_WORKSPACE_ID,
        organisationId: project.org ? CONTOSO.id : null,
        kind: project.kind,
        supportLevel: project.kind === "managed_service" ? "L2" : null,
        serviceCalendarMode:
          project.kind === "managed_service" ? "override" : "inherit",
        serviceCalendarId:
          project.kind === "managed_service" ? CALENDARS.business : null,
        slug: project.slug,
        name: project.name,
        description: project.description,
        icon: project.icon,
        position: Object.keys(PROJECTS).indexOf(key),
        lastTaskNumber: ITEMS[key].length,
        slaPolicyMode: project.sla ? "override" : "inherit",
        slaPolicyId: project.sla ? SLA_POLICIES[project.sla].id : null,
        managerId: person("lead"),
        startDate: key === "MIG" ? isoDay(-45) : null,
        endDate: key === "MIG" ? isoDay(50) : null,
        createdAt: date(-60),
      },
      ["workspaceId", "slug", "organisationId", "kind"],
      "project",
    );
    if (created) {
      await tx
        .insert(schema.projectSlugClaimTable)
        .values({ slug: project.slug, projectId: project.id, createdAt: now });
      await tx.insert(schema.columnTable).values(
        DEFAULT_PROJECT_COLUMNS.map((column) => ({
          projectId: project.id,
          ...column,
        })),
      );
      await seedProjectStates(project.id, DEMO_WORKSPACE_ID, tx);
    }
    for (const demo of DEMO_ACCOUNTS) {
      if (!demo.projectRole) continue;
      if (!(await membershipExists(tx, demo.personId, "project", project.id)))
        await upsertScopedMembership(
          tx,
          {
            personId: demo.personId,
            scope: "project",
            scopeId: project.id,
            roleId: PROJECT_ROLES[demo.projectRole].id,
            seesAll: false,
            now,
          },
          "demo",
        );
    }
  }

  await lockWorkspaceLabelNames(
    tx,
    DEMO_WORKSPACE_ID,
    LABELS.map((label) => label.name),
  );
  for (const label of LABELS)
    await ensureById(
      tx,
      schema.labelTable,
      {
        id: label.id,
        workspaceId: DEMO_WORKSPACE_ID,
        projectId: null,
        taskId: null,
        name: label.name,
        color: label.color,
        createdAt: now,
        updatedAt: now,
      },
      ["workspaceId", "projectId", "taskId"],
      "label",
    );

  // Service catalogue (work items reference services, so services come first).
  for (const service of SERVICES)
    await ensureById(
      tx,
      serviceTable,
      {
        id: service.id,
        workspaceId: DEMO_WORKSPACE_ID,
        name: service.name,
        description: service.description,
        category: service.category,
        ownerTeamId: "demo-team-service-desk",
        supportLevel: service.supportLevel,
        serviceCalendarId: service.calendar,
        status: service.status,
        statusNote: service.statusNote,
        statusChangedAt: service.statusNote ? date(-0.2) : null,
        statusChangedBy: service.statusNote ? user("lead") : null,
        createdBy: user("admin"),
        createdAt: date(-60),
        updatedAt: date(-60),
      },
      ["workspaceId", "name"],
      "service",
    );
  for (const [serviceId, dependsOnServiceId] of SERVICE_DEPENDENCIES)
    await tx
      .insert(serviceDependencyTable)
      .values({
        workspaceId: DEMO_WORKSPACE_ID,
        serviceId,
        dependsOnServiceId,
        createdAt: date(-60),
      })
      .onConflictDoNothing();

  // Cycles and modules (work items reference them).
  const mig = PROJECTS.MIG.id;
  for (const cycle of Object.values(CYCLES))
    await ensureById(
      tx,
      cycleTable,
      {
        id: cycle.id,
        workspaceId: DEMO_WORKSPACE_ID,
        projectId: mig,
        name: cycle.name,
        startDate: isoDay(cycle.startDay),
        endDate: isoDay(cycle.endDay),
        completedAt: cycle.done ? dayAt(cycle.endDay + 1, 10) : null,
        completedBy: cycle.done ? person("lead") : null,
        createdBy: person("lead"),
        createdAt: dayAt(cycle.startDay - 2, 9),
        updatedAt: dayAt(cycle.startDay - 2, 9),
      },
      ["workspaceId", "projectId", "name"],
      "cycle",
    );
  for (const module of Object.values(MODULES))
    await ensureById(
      tx,
      moduleTable,
      {
        id: module.id,
        workspaceId: DEMO_WORKSPACE_ID,
        projectId: mig,
        name: module.name,
        description: module.description,
        leadId: person("lead"),
        state: module.state,
        targetDate: isoDay(module.targetDay),
        createdBy: person("lead"),
        createdAt: date(-40),
        updatedAt: date(-40),
      },
      ["workspaceId", "projectId", "name"],
      "module",
    );

  // Work items.
  for (const [key, project] of Object.entries(PROJECTS) as [
    ProjectKey,
    (typeof PROJECTS)[ProjectKey],
  ][]) {
    const states = await tx
      .select({
        id: schema.stateTable.id,
        key: schema.stateTemplateTable.key,
      })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTable.stateTemplateId, schema.stateTemplateTable.id),
      )
      .where(eq(schema.stateTable.projectId, project.id));
    const state = (stateKey: StateKey) => {
      const row = states.find((candidate) => candidate.key === stateKey);
      if (!row) throw new Error(`Missing ${project.slug} state ${stateKey}`);
      return row.id;
    };
    for (const item of ITEMS[key]) {
      const ref = `${project.slug}-${item.n}` as `${ProjectKey}-${number}`;
      const id = itemId(ref);
      const created = new Date(now.getTime() - item.ageHours * HOUR);
      const finished = item.state === "done" || item.state === "cancelled";
      const started = item.state === "in-progress" || finished;
      const slaApplies =
        project.sla !== null &&
        (SLA_TYPES as readonly string[]).includes(item.type);
      const resolvedAt =
        item.state === "done"
          ? new Date(created.getTime() + (item.resolvedAfterHours ?? 24) * HOUR)
          : null;
      const inserted = await ensureById(
        tx,
        schema.workItemTable,
        {
          id,
          projectId: project.id,
          workspaceId: DEMO_WORKSPACE_ID,
          typeId: typeId(item.type),
          number: item.n,
          key: ref,
          title: item.title,
          description: markdownToDoc(item.description),
          stateId: state(item.state),
          priority: item.priority,
          assigneeId: item.assignee ? person(item.assignee) : null,
          requesterId: item.requester ? person(item.requester) : null,
          parentId: item.parent
            ? itemId(
                `${project.slug}-${item.parent}` as `${ProjectKey}-${number}`,
              )
            : null,
          serviceId: item.service ?? null,
          cycleId: item.cycle ? CYCLES[item.cycle].id : null,
          moduleId: item.module ? MODULES[item.module].id : null,
          startDate: started ? created : null,
          dueDate: dayAt(item.due, 17),
          position: String(item.n).padStart(4, "0"),
          customerVisibility: project.org ? "organisation" : "private",
          slaStartedAt: slaApplies ? created : null,
          slaPolicyVersionId:
            slaApplies && project.sla ? versionOf(project.sla) : null,
          firstResponseAt:
            item.respondedAfterMin !== undefined
              ? new Date(created.getTime() + item.respondedAfterMin * 60_000)
              : null,
          resolvedAt,
          createdAt: created,
          updatedAt: resolvedAt ?? created,
        },
        ["projectId", "workspaceId", "number", "key"],
        "work item",
      );
      if (!inserted) continue;
      await recordWorkItemActivity(tx, [
        {
          workspaceId: DEMO_WORKSPACE_ID,
          workItemId: id,
          actorId: person(item.requester ?? item.assignee ?? "lead"),
          actorType: "person",
          verb: "created",
          payload: { key: ref, title: item.title },
          createdAt: created,
        },
      ]);
      const links = (item.labels ?? []).map((name) => {
        const label = LABELS.find((candidate) => candidate.name === name);
        if (!label) throw new Error(`Unknown demo label ${name}`);
        return { workItemId: id, labelId: label.id };
      });
      if (links.length)
        await tx
          .insert(schema.workItemLabelTable)
          .values(links)
          .onConflictDoNothing();
      if (item.cycle) {
        const cycle = CYCLES[item.cycle];
        // Planned at the cycle start, or added mid-cycle when the item is newer than that.
        const cycleStart = dayAt(cycle.startDay, 9);
        const addedAt = new Date(
          Math.max(cycleStart.getTime(), created.getTime() + HOUR),
        );
        await ensureById(
          tx,
          cycleScopeEventTable,
          {
            id: `demo-cycle-scope-${id}`,
            workspaceId: DEMO_WORKSPACE_ID,
            cycleId: cycle.id,
            workItemId: id,
            kind: "added",
            at: addedAt,
            actorId: person("lead"),
            afterStart: addedAt.getTime() > cycleStart.getTime(),
          },
          ["cycleId", "workItemId", "kind"],
          "cycle scope event",
        );
      }
    }
  }

  await ensureById(
    tx,
    schema.workItemRelationTable,
    {
      id: "demo-relation-mig-4-blocks-mig-5",
      sourceId: itemId("MIG-4"),
      targetId: itemId("MIG-5"),
      type: "blocks",
    },
    ["sourceId", "targetId", "type"],
    "work item relation",
  );

  // Changes: windows, risk, rollback and affected services; freezes cover one of them.
  for (const freeze of FREEZES)
    await ensureById(
      tx,
      changeFreezeTable,
      {
        id: freeze.id,
        workspaceId: DEMO_WORKSPACE_ID,
        name: freeze.name,
        reason: freeze.reason,
        startsAt: dayAt(freeze.startDay),
        endsAt: dayAt(freeze.startDay + freeze.days),
        createdBy: user("lead"),
        createdAt: date(-10),
        updatedAt: date(-10),
      },
      ["workspaceId", "name"],
      "change freeze",
    );
  for (const change of CHANGES) {
    const workItemId = itemId(change.item);
    const [existing] = await tx
      .select({ workspaceId: changeDetailTable.workspaceId })
      .from(changeDetailTable)
      .where(eq(changeDetailTable.workItemId, workItemId));
    if (existing) {
      if (existing.workspaceId !== DEMO_WORKSPACE_ID)
        conflict("change detail", workItemId);
      continue;
    }
    const windowStart = dayAt(change.startDay, change.startHour);
    await tx.insert(changeDetailTable).values({
      workItemId,
      workspaceId: DEMO_WORKSPACE_ID,
      risk: change.risk,
      windowStart,
      windowEnd: new Date(windowStart.getTime() + change.hours * HOUR),
      rollbackPlan: change.rollback,
      approvedAt: change.approved ? date(-1) : null,
      updatedBy: user("lead"),
      createdAt: date(-5),
      updatedAt: date(-5),
    });
    await tx
      .insert(changeServiceTable)
      .values(
        change.services.map((serviceId) => ({
          workspaceId: DEMO_WORKSPACE_ID,
          workItemId,
          serviceId,
          createdAt: date(-5),
        })),
      )
      .onConflictDoNothing();
  }

  // Announcements customers read in the portal.
  for (const announcement of ANNOUNCEMENTS) {
    const startsAt = new Date(now.getTime() + announcement.startHours * HOUR);
    const created = await ensureById(
      tx,
      announcementTable,
      {
        id: announcement.id,
        workspaceId: DEMO_WORKSPACE_ID,
        title: announcement.title,
        body: announcement.body,
        severity: announcement.severity,
        audience: announcement.audience,
        startsAt,
        endsAt:
          announcement.endDays === null ? null : date(announcement.endDays),
        publishedAt: startsAt,
        createdBy: user("lead"),
        updatedBy: user("lead"),
        createdAt: startsAt,
        updatedAt: startsAt,
      },
      ["workspaceId", "title", "audience"],
      "announcement",
    );
    if (!created) continue;
    if (announcement.audience === "organisations")
      await tx.insert(announcementOrganisationTable).values({
        workspaceId: DEMO_WORKSPACE_ID,
        announcementId: announcement.id,
        organisationId: CONTOSO.id,
      });
    else
      await tx.insert(announcementProjectTable).values({
        workspaceId: DEMO_WORKSPACE_ID,
        announcementId: announcement.id,
        projectId: PROJECTS.CSD.id,
      });
  }

  for (const comment of COMMENTS) {
    const at = new Date(now.getTime() - comment.hoursAgo * HOUR);
    await ensureById(
      tx,
      schema.commentTable,
      {
        id: comment.id,
        workspaceId: DEMO_WORKSPACE_ID,
        workItemId: itemId(comment.item),
        authorId: person(comment.author),
        actorType: "person",
        visibility: comment.visibility,
        body: markdownToDoc(comment.text),
        createdAt: at,
        updatedAt: at,
      },
      ["workspaceId", "workItemId", "authorId"],
      "comment",
    );
  }

  for (const view of SAVED_VIEWS)
    await ensureById(
      tx,
      schema.savedViewTable,
      {
        id: view.id,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: person(view.owner),
        name: view.name,
        scope: view.scope === "workspace" ? "workspace" : "project",
        scopeId:
          view.scope === "workspace"
            ? DEMO_WORKSPACE_ID
            : PROJECTS[view.scope].id,
        visibility: "workspace",
        query: view.query,
        layout: view.layout,
        createdAt: date(-14),
        updatedAt: date(-14),
      },
      ["workspaceId", "scope", "scopeId"],
      "saved view",
    );

  return { people, users, typeIds };
}

/** Request types, submissions and their acceptance, through the real intake repository. */
async function seedIntake(seeded: Seeded) {
  const person = (key: string) => seeded.people.get(key) ?? "";
  const user = (key: string) => seeded.users.get(key) ?? "";
  for (const [position, def] of REQUEST_TYPES.entries()) {
    const [existing] = await db
      .select({
        id: schema.requestTypeTable.id,
        published: schema.requestTypeTable.published,
      })
      .from(schema.requestTypeTable)
      .where(
        and(
          eq(schema.requestTypeTable.workspaceId, DEMO_WORKSPACE_ID),
          eq(schema.requestTypeTable.name, def.name),
        ),
      )
      .limit(1);
    const typeId = seeded.typeIds.get(def.type);
    if (!typeId) throw new Error(`Missing demo work item type ${def.type}`);
    const id =
      existing?.id ??
      (
        await createRequestType(
          {
            workspaceId: DEMO_WORKSPACE_ID,
            name: def.name,
            description: def.description,
            group: def.group,
            workItemTypeId: typeId,
            defaultProjectId: PROJECTS.CSD.id,
            formSchema: { fields: def.fields.map((field) => ({ ...field })) },
            autoAccept: false,
            customerVisible: true,
            forcePrivate: false,
            position,
          },
          person("admin"),
        )
      ).id;
    await db
      .insert(schema.organisationRequestTypeTable)
      .values({ organisationId: CONTOSO.id, requestTypeId: id })
      .onConflictDoNothing();
    if (!existing?.published) await publishRequestType(id, person("admin"));
  }

  let accepted = 0;
  for (const spec of SUBMISSIONS) {
    const [existing] = await db
      .select({
        number: schema.submissionTable.number,
        state: schema.submissionTable.state,
      })
      .from(schema.submissionTable)
      .where(
        and(
          eq(schema.submissionTable.requesterId, person(spec.requester)),
          sql`${schema.submissionTable.formData}->>'summary' = ${spec.summary}`,
        ),
      )
      .limit(1);
    let submission = existing;
    if (!submission) {
      const [requestType] = await db
        .select({ key: schema.requestTypeTable.key })
        .from(schema.requestTypeTable)
        .where(
          and(
            eq(schema.requestTypeTable.workspaceId, DEMO_WORKSPACE_ID),
            eq(schema.requestTypeTable.name, spec.requestType),
          ),
        );
      if (!requestType) throw new Error("Demo request type is missing.");
      const created = await createSubmission({
        userId: user(spec.requester),
        key: requestType.key,
        formData: {
          summary: spec.summary,
          details: spec.details,
          ...(spec.impact ? { impact: spec.impact } : {}),
        },
        customerVisibility: spec.visibility,
      });
      submission = { number: created.number, state: created.state };
    }
    if (!spec.acceptedBy || submission.state !== "new") continue;
    const requestType = REQUEST_TYPES.find(
      (row) => row.name === spec.requestType,
    );
    const typeId = requestType && seeded.typeIds.get(requestType.type);
    if (!typeId) throw new Error("Demo accept type is missing.");
    await acceptSubmission(
      formatSubmissionReference(submission.number),
      DEMO_WORKSPACE_ID,
      person(spec.acceptedBy),
      PROJECTS.CSD.id,
      typeId,
      async () => true,
    );
    accepted++;
  }
  return accepted;
}

async function seedKnowledgeBase(seeded: Seeded) {
  const actor = {
    userId: seeded.users.get("admin") ?? "",
    personId: seeded.people.get("admin") ?? "",
    actorType: "person" as const,
    apiKeyId: null,
  };
  const categories = new Map<string, string>();
  for (const [position, name] of KB_CATEGORIES.entries()) {
    const [existing] = await db
      .select({ id: kbCategoryTable.id })
      .from(kbCategoryTable)
      .where(
        and(
          eq(kbCategoryTable.workspaceId, DEMO_WORKSPACE_ID),
          eq(kbCategoryTable.name, name),
        ),
      )
      .limit(1);
    const id =
      existing?.id ??
      (
        await createCategory({
          workspaceId: DEMO_WORKSPACE_ID,
          name,
          position,
          actor,
        })
      ).id;
    categories.set(name, id);
  }
  for (const article of KB_ARTICLES) {
    const [existing] = await db
      .select({ id: kbArticleTable.id })
      .from(kbArticleTable)
      .where(
        and(
          eq(kbArticleTable.workspaceId, DEMO_WORKSPACE_ID),
          eq(kbArticleTable.title, article.title),
        ),
      )
      .limit(1);
    if (existing) continue;
    const created = await createArticle({
      workspaceId: DEMO_WORKSPACE_ID,
      title: article.title,
      body: markdownToDoc(article.markdown),
      categoryId: categories.get(article.category) ?? null,
      customerVisible: article.customerVisible,
      actor,
      projectReaches: async () => true,
    });
    let version = created.version;
    if (await reviewStepEnabled(DEMO_WORKSPACE_ID)) {
      const submitted = await transitionArticle({
        id: created.id,
        workspaceId: DEMO_WORKSPACE_ID,
        reachableProjectIds: [],
        version,
        action: "submit",
        actor,
      });
      version = submitted?.version ?? version;
    }
    await transitionArticle({
      id: created.id,
      workspaceId: DEMO_WORKSPACE_ID,
      reachableProjectIds: [],
      version,
      action: "publish",
      actor,
    });
  }
}

async function seedPages(seeded: Seeded) {
  const actor = {
    userId: seeded.users.get("lead") ?? "",
    personId: seeded.people.get("lead") ?? "",
    actorType: "person" as const,
    apiKeyId: null,
  };
  for (const page of PAGES) {
    const projectId = PROJECTS[page.project].id;
    const [existing] = await db
      .select({ id: projectPageTable.id })
      .from(projectPageTable)
      .where(
        and(
          eq(projectPageTable.projectId, projectId),
          eq(projectPageTable.title, page.title),
        ),
      )
      .limit(1);
    if (existing) continue;
    await createPage(
      { workspaceId: DEMO_WORKSPACE_ID, projectId },
      { title: page.title, body: markdownToDoc(page.markdown) },
      actor,
    );
  }
}

/**
 * The reviewer's inbox (DEMO_REVIEWER_KEY), written by the product's own services so every row
 * is one the inbox can render and re-check: an assignment, a mention, an SLA warning and a CAB
 * approval request. Each step runs only while its own result is absent, so a rerun writes
 * nothing, and none is acted by the reviewer (fan-out never notifies the actor).
 */
async function seedReviewerInbox(seeded: Seeded) {
  const person = (key: string) => {
    const id = seeded.people.get(key);
    if (!id) throw new Error(`Missing demo person ${key}`);
    return id;
  };
  const user = (key: string) => {
    const id = seeded.users.get(key);
    if (!id) throw new Error(`Missing demo user ${key}`);
    return id;
  };
  const reviewer = person(DEMO_REVIEWER_KEY);
  const workItem = async (ref: `${ProjectKey}-${number}`) => {
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, itemId(ref)));
    if (!row) throw new Error(`Missing demo work item ${ref}`);
    return row;
  };

  // Assignment: the lead assigns the unassigned printer incident (AS-16).
  const printer = await workItem("CSD-5");
  if (printer.assigneeId === null)
    await assignWorkItem(
      printer.key,
      DEMO_WORKSPACE_ID,
      user("lead"),
      "person",
      person("lead"),
      { assigneeId: reviewer, expectedCurrentAssigneeId: null },
    );

  // Mention: the lead asks the reviewer about the finance upgrade inside the freeze.
  const upgrade = await workItem("CSD-14");
  const fixtureComments = COMMENTS.map((comment) => comment.id);
  const [mentioned] = await db
    .select({ id: schema.commentTable.id })
    .from(schema.commentTable)
    .where(
      and(
        eq(schema.commentTable.workItemId, upgrade.id),
        eq(schema.commentTable.authorId, person("lead")),
        not(inArray(schema.commentTable.id, fixtureComments)),
      ),
    )
    .limit(1);
  if (!mentioned)
    await createComment(upgrade.id, DEMO_WORKSPACE_ID, user("lead"), "person", {
      visibility: "internal",
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "taskdeskMention",
                attrs: {
                  id: reviewer,
                  label: DEMO_ACCOUNTS.find(
                    (row) => row.key === DEMO_REVIEWER_KEY,
                  )?.name,
                },
              },
              {
                type: "text",
                text: " Contoso finance agreed to the Tuesday after the freeze. Can you confirm the new window before I tell them?",
              },
            ],
          },
        ],
      },
    });

  // SLA warning: one scan of the reviewer's 24x7 backup incident (about 82% of its resolution
  // target used), exactly as the scheduler's scan writes it. A business-hours item would
  // depend on the time of day the seed runs.
  const backup = await workItem("INF-1");
  const [scanned] = await db
    .select({ metric: schema.workItemSlaCacheTable.metric })
    .from(schema.workItemSlaCacheTable)
    .where(eq(schema.workItemSlaCacheTable.workItemId, backup.id))
    .limit(1);
  if (!scanned) await scanWorkItemSla(backup.id);

  // Approval request: the agent asks the reviewer, a CAB member, to approve the conditional
  // access change. A customer-visible item: the inbox reads an approval row on a private item
  // only for its requester and participants.
  const change = await workItem("CSD-15");
  const [requested] = await db
    .select({ id: schema.approvalTable.id })
    .from(schema.approvalTable)
    .where(eq(schema.approvalTable.workItemId, change.id))
    .limit(1);
  if (!requested) {
    const [type] = await db
      .select({
        workflowId: schema.workItemTypeTable.workflowId,
        stateTemplateId: schema.stateTable.stateTemplateId,
      })
      .from(schema.workItemTypeTable)
      .innerJoin(schema.stateTable, eq(schema.stateTable.id, change.stateId))
      .where(eq(schema.workItemTypeTable.id, change.typeId));
    const [workflow] = type?.workflowId
      ? await db
          .select({ versionId: schema.workflowTable.activeVersionId })
          .from(schema.workflowTable)
          .where(eq(schema.workflowTable.id, type.workflowId))
      : [];
    const gates = workflow?.versionId
      ? await db
          .select({
            id: schema.workflowTransitionTable.id,
            from: schema.workflowTransitionTable.fromStateTemplateId,
          })
          .from(schema.workflowTransitionTable)
          .where(
            and(
              eq(schema.workflowTransitionTable.versionId, workflow.versionId),
              eq(schema.workflowTransitionTable.requiresCab, true),
            ),
          )
      : [];
    const gate =
      gates.find((row) => row.from === type?.stateTemplateId) ??
      gates.find((row) => row.from === null);
    if (!gate) throw new Error("Demo change workflow has no CAB transition.");
    const identity = await resolveIdentity({
      userId: user("agent1"),
      credential: "session",
    });
    if (!identity) throw new Error("Demo agent identity is missing.");
    await createApproval({
      targetKey: change.key,
      identity,
      actorType: "person",
      transitionId: gate.id,
      kind: "cab",
      approverId: reviewer,
    });
  }
}

const CUSTOMER_PASSWORD_STEP =
  "God Mode > Authentication > Customers > Password (asks you to confirm your identity)";

/**
 * Customer password sign-in is an instance setting that is off by default, so demo customers
 * cannot sign in on a fresh instance. Without `--enable-customer-password` this only reports.
 * With it, and only while NO password row covers the customer portal, it writes the same
 * canonical row God Mode writes (`instance/auth-local-methods.ts`) under the same lock, with a
 * system audit entry; running servers pick it up through the 10-second auth poller. A row that
 * exists, on or off, is an administrator's decision and is never changed.
 */
async function customerPasswordSignIn(enable: boolean): Promise<string | null> {
  const covering = (
    rows: Awaited<ReturnType<typeof getStoredAuthPluginConfigRows>>,
  ) =>
    rows.filter(
      (row) =>
        row.pluginId === "auth.password" &&
        (row.portalScope === "both" || row.portalScope === "customer"),
    );
  const stored = covering(await getStoredAuthPluginConfigRows());
  // The runtime's rule (`resolveStoredLocalAuthProviders`): any enabled instance row covering
  // the customer portal turns it on.
  if (stored.some((row) => row.enabled && row.scope === "instance"))
    return enable ? "Customer password sign-in is already on." : null;
  if (stored.length > 0)
    return `Customer password sign-in was turned off by an administrator; the seed leaves it off. Demo customers can sign in once it is turned on in ${CUSTOMER_PASSWORD_STEP}.`;
  if (!enable)
    return `Customer password sign-in is off on this instance, so the demo customers cannot sign in to the portal yet. Turn it on in ${CUSTOMER_PASSWORD_STEP}, or rerun this seed with --enable-customer-password.`;

  const written = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('taskdesk:auth-local-methods'), 0)`,
    );
    const [existing] = await tx
      .select({ id: schema.instancePluginConfigTable.id })
      .from(schema.instancePluginConfigTable)
      .where(
        and(
          eq(schema.instancePluginConfigTable.pluginId, "auth.password"),
          sql`${schema.instancePluginConfigTable.portalScope} IN ('both', 'customer')`,
        ),
      )
      .limit(1);
    if (existing) return false;
    await tx.insert(schema.instancePluginConfigTable).values({
      id: "demo-auth-password-customer",
      pluginId: "auth.password",
      instanceKey: "customer",
      displayName: "Password (customer)",
      enabled: true,
      config: {},
      scope: "instance",
      workspaceId: null,
      portalScope: "customer",
      configVersion: 1,
      updatedBy: null,
    });
    await appendAuditLog(tx, {
      action: "plugin.changed",
      actorId: null,
      actorType: "system",
      workspaceId: null,
      entityType: "instance_plugin_config",
      entityId: "auth.local-methods",
      after: {
        pluginIds: ["auth.password"],
        changedKeys: ["customer.password"],
        retiredRows: 0,
        origin: "demo-seed",
      },
    });
    return true;
  });
  return written
    ? "Customer password sign-in turned on for the customer portal (one instance setting, audited). A running server picks it up within about 10 seconds."
    : "Customer password sign-in was changed by someone else while the seed ran; the seed left it as it is.";
}

/** Flags an instance administrator has locked off: workspace rows cannot turn them on. */
async function lockedOffFlags() {
  const rows = await db
    .select({
      key: schema.instanceFeatureFlagTable.featureKey,
      enabled: schema.instanceFeatureFlagTable.enabled,
      locked: schema.instanceFeatureFlagTable.locked,
    })
    .from(schema.instanceFeatureFlagTable);
  return rows
    .filter(
      (row) =>
        row.locked &&
        !row.enabled &&
        (DEMO_FEATURE_FLAGS as readonly string[]).includes(row.key),
    )
    .map((row) => row.key);
}

export async function runDemoSeed(argv: readonly string[] = process.argv) {
  const { credentialsFile, allowExistingData, enableCustomerPassword } =
    parseDemoArgs(argv);
  config();
  let databaseConfig: ReturnType<typeof resolveDatabaseConfig>;
  try {
    databaseConfig = resolveDatabaseConfig();
  } catch (error) {
    // Node's ERR_INVALID_URL carries the whole URL, password included, in `input`: never let
    // the CLI's error printer show it (as in seed-cli.ts).
    if (
      error instanceof TypeError &&
      "code" in error &&
      error.code === "ERR_INVALID_URL"
    )
      throw new Error("Demo seed database URL configuration is invalid.");
    throw error;
  }
  if (databaseConfig.source === "LOCAL_FALLBACK")
    throw new Error(
      "Demo seed requires an explicitly configured database (TASKDESK_DATABASE_URL or POSTGRES_*). No database connection was attempted.",
    );
  assertNotLiveDatabase(databaseConfig.database);
  const destination = resolveCredentialsDestination(credentialsFile);
  const credentialsLoaded = loadExistingCredentials(destination);
  const now = new Date();
  try {
    await precheck(credentialsLoaded, allowExistingData);
    if (!credentialsLoaded)
      writeFileSync(
        destination,
        `${JSON.stringify(
          {
            accounts: DEMO_ACCOUNTS.map(
              ({ email, password, roleLabel, name, side }) => ({
                email,
                password,
                role: roleLabel,
                name,
                side,
              }),
            ),
          },
          null,
          2,
        )}\n`,
        { mode: 0o600, flag: "wx" },
      );
    const seeded = await db.transaction((tx) => seedCore(tx, now));
    const accepted = await seedIntake(seeded);
    await seedKnowledgeBase(seeded);
    await seedPages(seeded);
    await seedReviewerInbox(seeded);
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.workspaceId, DEMO_WORKSPACE_ID));
    console.log(
      `Demo seed complete: workspace ${DEMO_WORKSPACE_ID} (Litware Managed IT), ${DEMO_ACCOUNTS.length} accounts, ${count} work items (${accepted} accepted this run). Sign-in details are in the private file you supplied.`,
    );
    const customerSignIn = await customerPasswordSignIn(enableCustomerPassword);
    if (customerSignIn) console.log(customerSignIn);
    const locked = await lockedOffFlags();
    if (locked.length)
      console.warn(
        `Warning: an instance administrator has locked these features off, so the demo workspace cannot show them: ${locked.join(", ")}.`,
      );
  } finally {
    await getDatabasePool().end();
  }
}
