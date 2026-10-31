import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSubmissionReference } from "@taskdesk/domain";
import {
  BUILT_IN_ROLES,
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
  type FeatureFlag,
  INSTANCE_ONLY_FEATURES,
  LOCKED_FEATURE_DEFAULTS,
} from "@taskdesk/permissions";
import bcrypt from "bcryptjs";
import { config } from "dotenv-mono";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import db, { getDatabasePool, schema } from "../src/database";
import { resolveDatabaseConfig } from "../src/database/resolve-database-url";
import { kbArticleTable, kbCategoryTable } from "../src/database/schema-p5-kb";
import { projectPageTable } from "../src/database/schema-p5-pages";
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
import { DEFAULT_PROJECT_COLUMNS } from "../src/project/controllers/create-project";
import { ensureProjectLeadRole } from "../src/project/project-creator-grant";
import { seedDefaultCabWorkflowInTransaction } from "../src/service-management/cab-template";
import { ensureInternalOrganisation } from "../src/utils/seed-internal-organisation";
import { seedProjectStates } from "../src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../src/utils/seed-workspace-defaults";
import { recordWorkItemActivity } from "../src/work-item/activity";
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

/**
 * UAT seed: one additional workspace, `uat-ws` ("Northwind Service Desk (UAT)"), with realistic
 * accounts for every role, three projects, ~45 work items, SLA, approvals, request types,
 * knowledge-base articles and Pages. It runs on a database that may already hold the SIT seed
 * (`seed-sit-users.ts`) and is STRICTLY ADDITIVE:
 *
 * - every row it writes directly has a `uat-` id; rows written by domain helpers (state
 *   templates, types, teams' defaults, request types, submissions, KB, Pages) carry generated
 *   ids but live only inside `uat-ws` or its projects;
 * - it never updates or deletes a row it did not create, and on a rerun it updates nothing;
 * - a `uat-` row (or a reserved email, slug or key) that exists but does not match what this
 *   seed would write is a conflict: the seed throws before writing anything.
 */

export const UAT_WORKSPACE_ID = "uat-ws";
export const UAT_LIVE_DATABASE_NAME = "taskdesk_browser_journey_1022_test";
const STAFF_DOMAIN = "uat.taskdesk.test";

type UatSide = "staff" | "customer";
type UatOrg = "internal" | "contoso" | "fabrikam";
type UatWorkspaceRole = "owner" | "admin" | "lead" | "member" | "viewer";
type UatProjectRole = "cab" | "agent" | "viewer";

export type UatAccount = SeedAccount & {
  key: string;
  personId: string;
  side: UatSide;
  org: UatOrg;
  /** What this account is for, written to the credentials file. */
  roleLabel: string;
  workspaceRole: UatWorkspaceRole | null;
  projectRole: UatProjectRole | null;
};

function account(
  input: Omit<UatAccount, "id" | "personId" | "password">,
): UatAccount {
  return {
    ...input,
    id: `uat-user-${input.key}`,
    personId: `uat-person-${input.key}`,
    password: randomBytes(24).toString("base64url"),
  };
}

export const UAT_ACCOUNTS: readonly UatAccount[] = [
  account({
    key: "owner",
    email: `owner@${STAFF_DOMAIN}`,
    name: "Olivia Owens",
    roleLabel: "Workspace owner",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "owner",
    projectRole: null,
  }),
  account({
    key: "admin",
    email: `admin@${STAFF_DOMAIN}`,
    name: "Arjun Patel",
    roleLabel: "Workspace admin",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "admin",
    projectRole: null,
  }),
  account({
    key: "lead",
    email: `lead@${STAFF_DOMAIN}`,
    name: "Laura Chen",
    roleLabel: "Project lead and change approver",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "lead",
    projectRole: "cab",
  }),
  account({
    key: "agent1",
    email: `agent1@${STAFF_DOMAIN}`,
    name: "Marcus Reid",
    roleLabel: "Service desk agent (member)",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "member",
    projectRole: "agent",
  }),
  account({
    key: "agent2",
    email: `agent2@${STAFF_DOMAIN}`,
    name: "Sofia Alvarez",
    roleLabel: "Service desk agent (member)",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "member",
    projectRole: "agent",
  }),
  account({
    key: "viewer",
    email: `viewer@${STAFF_DOMAIN}`,
    name: "Victor Nguyen",
    roleLabel: "Read-only viewer",
    userRole: "user",
    side: "staff",
    org: "internal",
    workspaceRole: "viewer",
    projectRole: "viewer",
  }),
  account({
    key: "contoso1",
    email: `emma.clarke@contoso.${STAFF_DOMAIN}`,
    name: "Emma Clarke",
    roleLabel: "Customer, Contoso Ltd",
    userRole: "user",
    side: "customer",
    org: "contoso",
    workspaceRole: null,
    projectRole: null,
  }),
  account({
    key: "contoso2",
    email: `james.wright@contoso.${STAFF_DOMAIN}`,
    name: "James Wright",
    roleLabel: "Customer, Contoso Ltd",
    userRole: "user",
    side: "customer",
    org: "contoso",
    workspaceRole: null,
    projectRole: null,
  }),
  account({
    key: "fabrikam1",
    email: `nina.berg@fabrikam.${STAFF_DOMAIN}`,
    name: "Nina Berg",
    roleLabel: "Customer, Fabrikam Inc",
    userRole: "user",
    side: "customer",
    org: "fabrikam",
    workspaceRole: null,
    projectRole: null,
  }),
  account({
    key: "godmode",
    email: `godmode@${STAFF_DOMAIN}`,
    name: "Grace Morgan",
    roleLabel: "Instance admin (God Mode)",
    userRole: "admin",
    side: "staff",
    org: "internal",
    workspaceRole: null,
    projectRole: null,
  }),
];

const CUSTOMER_ORGS = {
  contoso: {
    id: "uat-org-contoso",
    key: "uat-contoso",
    name: "Contoso Ltd",
    domain: [`contoso.${STAFF_DOMAIN}`],
  },
  fabrikam: {
    id: "uat-org-fabrikam",
    key: "uat-fabrikam",
    name: "Fabrikam Inc",
    domain: [`fabrikam.${STAFF_DOMAIN}`],
  },
} as const;

type ProjectKey = "SUP" | "OPS" | "WEB";

const PROJECTS: Record<
  ProjectKey,
  {
    id: string;
    slug: string;
    name: string;
    description: string;
    icon: string;
    org: "contoso" | "fabrikam" | null;
    sla: boolean;
  }
> = {
  SUP: {
    id: "uat-proj-support",
    slug: "SUP",
    name: "Customer Support",
    description:
      "Service desk for Contoso Ltd: incidents, access and service requests from the customer portal.",
    icon: "Headset",
    org: "contoso",
    sla: true,
  },
  OPS: {
    id: "uat-proj-itops",
    slug: "OPS",
    name: "IT Operations",
    description:
      "Internal infrastructure, maintenance and onboarding work. Not visible to customers.",
    icon: "Server",
    org: null,
    sla: false,
  },
  WEB: {
    id: "uat-proj-web",
    slug: "WEB",
    name: "Website Relaunch",
    description:
      "Fabrikam Inc website relaunch: epics, stories and sub-tasks, plus bugs Fabrikam reports through the portal.",
    icon: "Globe",
    org: "fabrikam",
    sla: true,
  },
};

/** Every workspace-level flag a UAT tester needs. Instance-only and locked flags are left alone. */
export const UAT_FEATURE_FLAGS = [
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
  "feature.dev_links",
] as const satisfies readonly FeatureFlag[];

const PROJECT_ROLES: Record<
  UatProjectRole,
  { id: string; key: string; name: string; capabilities: string[] }
