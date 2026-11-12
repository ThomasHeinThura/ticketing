import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { appendAuditLog } from "../src/audit/audit-writer";
import {
  createAutomation,
  setAutomationEnabled,
} from "../src/automation/repository";
import { validateRuleDefinition } from "../src/automation/validation";
import { createCustomerInvitation } from "../src/customer-invitation/service";
import db, { schema } from "../src/database";
import {
  customFieldSectionTable,
  customFieldTable,
} from "../src/database/migration-schema";
import { automationTable, webhookTable } from "../src/database/schema";
import { cycleTable, moduleTable } from "../src/database/schema-p5-agile";
import {
  dashboardTable,
  dashboardWidgetTable,
  reportExportTable,
} from "../src/database/schema-p5-reports";
import { announcementTable } from "../src/database/schema-p5-service";
import {
  budgetTable,
  timeActivityTable,
  timeEntryTable,
} from "../src/database/schema-p5-time";
import { encryptSecret } from "../src/notification-preferences/secrets";
import { resolveIdentity } from "../src/permissions/resolve-identity";
import { currentCaps, renderExport } from "../src/report/export.service";
import { buildAttachmentStorageKey, putAttachmentObject } from "../src/storage";
import type { Tx } from "./seed-sit-users";
import { G1_AUTOMATIONS, G1_PENDING_CUSTOMER } from "./uat-seed-plan";

