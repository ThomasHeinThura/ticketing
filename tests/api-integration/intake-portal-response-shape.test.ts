/** Customer-facing intake responses carry only their declared fields. The create
 * route used to return the stored submission row and the attachment complete route
 * the stored attachment row, including its storage object key. */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { findPortalSubmission } from "../../apps/api/src/intake/repository";
import {
  addCustomer,
  buildTenant,
  grantCustomerOrganisationMembership,
  portalRequest,
} from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

/** A portal customer of a DIFFERENT organisation than the tenant's customers. */
async function addCustomerOfOtherOrganisation() {
  const orgId = `other-cust-org-${randomUUID()}`;
  await db.insert(schema.organisationTable).values({
    id: orgId,
    key: orgId,
    name: "Other customer org",
    isInternal: false,
    portalAccess: true,
  });
  const id = `cust-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({ id, name: id, email: `${id}@example.test` })
      .returning(),
    "other-org user",
  );
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: id,
        organisationId: orgId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    "other-org person",
  );
  await grantCustomerOrganisationMembership(orgId, person.id);
  return { user, person, orgId };
}

async function seed() {
  const t = await buildTenant("response-shape");
  const customer = await addCustomer(t);
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.intake", enabled: true, locked: false })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: t.workspaceId,
    featureKey: "feature.intake",
    enabled: true,
  });
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: t.workspaceId,
        key: `req-${randomUUID()}`,
        name: "Help",
        group: "General",
        workItemTypeId: t.type.id,
        formSchema: { fields: [] },
        published: true,
        customerVisible: true,
      })
      .returning(),
    "request type",
  );
  await db.insert(schema.requestTypeVersionTable).values({
    workspaceId: t.workspaceId,
    requestTypeId: requestType.id,
    number: 1,
    formSchema: { fields: [] },
    workItemTypeId: t.type.id,
  });
  await db.insert(schema.organisationRequestTypeTable).values({
    organisationId: customer.orgId,
    requestTypeId: requestType.id,
  });
  return { t, customer, requestType };
}

describe("customer-facing intake responses expose only declared fields", () => {
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;
  let root = "";
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-portal-shape-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });
  afterEach(async () => {
    if (originalRoot === undefined)
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    if (originalDriver === undefined)
      delete process.env.TASKDESK_STORAGE_DRIVER;
    else process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
    await rm(root, { recursive: true, force: true });
  });

  it("create submission and complete attachment return the declared shapes", async () => {
    const { t, customer, requestType } = await seed();

    const created = await portalRequest(
      t,
      customer,
      "/api/portal/submissions",
      {
        method: "POST",
        body: { key: requestType.key, formData: {} },
      },
    );
    expect(created.status).toBe(200);
    const submission = (await created.json()) as Record<string, unknown>;
    expect(Object.keys(submission).sort()).toEqual([
      "createdAt",
      "id",
      "number",
      "ref",
      "state",
    ]);
    const ref = String(submission.ref);

    const presign = await portalRequest(
      t,
      customer,
      `/api/portal/submissions/${ref}/attachments/presign`,
      {
        method: "POST",
        body: {
          filename: "evidence.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        },
      },
    );
    expect(presign.status).toBe(200);
    const presigned = (await presign.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    // The signed upload URL targets the host that issued it; send that Host header.
    const upload = await t.app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: {
        ...presigned.uploadHeaders,
        host: new URL(presigned.uploadUrl).host,
      },
      body: PNG_BYTES,
    });
    expect(upload.status).toBe(204);

    const complete = await portalRequest(
      t,
      customer,
      `/api/portal/submissions/${ref}/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(complete.status).toBe(200);
    const attachment = (await complete.json()) as Record<string, unknown>;
    expect(Object.keys(attachment).sort()).toEqual([
      "createdAt",
      "customerVisible",
      "deletedAt",
      "filename",
      "id",
      "mimeType",
      "size",
      "state",
      "submissionId",
      "uploadedBy",
      "workItemId",
    ]);
    expect(JSON.stringify(attachment)).not.toContain("workspace/");
  });

  it("preserves persisted JSON values through repository and portal detail output", async () => {
    const { t, customer, requestType } = await seed();
    const created = await portalRequest(
      t,
      customer,
      "/api/portal/submissions",
      {
        method: "POST",
        body: { key: requestType.key, formData: {} },
      },
    );
    expect(created.status).toBe(200);
    const createdSubmission = (await created.json()) as {
      id: string;
      ref: string;
    };

    const cases = [
      {
        name: "object",
        stored: { answer: "yes" },
        raw: { answer: "yes" },
        typed: { answer: "yes" },
      },
      {
        name: "array",
        stored: ["one", 2],
        raw: ["one", 2],
        typed: ["one", 2],
      },
      { name: "number scalar", stored: 7, raw: 7, typed: 7 },
      {
        name: "ordinary string scalar",
        stored: "plain text",
        raw: "plain text",
        typed: "plain text",
      },
      {
        name: "JSON text string scalar",
        stored: '{"answer":"yes"}',
        raw: '{"answer":"yes"}',
        typed: { answer: "yes" },
      },
      { name: "JSON null", stored: null, raw: null, typed: null },
    ];

    for (const value of cases) {
      if (value.stored === null) {
        await db
          .update(schema.submissionTable)
          .set({ formData: sql`'null'::jsonb` })
          .where(eq(schema.submissionTable.id, createdSubmission.id));
      } else {
        await db
          .update(schema.submissionTable)
          .set({ formData: value.stored })
          .where(eq(schema.submissionTable.id, createdSubmission.id));
      }

      const raw = await db.execute(sql`
        select ${schema.submissionTable.formData} as form_data
        from ${schema.submissionTable}
        where ${schema.submissionTable.id} = ${createdSubmission.id}
      `);
      expect(raw.rows, `${value.name}: raw row`).toHaveLength(1);
      expect(raw.rows[0]?.form_data, `${value.name}: raw JSON value`).toEqual(
        value.raw,
      );

      const [typed] = await db
        .select({ formData: schema.submissionTable.formData })
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.id, createdSubmission.id));
      expect(typed?.formData, `${value.name}: typed JSON value`).toEqual(
        value.typed,
      );

      const detail = await findPortalSubmission(
        createdSubmission.ref,
        customer.person.id,
      );
      expect(
        detail.submission.formData,
        `${value.name}: repository value`,
      ).toEqual(value.typed);

      const response = await portalRequest(
        t,
        customer,
        `/api/portal/submissions/${createdSubmission.ref}`,
      );
      expect(response.status, `${value.name}: HTTP status`).toBe(200);
      const body = (await response.json()) as {
        ref: string;
        submission: {
          state: string;
          formData: unknown;
          customerVisibility: string;
          createdAt: string;
        };
        canWithdraw: boolean;
        requestType: unknown;
        version: unknown;
        workItem: unknown;
        messages: unknown[];
      };
      expect(Object.keys(body).sort()).toEqual([
        "canEscalate",
        "canRate",
        "canReopen",
        "canUpload",
        "canViewAttachments",
        "canWithdraw",
        "customerStatus",
        "isRequester",
        "messages",
        "ref",
        "requestType",
        "satisfaction",
        "submission",
        "version",
        "workItem",
      ]);
      expect(Object.keys(body.submission).sort()).toEqual([
        "createdAt",
        "customerVisibility",
        "formData",
        "state",
      ]);
      expect(body.ref).toBe(createdSubmission.ref);
      expect(
        body.submission.formData,
        `${value.name}: HTTP JSON value`,
      ).toEqual(value.typed);
    }
  });

  it("SLA-21: shows the owner only state and due time; nothing from the policy or pauses", async () => {
    const { t, customer, requestType } = await seed();
    // CP-16: a colleague of the SAME organisation may read an organisation-visible request;
    // a customer of ANOTHER organisation never can.
    const colleague = await addCustomer(t);
    const other = await addCustomerOfOtherOrganisation();
    const created = await portalRequest(
      t,
      customer,
      "/api/portal/submissions",
      {
        method: "POST",
        body: {
          key: requestType.key,
          formData: {},
          customerVisibility: "organisation",
        },
      },
    );
    expect(created.status).toBe(200);
    const { id: submissionId, ref } = (await created.json()) as {
      id: string;
      ref: string;
    };
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const calendar = requireRow(
      await db
        .insert(schema.serviceCalendarTable)
        .values({
          workspaceId: t.workspaceId,
          name: "INTERNAL-CALENDAR-NAME",
          timezone: "UTC",
          windows: Object.fromEntries(
            ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
              day,
              [{ from: 0, to: 1440 }],
            ]),
          ),
          holidays: [],
        })
        .returning(),
      "calendar",
    );
    const policy = requireRow(
      await db
        .insert(schema.slaPolicyTable)
        .values({ workspaceId: t.workspaceId, name: "INTERNAL-POLICY-NAME" })
        .returning(),
      "policy",
    );
    const version = requireRow(
      await db
        .insert(schema.slaPolicyVersionTable)
        .values({
          workspaceId: t.workspaceId,
          policyId: policy.id,
          calendarId: calendar.id,
          number: 1,
          atRiskThresholdPct: 75,
        })
        .returning(),
      "version",
    );
    await db.insert(schema.slaGoalTable).values(
      (["first_response", "resolution"] as const).flatMap((metric) =>
        (["low", "medium", "high", "urgent"] as const).map((priority) => ({
          workspaceId: t.workspaceId,
          versionId: version.id,
          metric,
          priority,
          workItemTypeId: t.type.id,
          targetMinutes: 100,
        })),
      ),
    );
    await db
      .update(schema.slaPolicyVersionTable)
      .set({ effectiveFrom: ago(24 * 60) })
      .where(eq(schema.slaPolicyVersionTable.id, version.id));
    await db
      .update(schema.workItemTable)
      .set({
        requesterId: customer.person.id,
        customerVisibility: "organisation",
        priority: "high",
        slaPolicyVersionId: version.id,
        slaStartedAt: ago(85),
      })
      .where(eq(schema.workItemTable.id, t.workItem.id));
    await db
      .update(schema.submissionTable)
      .set({ workItemId: t.workItem.id })
      .where(eq(schema.submissionTable.id, submissionId));

    const response = await portalRequest(
      t,
      customer,
      `/api/portal/submissions/${ref}`,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as {
      workItem: { sla: { state: string; dueAt: string | null } | null };
    };
    expect(body.workItem.sla).not.toBeNull();
    expect(Object.keys(body.workItem.sla ?? {}).sort()).toEqual([
      "dueAt",
      "metric",
      "state",
    ]);
    // No staff response yet: the customer is shown the first-response target.
    expect((body.workItem.sla as { metric?: string } | null)?.metric).toBe(
      "first_response",
    );
    expect(body.workItem.sla?.state).toBe("at_risk");
    expect(Number.isNaN(Date.parse(body.workItem.sla?.dueAt ?? ""))).toBe(
      false,
    );
    for (const internal of [
      "targetMinutes",
      "consumedMinutes",
      "consumedPct",
      "remainingMinutes",
      "atRiskThresholdPct",
      "calendar",
      "INTERNAL-CALENDAR-NAME",
      "INTERNAL-POLICY-NAME",
      "slaPolicy",
      "pause",
    ])
      expect(text, internal).not.toContain(internal);

    // A same-organisation colleague sees the same SLA-only shape, never the internals.
    const colleagueResponse = await portalRequest(
      t,
      colleague,
      `/api/portal/submissions/${ref}`,
    );
    expect(colleagueResponse.status).toBe(200);
    const colleagueText = await colleagueResponse.text();
    const colleagueBody = JSON.parse(colleagueText) as {
      workItem: { sla: { state: string; dueAt: string | null } | null };
    };
    expect(Object.keys(colleagueBody.workItem.sla ?? {}).sort()).toEqual([
      "dueAt",
      "metric",
      "state",
    ]);
    // CP-16: attachments are requester-only, so the colleague's flags hide them; CP-5: the
    // internal workflow state name is never part of the projection.
    expect(colleagueBody).toMatchObject({
      canViewAttachments: false,
      canUpload: false,
    });
    expect(colleagueBody.workItem).not.toHaveProperty("state");
    for (const internal of [
      "targetMinutes",
      "consumedMinutes",
      "atRiskThresholdPct",
      "INTERNAL-CALENDAR-NAME",
      "INTERNAL-POLICY-NAME",
      "slaPolicy",
      "pause",
    ])
      expect(colleagueText, internal).not.toContain(internal);

    // A customer of another organisation cannot read the page or see its SLA.
    const foreign = await portalRequest(
      t,
      other,
      `/api/portal/submissions/${ref}`,
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain("at_risk");

    // Once the request is private, even the same-organisation colleague gets the 404.
    await db
      .update(schema.submissionTable)
      .set({ customerVisibility: "private" })
      .where(eq(schema.submissionTable.id, submissionId));
    const hidden = await portalRequest(
      t,
      colleague,
      `/api/portal/submissions/${ref}`,
    );
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).not.toContain("at_risk");
  });
});