> = {
  cab: {
    id: "uat-role-project-cab",
    key: "uat-project-cab",
    name: "Project lead and change approver",
    capabilities: [...BUILT_IN_ROLES.lead.capabilities, "approval:decide_cab"],
  },
  agent: {
    id: "uat-role-project-agent",
    key: "uat-project-agent",
    name: "Service desk agent",
    capabilities: [
      ...BUILT_IN_ROLES.member.capabilities,
      "approval:request_cab",
    ],
  },
  viewer: {
    id: "uat-role-project-viewer",
    key: "uat-project-viewer",
    name: "Read-only project viewer",
    capabilities: [...BUILT_IN_ROLES.viewer.capabilities],
  },
};

type StateKey = "backlog" | "to-do" | "in-progress" | "done" | "cancelled";
type Priority = "low" | "medium" | "high" | "urgent";

type ItemSpec = {
  n: number;
  title: string;
  type: string;
  priority: Priority;
  state: StateKey;
  assignee: string | null;
  requester?: string;
  /** Days from now; negative for overdue or finished work. */
  due: number;
  parent?: number;
  visibility?: "private" | "organisation";
  labels?: string[];
  description: string;
};

const SUP_ITEMS: ItemSpec[] = [
  {
    n: 1,
    title: "Outlook keeps asking for a password after the Windows update",
    type: "incident",
    priority: "high",
    state: "in-progress",
    assignee: "agent1",
    requester: "contoso1",
    due: 1,
    labels: ["Email"],
    description:
      "Since Tuesday's update Outlook prompts for the password every few minutes. Affects the whole finance team.",
  },
  {
    n: 2,
    title: "Laptops for three new starters in the finance team",
    type: "service-request",
    priority: "medium",
    state: "to-do",
    assignee: "agent2",
    requester: "contoso2",
    due: 6,
    labels: ["Hardware"],
    description:
      "Three new starters join on the 1st. They need standard finance laptops with the accounting software installed.",
  },
  {
    n: 3,
    title: "VPN disconnects every 30 minutes when working from home",
    type: "incident",
    priority: "urgent",
    state: "in-progress",
    assignee: "agent1",
    requester: "contoso1",
    due: -1,
    labels: ["Network"],
    description:
      "The VPN drops roughly every half hour and has to be reconnected. Started this week, several users affected.",
  },
  {
    n: 4,
    title: "Access to the accounts shared mailbox",
    type: "service-request",
    priority: "low",
    state: "done",
    assignee: "agent2",
    requester: "contoso2",
    due: -3,
    labels: ["Access"],
    description:
      "Please give James Wright send-as access to the accounts shared mailbox.",
  },
  {
    n: 5,
    title: "Second floor printer shows as offline",
    type: "incident",
    priority: "medium",
    state: "backlog",
    assignee: null,
    requester: "contoso1",
    due: 10,
    labels: ["Hardware"],
    description:
      "The printer near the kitchen on the second floor shows as offline for everyone.",
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
    due: -5,
    labels: ["Security"],
    description:
      "Reception received an email pretending to be from the bank. Nobody clicked the link. Please check and block the sender.",
  },
  {
    n: 8,
    title: "Teams calls lose audio after about ten minutes",
    type: "problem",
    priority: "high",
    state: "in-progress",
    assignee: "agent2",
    requester: "contoso2",
    due: 3,
    labels: ["Network"],
    description:
      "Several people report that call audio stops after around ten minutes. Rejoining fixes it for a while.",
  },
  {
    n: 9,
    title: "Collect call quality logs from three affected users",
    type: "service-request",
    priority: "medium",
    state: "to-do",
    assignee: "agent2",
    requester: "contoso2",
    due: 2,
    parent: 8,
    description:
      "Gather Teams call quality logs from three people who saw the problem, to send to the network team.",
  },
  {
    n: 10,
    title: "Reset multi-factor sign-in for a travelling sales manager",
    type: "service-request",
    priority: "high",
    state: "done",
    assignee: "agent1",
    requester: "contoso2",
    due: -2,
    visibility: "private",
    labels: ["Access", "Security"],
    description:
      "Lost phone while travelling. Identity confirmed by phone call with the line manager.",
  },
  {
    n: 11,
    title: "November patching window for Contoso servers",
    type: "uat-change",
    priority: "high",
    state: "to-do",
    assignee: "lead",
    requester: "contoso1",
    due: 5,
    description:
      "Apply November security updates to the three Contoso file and print servers on Saturday morning. Needs change approval.",
  },
  {
    n: 12,
    title: "Install accounting software update on finance PCs",
    type: "service-request",
    priority: "low",
    state: "cancelled",
    assignee: "agent1",
    requester: "contoso2",
    due: -4,
    description:
      "Cancelled: duplicate of the new starter request, the update is included in the new laptop build.",
  },
  {
    n: 13,
    title: "File server is slow first thing in the morning",
    type: "problem",
    priority: "medium",
    state: "backlog",
    assignee: "agent2",
    requester: "contoso1",
    due: 20,
    description:
      "Opening files on the S: drive takes 20 to 30 seconds between 8:30 and 9:30.",
  },
  {
    n: 14,
    title: "Guest Wi-Fi for the client workshop on Thursday",
    type: "service-request",
    priority: "medium",
    state: "to-do",
    assignee: "agent1",
    requester: "contoso1",
    due: 8,
    labels: ["Network"],
    description:
      "Twelve visitors need guest Wi-Fi access for the day. Please send the voucher codes to Emma.",
  },
];

const OPS_ITEMS: ItemSpec[] = [
  {
    n: 1,
    title: "Renew the wildcard TLS certificate before it expires",
    type: "task",
    priority: "urgent",
    state: "in-progress",
    assignee: "agent1",
    due: 4,
    labels: ["Security"],
    description:
      "The wildcard certificate expires in nine days. Renew it, deploy to the load balancers and update the monitoring check.",
  },
  {
    n: 2,
    title: "Move nightly backups to the new storage account",
    type: "task",
    priority: "high",
    state: "to-do",
    assignee: "agent2",
    due: 14,
    description:
      "Point the backup jobs at the new storage account and run one full restore test.",
  },
  {
    n: 3,
    title: "Quarterly review of administrator accounts",
    type: "task",
    priority: "medium",
    state: "to-do",
    assignee: "lead",
    due: 21,
    labels: ["Security", "Access"],
    description:
      "Export all accounts with admin rights, confirm each with its owner and remove any that are no longer needed.",
  },
  {
    n: 4,
    title: "Replace the failing disk in hypervisor HV-02",
    type: "incident",
    priority: "urgent",
    state: "done",
    assignee: "agent1",
    due: -6,
    labels: ["Hardware"],
    description:
      "Disk 3 reported predictive failure. Replaced under warranty and the array has rebuilt.",
  },
  {
    n: 5,
    title: "November server updates for the internal estate",
    type: "change",
    priority: "high",
    state: "backlog",
    assignee: "agent2",
    due: 11,
    description:
      "Monthly operating system updates for internal servers. Schedule after the customer patching window.",
  },
  {
    n: 6,
    title: "Document the Wi-Fi controller configuration",
    type: "task",
    priority: "low",
    state: "backlog",
    assignee: null,
    due: 25,
    labels: ["Network"],
    description:
      "Write up SSIDs, VLANs and the guest portal settings in the IT Operations pages.",
  },
  {
    n: 7,
    title: "Tune monitoring alerts to reduce CPU noise",
    type: "task",
    priority: "medium",
    state: "in-progress",
    assignee: "agent2",
    due: -2,
    description:
      "Most overnight pages are short CPU spikes. Raise the threshold and add a five-minute duration.",
  },
  {
    n: 8,
    title: "Decommission the old print server",
    type: "task",
    priority: "low",
    state: "cancelled",
    assignee: "agent1",
    due: -8,
    description:
      "Cancelled: the print server is still needed by the warehouse label printers.",
  },
  {
    n: 9,
    title: "Onboard two new service desk agents",
    type: "task",
    priority: "medium",
    state: "in-progress",
    assignee: "lead",
    due: 7,
    description:
      "Accounts, equipment and a first-week plan for the two agents starting next Monday.",
  },
  {
    n: 10,
    title: "Create accounts and prepare laptops for the new agents",
    type: "sub-task",
    priority: "medium",
    state: "to-do",
    assignee: "agent1",
    due: 5,
    parent: 9,
    labels: ["Access", "Hardware"],
    description: "Standard agent build, service desk licence and VPN access.",
  },
  {
    n: 11,
    title: "Shadowing schedule for the first week",
    type: "sub-task",
    priority: "low",
    state: "to-do",
    assignee: "agent2",
    due: 6,
    parent: 9,
    description:
      "Pair each new agent with an experienced agent for the first five days.",
  },
  {
    n: 12,
    title: "Annual firewall rule review",
    type: "task",
    priority: "high",
    state: "done",
    assignee: "agent1",
    due: -10,
    labels: ["Security"],
    description:
      "Reviewed all inbound rules. Removed four unused rules and documented the rest.",
  },
];