const workspaceId = "uat-ws";
const projectId = "uat-proj-web";
const personId = "uat-person-agent2";
export async function seedG1Entities(tx: Tx, now: Date) {
  const [existing] = await tx
    .select({ id: cycleTable.id })
    .from(cycleTable)
    .where(eq(cycleTable.id, "uat-cycle"));
  if (existing) return;
  const date = (offset: number) => new Date(now.getTime() + offset * 86400000);
  const day = (offset: number) => date(offset).toISOString().slice(0, 10);
  await tx.insert(cycleTable).values({
    id: "uat-cycle",
    workspaceId,
    projectId,
    name: "Launch readiness",
    startDate: day(-2),
    endDate: day(12),
    createdBy: "uat-user-manager",
  });
  await tx.insert(moduleTable).values({
    id: "uat-module",
    workspaceId,
    projectId,
    name: "Customer checkout",
    description: "Complete the checkout and validate the launch checklist.",
    leadId: "uat-person-lead",
    state: "in_progress",
    targetDate: day(12),
    createdBy: "uat-user-manager",
  });
  await tx
    .update(schema.workItemTable)
    .set({ cycleId: "uat-cycle", moduleId: "uat-module" })
    .where(eq(schema.workItemTable.id, "uat-wi-web-3"));
  await tx
    .insert(customFieldSectionTable)
    .values({ id: "uat-field-section", workspaceId, name: "Delivery details" });
  await tx.insert(customFieldTable).values({
    id: "uat-custom-field",
    workspaceId,
    sectionId: "uat-field-section",
    key: "release_reference",
    name: "Release reference",
    format: "text",
    helpText: "Reference used in the customer release checklist.",
  });
  const webhookSecret = encryptSecret(randomBytes(32).toString("hex"));
  if (!webhookSecret)
    throw new Error("Configure the instance encryption key before seeding.");
  await tx.insert(webhookTable).values({
    id: "uat-webhook",
    workspaceId,
    name: "Delivery integration (disabled demo)",
    url: "https://hooks.example.test/taskdesk",
    secret: webhookSecret,
    events: ["work_item.created"],
    active: false,
    disabledAt: now,
    disabledReason: "manual",
    createdBy: "uat-person-owner",
  });
  await tx.insert(schema.milestoneTable).values({
    id: "uat-milestone",
    projectId,
    name: "Beta sign-off",
    date: date(7),
  });
  await tx.insert(schema.prerequisiteTable).values({
    id: "uat-prerequisite",
    projectId,
    title: "Customer supplies approved brand assets",
    ownerSide: "customer",
    isBlocking: true,
    dueDate: date(2),
  });
  await tx.insert(schema.stakeholderTable).values({
    id: "uat-stakeholder",
    projectId,
    personId: "uat-person-lead",
    role: "Delivery lead",
    escalationOrder: 1,
  });
  await tx.insert(schema.documentLinkTable).values({
    id: "uat-document-link",
    projectId,
    title: "Database backup reference",
    url: "https://www.postgresql.org/docs/current/backup.html",
    kind: "handover",
    description: "Backup reference for the release checklist.",
    customerVisible: true,
  });
  await tx.insert(schema.savedViewTable).values({
    id: "uat-saved-view",
    workspaceId,
    createdBy: personId,
    name: "Website launch work",
    scope: "project",
    scopeId: projectId,
    visibility: "private",
    query: {
      entity: "work_item",
      filter: { field: "project", op: "eq", value: projectId },
    },
    layout: "list",
  });
  await tx.insert(dashboardTable).values({
    id: "uat-dashboard",
    workspaceId,
    name: "Delivery health",
    scope: "workspace",
  });
  await tx.insert(dashboardWidgetTable).values({
    id: "uat-dashboard-widget",
    dashboardId: "uat-dashboard",
    reportKey: "throughput",
    chartType: "bar",
  });
  await tx.insert(timeActivityTable).values({
    id: "uat-time-activity",
    workspaceId,
    name: "Launch preparation",
  });
  await tx.insert(timeEntryTable).values({
    id: "uat-time-entry",
    workspaceId,
    projectId,
    workItemId: "uat-wi-web-3",
    personId,
    date: day(-1),
    minutes: 90,
    activityId: "uat-time-activity",
    description: "Validated checkout against the acceptance checklist.",
    billable: true,
    rateMinor: 10000,
    currency: "USD",
  });
  await tx.insert(budgetTable).values({
    id: "uat-budget",
    workspaceId,
    projectId,
    name: "Website launch",
    plannedAmountMinor: 500000,
    currency: "USD",
    periodStart: day(-15),
    periodEnd: day(30),
    createdBy: "uat-user-manager",
  });
  await tx.insert(announcementTable).values({
    id: "uat-announcement",
    workspaceId,
    title: "Welcome to the delivery workspace",
    body: "Review the launch checklist and use the portal to raise support requests. Include the affected service and the impact on your work.",
    severity: "info",
    audience: "workspace",
    startsAt: now,
    publishedAt: null,
    createdBy: "uat-user-owner",
  });
  const bytes = Buffer.from(
    "Launch checklist\nConfirm customer sign-off, backup, and rollback owner before release.\n",
  );
  const objectKey = buildAttachmentStorageKey("uat/launch-checklist.txt");

  await tx.insert(schema.attachmentTable).values({
    id: "uat-attachment",
    workspaceId,
    organisationId: "uat-org-fabrikam",
    workItemId: "uat-wi-web-3",
    objectKey,
    filename: "launch-checklist.txt",
    mimeType: "text/plain",
    size: bytes.length,
    state: "ready",
    uploadedBy: personId,
    customerVisible: true,
  });
  // Product writers own their transactions and generate ids; the seed must keep its
  // deterministic ids and single core transaction. Mirror their audit projections here.
  const audits = [
    [cycleTable, "uat-cycle", "cycle", ["name", "startDate", "endDate"], true],
    [
      moduleTable,
      "uat-module",
      "module",
      ["name", "state", "targetDate"],
      true,
    ],
    [
      customFieldSectionTable,
      "uat-field-section",
      "custom_field_section",
      ["name"],
      false,
    ],
    [
      customFieldTable,
      "uat-custom-field",
      "custom_field",
      ["key", "name", "format"],
      false,
    ],
    [timeActivityTable, "uat-time-activity", "time_activity", ["name"], false],
    [
      timeEntryTable,
      "uat-time-entry",
      "time_entry",
      ["personId", "date", "minutes", "billable"],
      true,
    ],
    [
      budgetTable,
      "uat-budget",
      "budget",
      ["name", "plannedAmountMinor", "currency", "periodStart", "periodEnd"],
      true,
    ],
    [dashboardTable, "uat-dashboard", "dashboard", ["name", "scope"], false],
    [
      schema.savedViewTable,
      "uat-saved-view",
      "saved_view",
      ["name", "scope", "scopeId", "visibility", "sharedWithTeamId", "layout"],
      true,
    ],
    [
      schema.documentLinkTable,
      "uat-document-link",
      "document_link",
      ["kind", "customerVisible"],
      true,
    ],
  ] as const;
  for (const [table, id, entityType, fields, scoped] of audits) {
    const [row] = await tx.select().from(table).where(eq(table.id, id));
    if (!row) throw new Error(`Missing seed audit entity ${id}`);
    const after = Object.fromEntries(
      fields.map((key) => [
        key,
        (row as unknown as Record<string, string | number | boolean | null>)[
          key
        ] ?? null,
      ]),
    );
    if (entityType === "time_entry") after.workItemKey = "WEB-3";
    if (entityType === "dashboard") after.widgets = 1;
    await appendAuditLog(tx, {
      actorId:
        entityType === "time_entry" || entityType === "saved_view"
          ? "uat-user-agent2"
          : "uat-user-manager",
      actorType: "person",
      workspaceId,
      projectId: scoped ? projectId : null,
      action: `${entityType}.created`,
      entityType,
      entityId: id,
      before: null,
      after,
    });
  }
  const webhookAfter = {
    name: "Delivery integration (disabled demo)",
    urlHost: "hooks.example.test",
    urlDigest: createHash("sha256")
      .update("https://hooks.example.test/taskdesk")
      .digest("hex")
      .slice(0, 12),
    events: ["work_item.created"],
    active: true,
  };
  await appendAuditLog(tx, {
    actorId: "uat-user-owner",
    actorType: "person",
    workspaceId,
    action: "webhook.created",
    entityType: "webhook",
    entityId: "uat-webhook",
    before: null,
    after: webhookAfter,
  });
  await appendAuditLog(tx, {
    actorId: "uat-user-owner",
    actorType: "person",
    workspaceId,
    action: "webhook.updated",
    entityType: "webhook",
    entityId: "uat-webhook",
    before: { active: true },
    after: { active: false },
  });
  await appendAuditLog(tx, {
    actorId: "uat-user-owner",
    actorType: "person",
    workspaceId,
    action: "announcement.created",
    entityType: "announcement",
    entityId: "uat-announcement",
    before: null,
    after: {
      title: "Welcome to the delivery workspace",
      severity: "info",
      audience: "workspace",
      organisationIds: [],
      projectIds: [],
      startsAt: now.toISOString(),
      endsAt: null,
      publishedAt: null,
      bodyLength:
        "Review the launch checklist and use the portal to raise support requests. Include the affected service and the impact on your work."
          .length,
    },
  });
  const [createdAudit] = await tx
    .select()
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.entityId, "uat-announcement"),
        eq(schema.auditLogTable.action, "announcement.created"),
      ),
    );
  await tx
    .update(announcementTable)
    .set({
      publishedAt: now,
      updatedBy: "uat-user-owner",
      updatedAt: now,
      version: 2,
    })
    .where(eq(announcementTable.id, "uat-announcement"));
  await appendAuditLog(tx, {
    actorId: "uat-user-owner",
    actorType: "person",
    workspaceId,
    action: "announcement.published",
    entityType: "announcement",
    entityId: "uat-announcement",
    before:
      (createdAudit?.after as Record<string, string | number | null>) ?? null,
    after: {
      ...(createdAudit?.after as Record<string, string | number | null>),
      publishedAt: now.toISOString(),
    },
  });
}

export async function seedG1AttachmentObject() {
  // Only write storage after the core transaction commits, so rollback cannot orphan an object.
  await putAttachmentObject(
    buildAttachmentStorageKey("uat/launch-checklist.txt"),
    Buffer.from(
      "Launch checklist\nConfirm customer sign-off, backup, and rollback owner before release.\n",
    ),
    "text/plain",
    1024,
  );
}

export async function seedG1PendingCustomer() {
  const [existing] = await db
    .select({ id: schema.invitationTable.id })
    .from(schema.invitationTable)
    .where(
      and(
        eq(schema.invitationTable.workspaceId, workspaceId),
        eq(schema.invitationTable.email, G1_PENDING_CUSTOMER.email),
      ),
    );
  if (existing) return;
  const identity = await resolveIdentity({
    userId: "uat-user-owner",
    credential: "session",
  });
  if (!identity) throw new Error("Missing demo owner identity");
  await createCustomerInvitation({
    actor: { userId: "uat-user-owner", actorType: "person", apiKeyId: null },
    identity,
    scope: { workspaceId, organisationId: "uat-org-contoso" },
    email: G1_PENDING_CUSTOMER.email,
    projectIds: [...G1_PENDING_CUSTOMER.projectIds],
  });
}

export async function seedG1Automations() {
  const actor = {
    userId: "uat-user-owner",
    personId: "uat-person-owner",
    actorType: "person" as const,
    apiKeyId: null,
  };
  for (const target of G1_AUTOMATIONS) {
    const validated = validateRuleDefinition(target.definition);
    if (!validated.ok) {
      // The existing validator labels the unsupported resolved_at basis "invalid".
      // Preserve that exact target and skip this known product gap; never fall back
      // to updated_at (an internal note would then move the close deadline).

      if (
        validated.problems.some(
          (p) =>
            p.code !== "unavailable" &&
            !(
              p.path === "conditions[1].basis" &&
              "scheduleCron" in target.definition
            ),
        )
      )
        throw new Error(`Invalid seed automation: ${target.name}`);
      console.log(
        `Skipped automation "${target.name}": missing ${target.requires}.`,
      );
      continue;
    }
    const [existing] = await db
      .select()
      .from(automationTable)
      .where(
        and(
          eq(automationTable.workspaceId, workspaceId),
          eq(automationTable.name, target.name),
        ),
      );
    if (existing) {
      if (!existing.enabled)
        throw new Error(`Seed automation is disabled: ${target.name}`);
      continue;
    }
    const [role] = await db
      .select()
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.workspaceId, workspaceId),
          eq(schema.roleTable.key, "owner"),
        ),
      );
    if (!role) throw new Error("Missing automation effective role");
    const row = await createAutomation({
      workspaceId,
      projectId: "uat-proj-support",
      name: target.name,
      effectiveRoleId: role.id,
      stopProcessing: false,
      definition: validated.value,
      actor,
    });
    await setAutomationEnabled(row.id, true, actor, row.version);
  }
}