const WEB_ITEMS: ItemSpec[] = [
  {
    n: 1,
    title: "Epic: New product catalogue pages",
    type: "epic",
    priority: "high",
    state: "in-progress",
    assignee: "lead",
    due: 20,
    description:
      "Replace the old catalogue with filterable listing pages and new product detail pages.",
  },
  {
    n: 2,
    title: "Design the catalogue listing template",
    type: "story",
    priority: "medium",
    state: "done",
    assignee: "agent2",
    due: -4,
    parent: 1,
    labels: ["Frontend"],
    description:
      "Agreed with Fabrikam marketing: three-column grid on desktop, one column on mobile.",
  },
  {
    n: 3,
    title: "Filter products by category and price",
    type: "story",
    priority: "high",
    state: "in-progress",
    assignee: "agent1",
    due: 6,
    parent: 1,
    labels: ["Frontend", "Backend"],
    description:
      "Customers can narrow the catalogue by category and a price range. Filters combine.",
  },
  {
    n: 4,
    title: "Price range slider component",
    type: "sub-task",
    priority: "medium",
    state: "in-progress",
    assignee: "agent1",
    due: 3,
    parent: 3,
    labels: ["Frontend"],
    description: "Keyboard accessible slider with minimum and maximum handles.",
  },
  {
    n: 5,
    title: "Keep the selected filters in the page address",
    type: "sub-task",
    priority: "low",
    state: "to-do",
    assignee: "agent1",
    due: 8,
    parent: 3,
    labels: ["Frontend"],
    description:
      "So a filtered list can be bookmarked and shared, and the back button works.",
  },
  {
    n: 6,
    title: "Epic: Checkout and payments",
    type: "epic",
    priority: "urgent",
    state: "to-do",
    assignee: "lead",
    due: 28,
    description: "A new checkout with card payments and order confirmation.",
  },
  {
    n: 7,
    title: "Connect the card payment provider in test mode",
    type: "story",
    priority: "high",
    state: "to-do",
    assignee: "agent2",
    due: 15,
    parent: 6,
    labels: ["Backend"],
    description:
      "Use the provider's sandbox and published test cards only. No live keys.",
  },
  {
    n: 8,
    title: "Order confirmation email template",
    type: "task",
    priority: "medium",
    state: "backlog",
    assignee: null,
    due: 22,
    parent: 6,
    description: "Plain, branded confirmation email with the order summary.",
  },
  {
    n: 9,
    title: "Epic: Launch readiness",
    type: "epic",
    priority: "medium",
    state: "backlog",
    assignee: "lead",
    due: 27,
    description: "Everything that must be true before the new site goes live.",
  },
  {
    n: 10,
    title: "Accessibility audit of the key pages",
    type: "task",
    priority: "high",
    state: "to-do",
    assignee: "agent2",
    due: 18,
    parent: 9,
    labels: ["Frontend"],
    description:
      "Check home, catalogue, product and checkout pages against WCAG 2.2 AA.",
  },
  {
    n: 11,
    title: "Redirect old page addresses to the new site",
    type: "task",
    priority: "medium",
    state: "backlog",
    assignee: "agent1",
    due: 24,
    parent: 9,
    labels: ["Backend"],
    description:
      "Map the top 200 old addresses to their new pages with permanent redirects.",
  },
  {
    n: 12,
    title: "Homepage banner image is blurry on mobile",
    type: "bug",
    priority: "medium",
    state: "in-progress",
    assignee: "agent2",
    requester: "fabrikam1",
    due: -1,
    visibility: "organisation",
    labels: ["Frontend"],
    description:
      "On phones the main banner looks pixelated. Reported by Fabrikam marketing.",
  },
  {
    n: 13,
    title: "Contact form does not send a confirmation email",
    type: "bug",
    priority: "high",
    state: "done",
    assignee: "agent1",
    requester: "fabrikam1",
    due: -3,
    visibility: "organisation",
    labels: ["Backend"],
    description:
      "Visitors who use the contact form do not receive the confirmation email.",
  },
];

const ITEMS: Record<ProjectKey, ItemSpec[]> = {
  SUP: SUP_ITEMS,
  OPS: OPS_ITEMS,
  WEB: WEB_ITEMS,
};

const LABELS = [
  { id: "uat-label-access", name: "Access", color: "teal", project: null },
  { id: "uat-label-network", name: "Network", color: "blue", project: null },
  {
    id: "uat-label-hardware",
    name: "Hardware",
    color: "orange",
    project: null,
  },
  { id: "uat-label-security", name: "Security", color: "red", project: null },
  { id: "uat-label-email", name: "Email", color: "purple", project: null },
  {
    id: "uat-label-web-frontend",
    name: "Frontend",
    color: "green",
    project: "WEB",
  },
  {
    id: "uat-label-web-backend",
    name: "Backend",
    color: "yellow",
    project: "WEB",
  },
] as const;

type CommentSpec = {
  id: string;
  item: string;
  author: string;
  visibility: "public" | "internal";
  hoursAgo: number;
  text: string;
};

const COMMENTS: CommentSpec[] = [
  {
    id: "uat-comment-sup-1-a",
    item: "SUP-1",
    author: "agent1",
    visibility: "public",
    hoursAgo: 26,
    text: "Thanks Emma. Could you tell us whether this happens on the web version of Outlook too?",
  },
  {
    id: "uat-comment-sup-1-b",
    item: "SUP-1",
    author: "contoso1",
    visibility: "public",
    hoursAgo: 20,
    text: "Only in the desktop app. The web version works fine.",
  },
  {
    id: "uat-comment-sup-1-c",
    item: "SUP-1",
    author: "agent1",
    visibility: "internal",
    hoursAgo: 18,
    text: "Looks like the cached credential issue from the October update. Trying the credential manager fix first.",
  },
  {
    id: "uat-comment-sup-3-a",
    item: "SUP-3",
    author: "contoso1",
    visibility: "public",
    hoursAgo: 30,
    text: "Still happening this morning, it dropped three times before 10am.",
  },
  {
    id: "uat-comment-sup-3-b",
    item: "SUP-3",
    author: "lead",
    visibility: "internal",
    hoursAgo: 28,
    text: "Overdue against the SLA. Marcus, please escalate to the network provider today.",
  },
  {
    id: "uat-comment-sup-7-a",
    item: "SUP-7",
    author: "lead",
    visibility: "public",
    hoursAgo: 120,
    text: "We have blocked the sender and removed the email from all mailboxes. Thank you for reporting it.",
  },
  {
    id: "uat-comment-sup-11-a",
    item: "SUP-11",
    author: "agent1",
    visibility: "internal",
    hoursAgo: 4,
    text: "Change approval requested from Laura. Rollback plan is in the IT Operations runbook.",
  },
  {
    id: "uat-comment-ops-1-a",
    item: "OPS-1",
    author: "agent1",
    visibility: "internal",
    hoursAgo: 6,
    text: "Certificate request submitted. Waiting for domain validation.",
  },
  {
    id: "uat-comment-web-3-a",
    item: "WEB-3",
    author: "agent1",
    visibility: "internal",
    hoursAgo: 10,
    text: "Category filter is done. Price filter waits for the slider component.",
  },
  {
    id: "uat-comment-web-12-a",
    item: "WEB-12",
    author: "fabrikam1",
    visibility: "public",
    hoursAgo: 40,
    text: "It is most visible on iPhones. I attached the original image to the request.",
  },
  {
    id: "uat-comment-web-12-b",
    item: "WEB-12",
    author: "agent2",
    visibility: "public",
    hoursAgo: 22,
    text: "Thanks Nina. We are adding a higher resolution version for small screens and will update you tomorrow.",
  },
];

const REQUEST_TYPES = [
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

type SubmissionSpec = {
  requester: string;
  requestType: (typeof REQUEST_TYPES)[number]["name"];
  summary: string;
  details: string;
  impact?: "Blocked" | "Slowed down" | "Minor";
  visibility: "private" | "organisation";
  /** Accept into this project; omitted submissions stay in triage. */
  acceptInto?: ProjectKey;
  acceptedBy?: string;
};

const SUBMISSIONS: SubmissionSpec[] = [
  {
    requester: "contoso1",
    requestType: "Report a problem",
    summary: "Cannot open PDF attachments in Outlook",
    details:
      "Double-clicking a PDF attachment does nothing since this morning.",
    impact: "Slowed down",
    visibility: "organisation",
    acceptInto: "SUP",
    acceptedBy: "agent1",
  },
  {
    requester: "contoso1",
    requestType: "Access request",
    summary: "Access to the Board Reports folder",
    details: "I now prepare the monthly board pack and need edit access.",
    visibility: "private",
    acceptInto: "SUP",
    acceptedBy: "agent2",
  },
  {
    requester: "contoso1",
    requestType: "General question",
    summary: "How do I set up an out-of-office reply on my phone?",
    details: "I use the Outlook app on Android.",
    visibility: "organisation",
  },
  {
    requester: "contoso2",
    requestType: "Change request",
    summary: "Add two new cost centres to the expenses system",
    details: "Cost centres 4410 and 4420 from 1 December for the new team.",
    visibility: "organisation",
    acceptInto: "SUP",
    acceptedBy: "agent1",
  },
  {
    requester: "contoso2",
    requestType: "Access request",
    summary: "Payroll system access for my new deputy",
    details: "Read-only access for Priya Shah from next Monday.",
    visibility: "private",
  },
  {
    requester: "fabrikam1",
    requestType: "Report a problem",
    summary: "Search on the new site returns no results for product codes",
    details: "Searching for FX-200 shows nothing, although the product exists.",
    impact: "Blocked",
    visibility: "organisation",
    acceptInto: "WEB",
    acceptedBy: "agent2",
  },
  {
    requester: "fabrikam1",
    requestType: "Change request",
    summary: "Update the footer with the new office address",
    details: "We move to 12 Harbour Street on 1 December.",
    visibility: "organisation",
    acceptInto: "WEB",
    acceptedBy: "agent1",
  },
  {
    requester: "fabrikam1",
    requestType: "General question",
    summary: "Can we preview the checkout before launch?",
    details: "Our finance team would like to try the checkout in test mode.",
    visibility: "organisation",
  },
];

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
    markdown: `# Raising a request

Use the customer portal to ask for help. Choose the form that fits best.

## Steps

1. Sign in to the customer portal.
2. Choose a form, for example **Report a problem** or **Access request**.
3. Fill in the summary and the details, then submit.

You can follow progress and reply to the service desk from **My requests**.`,
  },
  {
    title: "Reset your password",
    category: "Accounts and access",
    customerVisible: true,
    markdown: `# Reset your password

If you have forgotten your password, use **Forgot password** on the sign-in page.

- The reset link is valid for one hour.
- Check your junk folder if the email does not arrive.
- Contact the service desk if your account is locked.`,
  },
  {
    title: "Connect to the VPN from home",
    category: "Troubleshooting",
    customerVisible: true,
    markdown: `# Connect to the VPN

1. Open the VPN client from the system tray.
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
    markdown: `# Priority levels

- **Urgent**: you cannot work and there is no workaround. First response within 1 business hour.
- **High**: work is badly affected. First response within 4 business hours.
- **Medium**: work is affected but you can continue. First response within 1 business day.
- **Low**: questions and small requests. First response within 2 business days.`,
  },
  {
    title: "Triage checklist for new requests",
    category: "Troubleshooting",
    customerVisible: false,
    markdown: `# Triage checklist (staff only)

1. Check the requester's organisation and the request type.
2. Look for duplicates before accepting.
3. Set the priority from the impact the customer selected.
4. Accept into the right project and assign an agent.

Internal note: never share another customer's request details.`,
  },
];

const PAGES: { project: ProjectKey; title: string; markdown: string }[] = [
  {
    project: "OPS",
    title: "New starter onboarding guide",
    markdown: `# New starter onboarding guide

Welcome to the Northwind service desk team.

## Week one

- Day 1: accounts, laptop and a tour of the service desk tools.
- Day 2 to 4: shadow an experienced agent.
- Day 5: handle simple requests with a buddy reviewing.

## Useful links

- The IT Operations runbook in these pages.
- The knowledge base for customer-facing answers.`,
  },
  {
    project: "OPS",
    title: "Major incident runbook",
    markdown: `# Major incident runbook

Use this when a service is down for more than one customer.

1. Open an urgent incident and assign the on-call agent.
2. Tell the lead and post a status update every 30 minutes.
3. Record each action as an internal comment on the incident.
4. After recovery, write a short review within two business days.

## Rollback

Every change must name its rollback step before approval.`,
  },
  {
    project: "WEB",
    title: "Release notes: website beta 2",
    markdown: `# Website beta 2

## New

- Catalogue listing pages with a three-column grid.
- Category filter on the catalogue.

## Fixed

- Contact form now sends its confirmation email.

## Known issues

- The homepage banner is blurry on some phones.`,
  },
  {
    project: "SUP",
    title: "Contoso service desk handbook",
    markdown: `# Contoso service desk handbook

Contoso Ltd is supported Monday to Friday, 9:00 to 17:30 UK time, excluding UK bank holidays.

## Contacts

- Emma Clarke: office manager, main contact.
- James Wright: finance, approves new starters.

## Agreed service levels

Response and resolution targets follow the **Customer support SLA**.`,
  },
];

type DocNode = { type: string; [key: string]: unknown };

function inline(text: string): DocNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
  return parts.map((part) =>
    part.startsWith("**") && part.endsWith("**")
      ? { type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] }
      : { type: "text", text: part },
  );
}

/** Small Markdown subset (headings, lists, paragraphs, bold) to a Tiptap document. */
export function markdownToDoc(markdown: string): DocNode {
  const content: DocNode[] = [];
  const blocks = markdown.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0] ?? "");
    if (heading && lines.length === 1) {
      content.push({
        type: "heading",
        attrs: { level: heading[1]?.length ?? 1 },
        content: inline(heading[2] ?? ""),
      });
      continue;
    }
    if (lines.every((line) => /^- /.test(line))) {
      content.push({
        type: "bulletList",
        content: lines.map((line) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: inline(line.slice(2)) }],
        })),
      });
      continue;
    }
    if (lines.every((line) => /^\d+\. /.test(line))) {
      content.push({
        type: "orderedList",
        content: lines.map((line) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: inline(line.replace(/^\d+\. /, "")),
            },
          ],
        })),
      });
      continue;
    }
    content.push({ type: "paragraph", content: inline(lines.join(" ")) });
  }
  return { type: "doc", content };
}