export async function seedG1Report() {
  const [existing] = await db
    .select({ id: reportExportTable.id })
    .from(reportExportTable)
    .where(eq(reportExportTable.id, "uat-report-export"));
  if (existing) return;
  const identity = await resolveIdentity({
    userId: "uat-user-owner",
    credential: "session",
  });
  if (!identity) throw new Error("Missing demo report owner");
  const now = new Date();
  const spec = {
    kind: "report" as const,
    key: "throughput",
    window: { window: "30" },
    filters: {},
    options: {},
  };
  const caps = await currentCaps(
    workspaceId,
    "uat-user-owner",
    identity,
    undefined,
  );
  if (!caps) throw new Error("Demo owner cannot export reports");
  const rendered = await renderExport({
    spec,
    workspaceId,
    identity,
    caps,
    now,
    exporting: true,
  });
  await db.insert(reportExportTable).values({
    id: "uat-report-export",
    workspaceId,
    personId: "uat-person-owner",
    userId: "uat-user-owner",
    kind: "report",
    reportKey: "throughput",
    title: rendered.title,
    spec,
    caps,
    status: "ready",
    filename: rendered.filename,
    content: rendered.csv,
    byteSize: Buffer.byteLength(rendered.csv),
    ratesIncluded: rendered.ratesIncluded,
    finishedAt: now,
    expiresAt: new Date(now.getTime() + 86400000),
    notifiedAt: null,
  });
}