function paragraphDoc(text: string): DocNode {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function fixtureConflict(kind: string, key: string): never {
  throw new Error(
    `UAT seed refused: an existing ${kind} (${key}) conflicts with the UAT fixture. Nothing was changed by this step.`,
  );
}

function same(left: unknown, right: unknown) {
  const normalise = (value: unknown) =>
    value instanceof Date ? value.toISOString() : JSON.stringify(value ?? null);
  return normalise(left) === normalise(right);
}

type IdTable = PgTable & { id: PgColumn };

/**
 * Insert `values` unless a row with its id exists. An existing row must agree on `identity`
 * (the fields that make it the same fixture), otherwise the seed refuses. Never updates.
 * Returns true when the row was inserted by this call.
 */
async function ensureById<T extends IdTable>(
  tx: Tx,
  table: T,
  values: T["$inferInsert"] & { id: string },
  identity: readonly string[],
  kind: string,
): Promise<boolean> {
  const [existing] = (await tx
    .select()
    .from(table as PgTable)
    .where(eq(table.id, values.id))
    .limit(1)) as Record<string, unknown>[];
  if (existing) {
    const record = values as Record<string, unknown>;
    for (const key of identity)
      if (!same(existing[key], record[key])) fixtureConflict(kind, values.id);
    return false;
  }
  await tx.insert(table).values(values as never);
  return true;
}

function parseArgs(argv: readonly string[]) {
  if (!argv.includes("--uat"))
    throw new Error(
      "seed-uat requires --uat and a private --credentials-file destination. Use it only on a dedicated UAT database.",
    );
  const index = argv.indexOf("--credentials-file");
  const credentialsFile = index >= 0 ? argv[index + 1] : undefined;
  if (!credentialsFile || credentialsFile.startsWith("--"))
    throw new Error(
      "Supply --credentials-file with a new private file outside the source checkout.",
    );
  return { credentialsFile };
}

function assertNotLiveDatabase(name: string) {
  if (name === UAT_LIVE_DATABASE_NAME)
    throw new Error(
      `UAT seed refused: ${UAT_LIVE_DATABASE_NAME} is the live database and must never be seeded.`,
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
      "UAT credentials must be written outside the source checkout.",
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
  if (!Array.isArray(rows) || rows.length !== UAT_ACCOUNTS.length)
    throw new Error(
      `The private credentials file must contain exactly the ${UAT_ACCOUNTS.length} UAT accounts.`,
    );
  for (const account of UAT_ACCOUNTS) {
    const matching = rows.filter((row) => row && row.email === account.email);
    if (
      matching.length !== 1 ||
      typeof matching[0].password !== "string" ||
      matching[0].password.length < 24
    )
      throw new Error(
        "The private credentials file has missing, duplicate or weak account credentials.",
      );
    account.password = matching[0].password;
  }
  return true;
}

/**
 * Read-only checks for every globally unique name this seed claims. Returns whether any UAT
 * account already exists (so a missing credentials file can be refused before anything is
 * written).
 */
async function precheck(credentialsLoaded: boolean) {
  const [{ name } = { name: "" }] = (
    await db.execute<{ name: string }>(sql`SELECT current_database() AS name`)
  ).rows;
  assertNotLiveDatabase(name);

  let accountsExist = false;
  for (const account of UAT_ACCOUNTS) {
    const byEmail = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, account.email));
    const byId = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, account.id));
    if (byEmail.some((row) => row.id !== account.id))
      fixtureConflict("user email", account.email);
    if (byId.some((row) => row.email !== account.email))
      fixtureConflict("user", account.id);
    if (byId[0]) {
      accountsExist = true;
      if (!credentialsLoaded)
        throw new Error(
          "UAT seed refused: UAT accounts already exist. Supply the credentials file written by the first run.",
        );
      const [credential] = await db
        .select({ password: schema.accountTable.password })
        .from(schema.accountTable)
        .where(
          and(
            eq(schema.accountTable.userId, account.id),
            eq(schema.accountTable.providerId, "credential"),
          ),
        );
      if (
        !credential?.password ||
        !(await bcrypt.compare(account.password, credential.password))
      )
        throw new Error(
          "UAT seed refused: the credentials file does not match the existing UAT accounts.",
        );
    }
    const [personByUser] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, account.id));
    if (personByUser && personByUser.id !== account.personId)
      fixtureConflict("person", account.personId);
  }

  for (const org of Object.values(CUSTOMER_ORGS)) {
    const rows = await db
      .select()
      .from(schema.organisationTable)
      .where(
        sql`${schema.organisationTable.id} = ${org.id} OR ${schema.organisationTable.key} = ${org.key}`,
      );
    if (rows.some((row) => row.id !== org.id || row.key !== org.key))
      fixtureConflict("organisation", org.key);
  }

  const workspaces = await db
    .select()
    .from(schema.workspaceTable)
    .where(
      sql`${schema.workspaceTable.id} = ${UAT_WORKSPACE_ID} OR ${schema.workspaceTable.slug} = ${UAT_WORKSPACE_SLUG}`,
    );
  if (
    workspaces.some(
      (row) => row.id !== UAT_WORKSPACE_ID || row.slug !== UAT_WORKSPACE_SLUG,
    )
  )
    fixtureConflict("workspace", UAT_WORKSPACE_SLUG);

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
          row.workspaceId !== UAT_WORKSPACE_ID,
      )
    )
      fixtureConflict("project", project.slug);
    const claims = await db
      .select()
      .from(schema.projectSlugClaimTable)
      .where(eq(schema.projectSlugClaimTable.slug, project.slug));
    if (claims.some((claim) => claim.projectId !== project.id))
      fixtureConflict("project slug claim", project.slug);
    const keyed = await db
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
      })
      .from(schema.workItemTable)
      .where(sql`${schema.workItemTable.key} LIKE ${`${project.slug}-%`}`);
    if (keyed.some((row) => row.projectId !== project.id))
      fixtureConflict("work item key", `${project.slug}-*`);
  }
  return { accountsExist };
}

const UAT_WORKSPACE_SLUG = "northwind-service-desk-uat";
/** Days the seeded pending CAB approval stays open; covers the UAT window. */
const UAT_APPROVAL_EXPIRY_DAYS = 28;

type Seeded = {
  people: Map<string, string>;
  users: Map<string, string>;
  typeIds: Map<string, string>;
};

async function seedCore(tx: Tx, now: Date): Promise<Seeded> {
  const date = (days: number) => new Date(now.getTime() + days * 86_400_000);
  const internalOrg = await ensureInternalOrganisation(tx);

  for (const org of Object.values(CUSTOMER_ORGS))
    await ensureById(
      tx,
      schema.organisationTable,
      {
        id: org.id,
        key: org.key,
        name: org.name,
        isInternal: false,
        domain: [...org.domain],
        active: true,
        portalAccess: true,
        defaultCustomerVisibility: "organisation",
        createdAt: now,
        updatedAt: now,
      },
      ["key", "isInternal"],
      "organisation",
    );

  // Accounts and people. The SIT helpers write only when the row is absent.
  const people = new Map<string, string>();
  const users = new Map<string, string>();
  for (const account of UAT_ACCOUNTS) {
    const [existingUser] = await tx
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, account.id));
    const userId = existingUser
      ? existingUser.id
      : await upsertUserAndPassword(tx, account, now, "uat");
    const [existingPerson] = await tx
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId));
    const organisationId =
      account.org === "internal"
        ? internalOrg.id
        : CUSTOMER_ORGS[account.org].id;
    if (existingPerson) {
      if (
        existingPerson.id !== account.personId ||
        existingPerson.side !== account.side ||
        existingPerson.organisationId !== organisationId
      )
        fixtureConflict("person", account.personId);
    } else {
      await upsertPerson(tx, {
        userId,
        preferredPersonId: account.personId,
        organisationId,
        side: account.side,
        displayName: account.name,
        now,
      });
    }
    people.set(account.key, account.personId);
    users.set(account.key, userId);
  }
  const person = (key: string) => {
    const id = people.get(key);
    if (!id) throw new Error(`Missing UAT person ${key}`);
    return id;
  };
  const user = (key: string) => {
    const id = users.get(key);
    if (!id) throw new Error(`Missing UAT user ${key}`);
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
      "uat",
    ));
  for (const account of UAT_ACCOUNTS.filter((row) => row.side === "customer")) {
    const organisationId =
      CUSTOMER_ORGS[account.org as "contoso" | "fabrikam"].id;
    if (
      !(await membershipExists(
        tx,
        account.personId,
        "organisation",
        organisationId,
      ))
    )
      await upsertScopedMembership(
        tx,
        {
          personId: account.personId,
          scope: "organisation",
          scopeId: organisationId,
          roleId: customerRoleId,
          seesAll: false,
          now,
        },
        "uat",
      );
  }

  // Workspace, mirroring create-workspace.ts for a workspace this seed owns.
  const workspaceCreated = await ensureById(
    tx,
    schema.workspaceTable,
    {
      id: UAT_WORKSPACE_ID,
      organisationId: internalOrg.id,
      name: "Northwind Service Desk (UAT)",
      slug: UAT_WORKSPACE_SLUG,
      description:
        "User acceptance testing workspace: service desk, internal IT and a client website project.",
      createdAt: now,
    },
    ["slug", "organisationId"],
    "workspace",
  );
  if (workspaceCreated) {
    await seedWorkspaceBuiltInRoles(tx, UAT_WORKSPACE_ID);
    await tx.insert(schema.workspaceRoleTable).values(
      DEFAULT_ROLE_NAMES.map((role) => ({
        workspaceId: UAT_WORKSPACE_ID,
        role,
        permission: JSON.stringify(defaultRolePayloads[role]),
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await seedWorkspaceDefaults(UAT_WORKSPACE_ID, tx);
    await seedDefaultCabWorkflowInTransaction(UAT_WORKSPACE_ID, tx);
    await ensureProjectLeadRole(tx, UAT_WORKSPACE_ID);
  }

  for (const account of UAT_ACCOUNTS) {
    if (!account.workspaceRole) continue;
    const workspaceMemberId = `uat-wm-${account.key}`;
    const inserted = await ensureById(
      tx,
      schema.workspaceUserTable,
      {
        id: workspaceMemberId,
        workspaceId: UAT_WORKSPACE_ID,
        userId: user(account.key),
        role: account.workspaceRole,
        joinedAt: now,
      },
      ["workspaceId", "userId", "role"],
      "workspace member",
    );
    // Owner and admin reach comes from the real sees_all grant writer.
    if (
      inserted &&
      (account.workspaceRole === "owner" || account.workspaceRole === "admin")
    )
      await syncWorkspaceAdminReach(tx, UAT_WORKSPACE_ID, user(account.key));
  }

  await ensureById(
    tx,
    schema.teamTable,
    {
      id: "uat-team-default",
      workspaceId: UAT_WORKSPACE_ID,
      name: "Northwind Service Desk (UAT)",
      createdAt: now,
      updatedAt: now,
    },
    ["workspaceId"],
    "team",
  );
  await ensureById(
    tx,
    schema.teamTable,
    {
      id: "uat-team-cab",
      workspaceId: UAT_WORKSPACE_ID,
      name: "Change Advisory Board",
      isCab: true,
      createdAt: now,
      updatedAt: now,
    },
    ["workspaceId", "isCab"],
    "team",
  );
  for (const [id, teamId, key] of [
    ["uat-team-default-owner", "uat-team-default", "owner"],
    ["uat-team-cab-lead", "uat-team-cab", "lead"],
  ] as const)
    await ensureById(
      tx,
      schema.teamMemberTable,
      { id, teamId, userId: user(key), createdAt: now },
      ["teamId", "userId"],
      "team member",
    );

  for (const role of Object.values(PROJECT_ROLES))
    await ensureById(
      tx,
      schema.roleTable,
      {
        id: role.id,
        workspaceId: UAT_WORKSPACE_ID,
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

  for (const flag of UAT_FEATURE_FLAGS) {
    if (INSTANCE_ONLY_FEATURES.has(flag) || LOCKED_FEATURE_DEFAULTS.has(flag))
      continue;
    await tx
      .insert(schema.workspaceFeatureFlagTable)
      .values({
        workspaceId: UAT_WORKSPACE_ID,
        featureKey: flag,
        enabled: true,
      })
      .onConflictDoNothing();
  }

  // Types and state templates of the UAT workspace.
  const types = await tx
    .select({
      id: schema.workItemTypeTable.id,
      key: schema.workItemTypeTable.key,
    })
    .from(schema.workItemTypeTable)
    .where(eq(schema.workItemTypeTable.workspaceId, UAT_WORKSPACE_ID));
  const typeIds = new Map(types.map((row) => [row.key, row.id]));
  const templates = await tx
    .select({
      id: schema.stateTemplateTable.id,
      key: schema.stateTemplateTable.key,
    })
    .from(schema.stateTemplateTable)
    .where(eq(schema.stateTemplateTable.workspaceId, UAT_WORKSPACE_ID));
  const template = (key: StateKey) => {
    const row = templates.find((candidate) => candidate.key === key);
    if (!row) throw new Error(`Missing UAT state template ${key}`);
    return row.id;
  };

  // Business-hours calendar with holidays, SLA policy and a CAB change workflow.
  await ensureById(
    tx,
    schema.serviceCalendarTable,
    {
      id: "uat-calendar-business",
      workspaceId: UAT_WORKSPACE_ID,
      key: "uat-business-hours",
      name: "UK business hours",
      timezone: "Europe/London",
      windows: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri"].map((day) => [
          day,
          [{ from: 540, to: 1050 }],
        ]),
      ),
      holidays: [
        { date: "2026-11-20", name: "Company training day" },
        { date: "2026-12-25", name: "Christmas Day" },
        { date: "2026-12-28", name: "Boxing Day (substitute day)" },
        { from: "2026-12-29", to: "2026-12-31", name: "Office closure" },
        { date: "2027-01-01", name: "New Year's Day" },
        { recurs: "annually", month: 12, day: 25, name: "Christmas Day" },
      ],
    },
    ["workspaceId", "key"],
    "service calendar",
  );
  const policyCreated = await ensureById(
    tx,
    schema.slaPolicyTable,
    {
      id: "uat-sla-policy",
      workspaceId: UAT_WORKSPACE_ID,
      key: "uat-customer-support",
      name: "Customer support SLA",
      description: "Business-hours response and resolution targets.",
    },
    ["workspaceId", "key"],
    "SLA policy",
  );
  await ensureById(
    tx,
    schema.slaPolicyVersionTable,
    {
      id: "uat-sla-policy-v1",
      workspaceId: UAT_WORKSPACE_ID,
      policyId: "uat-sla-policy",
      number: 1,
      calendarId: "uat-calendar-business",
      atRiskThresholdPct: 75,
      effectiveFrom: null,
    },
    ["workspaceId", "policyId", "number"],
    "SLA policy version",
  );
  const workflowCreated = await ensureById(
    tx,
    schema.workflowTable,
    {
      id: "uat-change-workflow",
      workspaceId: UAT_WORKSPACE_ID,
      key: "uat-change-approval",
      name: "Customer change approval",
    },
    ["workspaceId", "key"],
    "workflow",
  );
  await ensureById(
    tx,
    schema.workflowVersionTable,
    {
      id: "uat-change-workflow-v1",
      workflowId: "uat-change-workflow",
      number: 1,
      publishedAt: date(-14),
      publishedBy: person("admin"),
    },
    ["workflowId", "number"],
    "workflow version",
  );
  for (const [from, to, approval] of [
    ["backlog", "to-do", false],
    ["to-do", "in-progress", true],
    ["in-progress", "done", false],
    ["to-do", "cancelled", false],
  ] as const)
    await ensureById(
      tx,
      schema.workflowTransitionTable,
      {
        id: `uat-change-${from}-${to}`,
        versionId: "uat-change-workflow-v1",
        fromStateTemplateId: template(from),
        toStateTemplateId: template(to),
        requiresApproval: approval,
        requiresCab: approval,
        approvalPolicy: approval ? "any" : null,
        notePolicy: "none",
        noteVisibility: "internal",
      },
      ["versionId"],
      "workflow transition",
    );
  if (workflowCreated)
    await tx
      .update(schema.workflowTable)
      .set({ activeVersionId: "uat-change-workflow-v1" })
      .where(eq(schema.workflowTable.id, "uat-change-workflow"));
  await ensureById(
    tx,
    schema.workItemTypeTable,
    {
      id: "uat-change-type",
      workspaceId: UAT_WORKSPACE_ID,
      key: "uat-change",
      name: "Customer change",
      category: "service",
      isChange: true,
      workflowId: "uat-change-workflow",
      slaPolicyId: "uat-sla-policy",
    },
    ["workspaceId", "key"],
    "work item type",
  );
  typeIds.set("uat-change", "uat-change-type");
  const typeId = (key: string) => {
    const id = typeIds.get(key);
    if (!id) throw new Error(`Missing UAT work item type ${key}`);
    return id;
  };
  if (policyCreated) {
    // Like the policy publisher: complete the goals, then publish and activate.
    const targets: Record<Priority, [number, number]> = {
      urgent: [60, 480],
      high: [240, 960],
      medium: [480, 2400],
      low: [960, 4800],
    };
    for (const type of [
      "incident",
      "service-request",
      "problem",
      "change",
      "bug",
      "uat-change",
    ])
      for (const metric of ["first_response", "resolution"] as const)
        for (const priority of ["low", "medium", "high", "urgent"] as const)
          await tx.insert(schema.slaGoalTable).values({
            id: `uat-sla-goal-${type}-${metric}-${priority}`,
            workspaceId: UAT_WORKSPACE_ID,
            versionId: "uat-sla-policy-v1",
            metric,
            workItemTypeId: typeId(type),
            priority,
            targetMinutes:
              targets[priority][metric === "first_response" ? 0 : 1],
          });
    await tx
      .update(schema.slaPolicyVersionTable)
      .set({ effectiveFrom: date(-30) })
      .where(eq(schema.slaPolicyVersionTable.id, "uat-sla-policy-v1"));
    await tx
      .update(schema.slaPolicyTable)
      .set({ activeVersionId: "uat-sla-policy-v1" })
      .where(eq(schema.slaPolicyTable.id, "uat-sla-policy"));
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
        workspaceId: UAT_WORKSPACE_ID,
        organisationId: project.org ? CUSTOMER_ORGS[project.org].id : null,
        kind: "project",
        slug: project.slug,
        name: project.name,
        description: project.description,
        icon: project.icon,
        position: Object.keys(PROJECTS).indexOf(key),
        lastTaskNumber: ITEMS[key].length,
        slaPolicyMode: project.sla ? "override" : "inherit",
        slaPolicyId: project.sla ? "uat-sla-policy" : null,
        createdAt: date(-45),
      },
      ["workspaceId", "slug", "organisationId"],
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
      await seedProjectStates(project.id, UAT_WORKSPACE_ID, tx);
    }
    for (const account of UAT_ACCOUNTS) {
      if (!account.projectRole) continue;
      if (
        !(await membershipExists(tx, account.personId, "project", project.id))
      )
        await upsertScopedMembership(
          tx,
          {
            personId: account.personId,
            scope: "project",
            scopeId: project.id,
            roleId: PROJECT_ROLES[account.projectRole].id,
            seesAll: false,
            now,
          },
          "uat",
        );
    }
  }

  await lockWorkspaceLabelNames(
    tx,
    UAT_WORKSPACE_ID,
    LABELS.map((label) => label.name),
  );
  for (const label of LABELS)
    await ensureById(
      tx,
      schema.labelTable,
      {
        id: label.id,
        workspaceId: UAT_WORKSPACE_ID,
        projectId: label.project ? PROJECTS[label.project].id : null,
        taskId: null,
        name: label.name,
        color: label.color,
        createdAt: now,
        updatedAt: now,
      },
      ["workspaceId", "projectId", "taskId"],
      "label",
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
      const id = `uat-wi-${project.slug.toLowerCase()}-${item.n}`;
      const finished = item.state === "done" || item.state === "cancelled";
      const started = item.state === "in-progress" || finished;
      const slaApplies = project.sla && item.type !== "epic" && item.requester;
      // Open SLA items arrived within the last two days, so UAT sees a realistic mix of
      // on-track, at-risk and breached timers rather than a wall of week-old breaches.
      const created =
        slaApplies && !finished
          ? new Date(
              now.getTime() -
                Math.max(
                  [3, 6, 20, 26, 50][item.n % 5],
                  // Never newer than the item's oldest seeded comment.
                  ...COMMENTS.filter(
                    (comment) => comment.item === `${project.slug}-${item.n}`,
                  ).map((comment) => comment.hoursAgo + 1),
                ) *
                  3_600_000,
            )
          : date(Math.min(item.due, 0) - 7 - (item.n % 5));
      const visibility =
        item.visibility ??
        (key === "SUP"
          ? "organisation"
          : key === "WEB"
            ? "private"
            : "private");
      const inserted = await ensureById(
        tx,
        schema.workItemTable,
        {
          id,
          projectId: project.id,
          workspaceId: UAT_WORKSPACE_ID,
          typeId: typeId(item.type),
          number: item.n,
          key: `${project.slug}-${item.n}`,
          title: item.title,
          description: paragraphDoc(item.description),
          stateId: state(item.state),
          priority: item.priority,
          assigneeId: item.assignee ? person(item.assignee) : null,
          requesterId: item.requester ? person(item.requester) : null,
          parentId: item.parent
            ? `uat-wi-${project.slug.toLowerCase()}-${item.parent}`
            : null,
          startDate: started ? date(Math.min(item.due, 0) - 5) : null,
          dueDate: date(item.due),
          position: String(item.n).padStart(4, "0"),
          customerVisibility: visibility,
          slaStartedAt: slaApplies ? created : null,
          slaPolicyVersionId: slaApplies ? "uat-sla-policy-v1" : null,
          firstResponseAt:
            slaApplies && started
              ? new Date(created.getTime() + 30 * 60_000)
              : null,
          resolvedAt: item.state === "done" ? date(item.due) : null,
          createdAt: created,
          updatedAt: now,
        },
        ["projectId", "workspaceId", "number", "key"],
        "work item",
      );
      if (!inserted) continue;
      await recordWorkItemActivity(tx, [
        {
          workspaceId: UAT_WORKSPACE_ID,
          workItemId: id,
          actorId: item.requester
            ? person(item.requester)
            : person(item.assignee ?? "lead"),
          actorType: "person",
          verb: "created",
          payload: { key: `${project.slug}-${item.n}`, title: item.title },
          createdAt: created,
        },
      ]);
      const links = (item.labels ?? []).map((name) => {
        const label = LABELS.find(
          (candidate) =>
            candidate.name === name &&
            (candidate.project === null || candidate.project === key),
        );
        if (!label) throw new Error(`Unknown UAT label ${name}`);
        return { workItemId: id, labelId: label.id };
      });
      if (links.length)
        await tx
          .insert(schema.workItemLabelTable)
          .values(links)
          .onConflictDoNothing();
    }
  }

  for (const [id, source, target] of [
    ["uat-relation-web-3-blocks-web-10", "uat-wi-web-3", "uat-wi-web-10"],
    ["uat-relation-ops-2-blocks-ops-5", "uat-wi-ops-2", "uat-wi-ops-5"],
  ] as const)
    await ensureById(
      tx,
      schema.workItemRelationTable,
      { id, sourceId: source, targetId: target, type: "blocks" },
      ["sourceId", "targetId", "type"],
      "work item relation",
    );

  for (const comment of COMMENTS) {
    const [project, number] = comment.item.split("-") as [string, string];
    const at = new Date(now.getTime() - comment.hoursAgo * 3_600_000);
    await ensureById(
      tx,
      schema.commentTable,
      {
        id: comment.id,
        workspaceId: UAT_WORKSPACE_ID,
        workItemId: `uat-wi-${project.toLowerCase()}-${number}`,
        // The real comment writer (create-comment.ts) stores the author's
        // person id; ownership checks and SLA joins match on person.id.
        authorId: person(comment.author),
        actorType: "person",
        visibility: comment.visibility,
        body: paragraphDoc(comment.text),
        createdAt: at,
        updatedAt: at,
      },
      ["workspaceId", "workItemId", "authorId"],
      "comment",
    );
  }

  await ensureById(
    tx,
    schema.approvalTable,
    {
      id: "uat-approval-sup-11",
      workspaceId: UAT_WORKSPACE_ID,
      workItemId: "uat-wi-sup-11",
      transitionId: "uat-change-to-do-in-progress",
      kind: "cab",
      requestedBy: person("agent1"),
      approverId: person("lead"),
      state: "pending",
      createdAt: new Date(now.getTime() - 4 * 3_600_000),
      // Stays open for the whole UAT window: the reminder scan expires approvals
      // past expiresAt and decisions are refused after it.
      expiresAt: date(UAT_APPROVAL_EXPIRY_DAYS),
    },
    ["workspaceId", "workItemId", "transitionId", "kind"],
    "approval",
  );

  return { people, users, typeIds };
}

async function membershipExists(
  tx: Tx,
  personId: string,
  scope: "organisation" | "workspace" | "project",
  scopeId: string,
) {
  const [row] = await tx
    .select({ id: schema.membershipTable.id })
    .from(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, personId),
        eq(schema.membershipTable.scope, scope),
        eq(schema.membershipTable.scopeId, scopeId),
      ),
    )
    .limit(1);
  return Boolean(row);
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
          eq(schema.requestTypeTable.workspaceId, UAT_WORKSPACE_ID),
          eq(schema.requestTypeTable.name, def.name),
        ),
      )
      .limit(1);
    const typeId = seeded.typeIds.get(def.type);
    if (!typeId) throw new Error(`Missing UAT work item type ${def.type}`);
    const id =
      existing?.id ??
      (
        await createRequestType(
          {
            workspaceId: UAT_WORKSPACE_ID,
            name: def.name,
            description: def.description,
            group: def.group,
            workItemTypeId: typeId,
            defaultProjectId: PROJECTS.SUP.id,
            formSchema: { fields: def.fields.map((field) => ({ ...field })) },
            autoAccept: false,
            customerVisible: true,
            forcePrivate: false,
            position,
          },
          person("admin"),
        )
      ).id;
    for (const org of Object.values(CUSTOMER_ORGS))
      await db
        .insert(schema.organisationRequestTypeTable)
        .values({ organisationId: org.id, requestTypeId: id })
        .onConflictDoNothing();
    if (!existing?.published) await publishRequestType(id, person("admin"));
  }

  let accepted = 0;
  for (const spec of SUBMISSIONS) {
    const [existing] = await db
      .select({
        id: schema.submissionTable.id,
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
            eq(schema.requestTypeTable.workspaceId, UAT_WORKSPACE_ID),
            eq(schema.requestTypeTable.name, spec.requestType),
          ),
        );
      if (!requestType) throw new Error("UAT request type is missing.");
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
      submission = {
        id: created.id,
        number: created.number,
        state: created.state,
      };
    }
    if (!spec.acceptInto || !spec.acceptedBy || submission.state !== "new")
      continue;
    const requestType = REQUEST_TYPES.find(
      (row) => row.name === spec.requestType,
    );
    const typeId = requestType && seeded.typeIds.get(requestType.type);
    if (!typeId) throw new Error("UAT accept type is missing.");
    await acceptSubmission(
      formatSubmissionReference(submission.number),
      UAT_WORKSPACE_ID,
      person(spec.acceptedBy),
      PROJECTS[spec.acceptInto].id,
      typeId,
      async () => true,
    );
    accepted++;
  }
  return accepted;
}

async function seedKnowledgeBase(seeded: Seeded) {
  const personId = seeded.people.get("admin") ?? "";
  const actor = {
    userId: seeded.users.get("admin") ?? "",
    personId,
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
          eq(kbCategoryTable.workspaceId, UAT_WORKSPACE_ID),
          eq(kbCategoryTable.name, name),
        ),
      )
      .limit(1);
    const id =
      existing?.id ??
      (
        await createCategory({
          workspaceId: UAT_WORKSPACE_ID,
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
          eq(kbArticleTable.workspaceId, UAT_WORKSPACE_ID),
          eq(kbArticleTable.title, article.title),
        ),
      )
      .limit(1);
    if (existing) continue;
    const created = await createArticle({
      workspaceId: UAT_WORKSPACE_ID,
      title: article.title,
      body: markdownToDoc(article.markdown),
      categoryId: categories.get(article.category) ?? null,
      customerVisible: article.customerVisible,
      actor,
      projectReaches: async () => true,
    });
    let version = created.version;
    if (await reviewStepEnabled(UAT_WORKSPACE_ID)) {
      const submitted = await transitionArticle({
        id: created.id,
        workspaceId: UAT_WORKSPACE_ID,
        reachableProjectIds: [],
        version,
        action: "submit",
        actor,
      });
      version = submitted?.version ?? version;
    }
    await transitionArticle({
      id: created.id,
      workspaceId: UAT_WORKSPACE_ID,
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
      { workspaceId: UAT_WORKSPACE_ID, projectId },
      { title: page.title, body: markdownToDoc(page.markdown) },
      actor,
    );
  }
}

/** Instance facts that decide how UAT accounts sign in; read only, never changed here. */
async function signInReport() {
  const [setting] = await db
    .select({ policy: schema.instanceSettingTable.localFactorPolicy })
    .from(schema.instanceSettingTable)
    .limit(1);
  const mode = setting?.policy?.mode ?? "optional";
  const requiredRoleId =
    setting?.policy && "requiredRoleId" in setting.policy
      ? String(setting.policy.requiredRoleId ?? "")
      : undefined;
  const [passwordPlugin] = await db
    .select({ enabled: schema.instancePluginConfigTable.enabled })
    .from(schema.instancePluginConfigTable)
    .where(
      and(
        eq(schema.instancePluginConfigTable.pluginId, "auth.password"),
        eq(schema.instancePluginConfigTable.enabled, true),
        ne(schema.instancePluginConfigTable.portalScope, "none"),
      ),
    )
    .limit(1);
  return { mode, requiredRoleId, passwordSignIn: Boolean(passwordPlugin) };
}

export async function runUatSeed(argv: readonly string[] = process.argv) {
  const { credentialsFile } = parseArgs(argv);
  config();
  assertNotLiveDatabase(resolveDatabaseConfig().database);
  const destination = resolveCredentialsDestination(credentialsFile);
  const credentialsLoaded = loadExistingCredentials(destination);
  const now = new Date();
  try {
    await precheck(credentialsLoaded);
    if (!credentialsLoaded)
      writeFileSync(
        destination,
        `${JSON.stringify(
          {
            accounts: UAT_ACCOUNTS.map(
              ({ email, password, roleLabel, name }) => ({
                email,
                password,
                role: roleLabel,
                name,
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
    const report = await signInReport();
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.workspaceId, UAT_WORKSPACE_ID));
    console.log(
      `UAT seed complete: workspace ${UAT_WORKSPACE_ID}, ${UAT_ACCOUNTS.length} accounts, ${count} work items (${accepted} accepted this run). Credentials are in the private file you supplied.`,
    );
    console.log(
      `Local factor (MFA) policy: ${report.mode}. ${
        report.mode === "off" || report.mode === "optional"
          ? "No MFA enrolment is required at first sign-in, including the God Mode account."
          : report.mode === "required_staff"
            ? "Staff accounts, including God Mode, must enrol an authenticator at first sign-in; customers do not."
            : report.mode === "required_everyone"
              ? "Every UAT account, customers included, must enrol an authenticator at first sign-in."
              : `Only holders of the required role (${report.requiredRoleId ?? "not set"}) must enrol an authenticator at first sign-in.`
      }`,
    );
    if (!report.passwordSignIn)
      console.warn(
        "Warning: no enabled email and password sign-in plugin was found; UAT accounts cannot sign in with a password until an administrator enables it.",
      );
  } finally {
    await getDatabasePool().end();
  }
}
