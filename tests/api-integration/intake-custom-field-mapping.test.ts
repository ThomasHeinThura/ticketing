import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { portalAuth, portalForHost } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import type { BaseVariables } from "../../apps/api/src/openapi";
import requestPortal from "../../apps/api/src/request-type/portal";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const NOT_A_PNG = Buffer.from("not a png");
const originalStorageRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
const originalStorageDriver = process.env.TASKDESK_STORAGE_DRIVER;
let storageRoot: string;

async function setupAcceptanceFixture(
  options: {
    deleteMappedField?: boolean;
    autoAccept?: boolean;
    withFile?: boolean;
  } = {},
) {
  const { user, workspace } = await createWorkspaceMember({ role: "admin" });
  const organisation = requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `customer-${randomUUID()}`,
        name: "Intake Customer",
        portalAccess: true,
      })
      .returning(),
    "intake fixture organisation",
  );
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await db
    .update(schema.projectTable)
    .set({ organisationId: organisation.id })
    .where(eq(schema.projectTable.id, project.id));

  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: workspace.id,
        key: `type-${randomUUID()}`,
        name: "Request",
        category: "delivery",
      })
      .returning(),
    "intake fixture work item type",
  );
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: workspace.id,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "intake fixture state template",
  );
  await db.insert(schema.stateTable).values({
    projectId: project.id,
    stateTemplateId: stateTemplate.id,
    isDefault: true,
  });

  const section = requireRow(
    await db
      .insert(schema.customFieldSectionTable)
      .values({ workspaceId: workspace.id, name: "Request details" })
      .returning(),
    "intake fixture custom field section",
  );
  const mappedField = requireRow(
    await db
      .insert(schema.customFieldTable)
      .values({
        workspaceId: workspace.id,
        sectionId: section.id,
        key: `asset-${randomUUID()}`,
        name: "Asset reference",
        format: "text",
        customerVisible: true,
      })
      .returning(),
    "intake fixture mapped custom field",
  );
  const defaultField = requireRow(
    await db
      .insert(schema.customFieldTable)
      .values({
        workspaceId: workspace.id,
        sectionId: section.id,
        key: `region-${randomUUID()}`,
        name: "Default region",
        format: "text",
        defaultValue: "north",
      })
      .returning(),
    "intake fixture default custom field",
  );
  await db.insert(schema.customFieldTypeVisibilityTable).values([
    {
      customFieldId: mappedField.id,
      workItemTypeId: type.id,
      visible: true,
      required: true,
    },
    {
      customFieldId: defaultField.id,
      workItemTypeId: type.id,
      visible: true,
      required: false,
    },
  ]);

  const formSchema = {
    fields: [
      {
        key: "title",
        type: "text",
        label: "Summary",
        required: true,
        mapsTo: { field: "title" },
      },
      {
        key: "asset",
        type: "text",
        label: "Asset reference",
        required: true,
        mapsTo: { field: `cf.${mappedField.key}` },
      },
      ...(options.withFile
        ? [
            {
              key: "files",
              type: "file",
              label: "Supporting files",
              required: true,
              multiple: true,
            },
          ]
        : []),
    ],
  };
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: workspace.id,
        key: `request-${randomUUID()}`,
        name: "Hardware request",
        group: "Support",
        workItemTypeId: type.id,
        defaultProjectId: project.id,
        formSchema,
        published: true,
        customerVisible: true,
        autoAccept: options.autoAccept ?? false,
      })
      .returning(),
    "intake fixture request type",
  );
  const version = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: workspace.id,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: requestType.formSchema,
        workItemTypeId: type.id,
        defaultProjectId: project.id,
        autoAccept: options.autoAccept ?? false,
      })
      .returning(),
    "intake fixture request type version",
  );

  const requester = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: organisation.id,
        side: "customer",
        displayName: "Requester",
      })
      .returning(),
    "intake fixture requester",
  );
  const submission = requireRow(
    await db
      .insert(schema.submissionTable)
      .values({
        organisationId: organisation.id,
        requesterId: requester.id,
        requestTypeId: requestType.id,
        requestTypeVersionId: version.id,
        formData: { title: "Replace the laptop", asset: "LT-27" },
        submittedAt: new Date(),
        customerVisibility: "organisation",
      })
      .returning(),
    "intake fixture submission",
  );
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: workspace.id,
    featureKey: "feature.intake",
    enabled: true,
    version: 1,
  });
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: workspace.id,
    featureKey: "feature.customer_portal",
    enabled: true,
    version: 1,
  });
  await db
    .insert(schema.organisationRequestTypeTable)
    .values({ organisationId: organisation.id, requestTypeId: requestType.id });
  if (options.deleteMappedField) {
    await db
      .update(schema.customFieldTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.customFieldTable.id, mappedField.id));
  }
  return {
    user,
    workspace,
    organisation,
    project,
    type,
    submission,
    mappedField,
    defaultField,
    requester,
    requestType,
    version,
  };
}

async function authenticatePortalRequester(
  fixture: Awaited<ReturnType<typeof setupAcceptanceFixture>>,
) {
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: `portal-${randomUUID()}`,
        email: `portal-${randomUUID()}@example.com`,
        emailVerified: true,
        name: "Portal Requester",
      })
      .returning(),
    "intake portal user",
  );
  await db
    .update(schema.personTable)
    .set({ userId: user.id })
    .where(eq(schema.personTable.id, fixture.requester.id));
  mockAuthenticatedSession(user, { portal: "customer" });
  return user;
}

async function createSubmissionAttachment(
  fixture: Awaited<ReturnType<typeof setupAcceptanceFixture>>,
  options: {
    customerVisible?: boolean;
    state?: string;
    deleted?: boolean;
  } = {},
) {
  return requireRow(
    await db
      .insert(schema.attachmentTable)
      .values({
        workspaceId: fixture.workspace.id,
        organisationId: fixture.organisation.id,
        submissionId: fixture.submission.id,
        submissionFieldKey: "files",
        objectKey: `submission-test/${randomUUID()}`,
        filename: "supporting-document.txt",
        mimeType: "text/plain",
        size: 12,
        state: options.state ?? "ready",
        customerVisible: options.customerVisible ?? true,
        uploadedBy: fixture.requester.id,
        deletedAt: options.deleted ? new Date() : null,
      })
      .returning(),
    "submission attachment",
  );
}

// CP-19 intentionally keeps the public customer-origin `/api` edge closed until
// P3 identity acceptance. Exercise this production router directly with the
// production host-to-auth realm selection so its transaction handlers remain
// covered without claiming the public edge is enabled. Route-policy coverage
// separately checks the declared portal predicates for these registered routes.
function createPortalRouterHarness() {
  const app = new Hono<{ Variables: BaseVariables }>();
  app.use("*", async (c, next) => {
    if (portalForHost(c.req.header("Host")) !== "customer") {
      return c.json({ message: "Not Found" }, 404);
    }
    const result = await portalAuth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!result?.session) return c.json({ message: "Not Found" }, 404);
    c.set("userId", result.user.id);
    c.set("userEmail", result.user.email);
    c.set("user", result.user);
    c.set("session", result.session);
    await next();
  });
  app.route("/api", requestPortal as unknown as Hono);
  return app;
}

describe("API integration: request-type custom-field conversion (RT-3, IQ-8, CF-5/6/11)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    storageRoot = await mkdtemp(path.join(tmpdir(), "taskdesk-intake-upload-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = storageRoot;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    if (originalStorageRoot === undefined) {
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    } else {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalStorageRoot;
    }
    if (originalStorageDriver === undefined) {
      delete process.env.TASKDESK_STORAGE_DRIVER;
    } else {
      process.env.TASKDESK_STORAGE_DRIVER = originalStorageDriver;
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("projects queue/detail summaries and only suggests recent work in serving projects", async () => {
    const fixture = await setupAcceptanceFixture();
    const requesterAccount = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `customer-${randomUUID()}`,
          email: `requester-${randomUUID()}@example.com`,
          emailVerified: true,
          name: "Requester account",
        })
        .returning(),
      "intake customer account",
    );
    await db
      .update(schema.personTable)
      .set({
        displayName: requesterAccount.email,
        userId: requesterAccount.id,
      })
      .where(eq(schema.personTable.id, fixture.requester.id));
    const arrival = new Date("2026-09-30T12:00:00.000Z");
    const pinnedSchema = {
      fields: [
        {
          key: "request_summary",
          type: "text",
          label: "Summary",
          required: true,
          mapsTo: { field: "title" },
        },
        {
          key: "asset",
          type: "text",
          label: "Asset reference",
          required: true,
          mapsTo: { field: `cf.${fixture.mappedField.key}` },
        },
      ],
    };
    await db
      .update(schema.requestTypeVersionTable)
      .set({ formSchema: pinnedSchema })
      .where(
        eq(
          schema.requestTypeVersionTable.requestTypeId,
          fixture.requestType.id,
        ),
      );
    await db
      .update(schema.submissionTable)
      .set({
        formData: {
          request_summary: "Replace the laptop",
          asset: "LT-27",
        },
        submittedAt: arrival,
      })
      .where(eq(schema.submissionTable.id, fixture.submission.id));

    const [state] = await db
      .select({
        id: schema.stateTable.id,
        stateTemplateId: schema.stateTable.stateTemplateId,
      })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, fixture.project.id))
      .limit(1);
    if (!state) throw new Error("intake test project state is missing");

    async function addCandidate(
      project: typeof fixture.project,
      workspaceId: string,
      typeId: string,
      itemTitle: string,
      number: number,
      stateId: string,
    ) {
      await db.insert(schema.workItemTable).values({
        projectId: project.id,
        workspaceId,
        typeId,
        stateId,
        number,
        key: `${project.slug}-${number}`,
        title: itemTitle,
      });
    }

    await addCandidate(
      fixture.project,
      fixture.workspace.id,
      fixture.type.id,
      "Replace the laptop",
      1,
      state.id,
    );

    const otherOrganisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `other-customer-${randomUUID()}`,
          name: "Other customer",
          portalAccess: true,
        })
        .returning(),
      "other intake organisation",
    );
    const { project: otherProject } = await createProjectFixture({
      workspaceId: fixture.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: otherOrganisation.id })
      .where(eq(schema.projectTable.id, otherProject.id));
    const otherState = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: otherProject.id,
          stateTemplateId: state.stateTemplateId,
          isDefault: true,
        })
        .returning(),
      "other intake project state",
    );
    await addCandidate(
      otherProject,
      fixture.workspace.id,
      fixture.type.id,
      "Replace the laptop",
      1,
      otherState.id,
    );

    const otherWorkspace = await createWorkspaceMember({ role: "admin" });
    const { project: foreignWorkspaceProject } = await createProjectFixture({
      workspaceId: otherWorkspace.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: fixture.organisation.id })
      .where(eq(schema.projectTable.id, foreignWorkspaceProject.id));
    const foreignType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: otherWorkspace.workspace.id,
          key: `foreign-type-${randomUUID()}`,
          name: "Request",
          category: "delivery",
        })
        .returning(),
      "foreign workspace work item type",
    );
    const foreignStateTemplate = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: otherWorkspace.workspace.id,
          key: `foreign-state-${randomUUID()}`,
          name: "Backlog",
          group: "backlog",
        })
        .returning(),
      "foreign workspace state template",
    );
    const foreignState = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: foreignWorkspaceProject.id,
          stateTemplateId: foreignStateTemplate.id,
          isDefault: true,
        })
        .returning(),
      "foreign workspace project state",
    );
    await addCandidate(
      foreignWorkspaceProject,
      otherWorkspace.workspace.id,
      foreignType.id,
      "Replace the laptop",
      1,
      foreignState.id,
    );

    mockAuthenticatedSession(fixture.user);
    const { app } = createApp();
    const queueResponse = await app.request(
      `/api/submissions?workspaceId=${fixture.workspace.id}`,
    );
    expect(queueResponse.status).toBe(200);
    const queue = (await queueResponse.json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      customerName: "Requester account",
      organisationName: "Intake Customer",
      summary: "Replace the laptop",
      submittedAt: arrival.toISOString(),
      suggestedDuplicates: [
        expect.objectContaining({ title: "Replace the laptop" }),
      ],
    });
    expect(JSON.stringify(queue.items[0])).not.toContain("@example.com");
    const suggestions = queue.items[0]?.suggestedDuplicates as Array<{
      key: string;
    }>;
    expect(suggestions.map((item) => item.key)).not.toContain(
      `${otherProject.slug}-1`,
    );
    expect(suggestions.map((item) => item.key)).not.toContain(
      `${foreignWorkspaceProject.slug}-1`,
    );

    const detailResponse = await app.request(
      `/api/submissions/SUB-${fixture.submission.number}`,
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as Record<string, unknown>;
    expect(detail).toMatchObject({
      customerName: "Requester account",
      organisationName: "Intake Customer",
      summary: "Replace the laptop",
      submittedAt: arrival.toISOString(),
      suggestedDuplicates: [
        expect.objectContaining({ title: "Replace the laptop" }),
      ],
    });

    const dedicatedResponse = await app.request(
      `/api/submissions/SUB-${fixture.submission.number}/duplicates`,
    );
    expect(dedicatedResponse.status).toBe(200);
    expect(await dedicatedResponse.json()).toMatchObject({
      items: [expect.objectContaining({ title: "Replace the laptop" })],
    });
  });

  it("returns safe ready attachment metadata and audits exact staff downloads", async () => {
    const fixture = await setupAcceptanceFixture();
    const ready = await createSubmissionAttachment(fixture);
    await createSubmissionAttachment(fixture, { state: "pending" });
    await createSubmissionAttachment(fixture, {
      state: "deleted",
      deleted: true,
    });
    mockAuthenticatedSession(fixture.user);
    const { app } = createApp();

    const detail = await app.request(
      `/api/submissions/SUB-${fixture.submission.number}`,
    );
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      attachments: Array<Record<string, unknown>>;
    };
    expect(body.attachments).toEqual([
      expect.objectContaining({
        id: ready.id,
        fieldKey: "files",
        filename: "supporting-document.txt",
        mimeType: "text/plain",
        size: 12,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("objectKey");

    const download = await app.request(
      `/api/submissions/SUB-${fixture.submission.number}/attachments/${ready.id}`,
    );
    expect(download.status).toBe(302);
    expect(download.headers.get("location")).toContain(
      "/storage/filesystem-download?",
    );
    const audit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, ready.id));
    expect(audit.map((row) => row.action)).toEqual(["attachment.downloaded"]);

    for (const attachmentId of [
      (await createSubmissionAttachment(fixture, { state: "pending" })).id,
      (await createSubmissionAttachment(fixture, { deleted: true })).id,
      `missing-${randomUUID()}`,
    ]) {
      const rejected = await app.request(
        `/api/submissions/SUB-${fixture.submission.number}/attachments/${attachmentId}`,
      );
      expect(rejected.status).toBe(404);
    }
    const wrongSubmission = await app.request(
      `/api/submissions/SUB-999999/attachments/${ready.id}`,
    );
    expect(wrongSubmission.status).toBe(404);
  });

  it("shows and downloads only customer-visible attachments for an own submission", async () => {
    const fixture = await setupAcceptanceFixture();
    const visible = await createSubmissionAttachment(fixture, {
      customerVisible: true,
    });
    const internal = await createSubmissionAttachment(fixture, {
      customerVisible: false,
    });
    await authenticatePortalRequester(fixture);
    const app = createPortalRouterHarness();
    const headers = {
      host: "portal.localhost:5174",
      origin: "http://portal.localhost:5174",
    };

    const detail = await app.request(
      `/api/portal/submissions/SUB-${fixture.submission.number}`,
      { headers },
    );
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      attachments: Array<{ id: string; filename: string }>;
    };
    expect(body.attachments).toEqual([
      {
        id: visible.id,
        fieldKey: "files",
        filename: visible.filename,
        mimeType: visible.mimeType,
        size: visible.size,
        uploadedBy: visible.uploadedBy,
        createdAt: visible.createdAt.toISOString(),
      },
    ]);

    const download = await app.request(
      `/api/portal/submissions/SUB-${fixture.submission.number}/attachments/${visible.id}`,
      { headers },
    );
    expect(download.status).toBe(302);
    expect(download.headers.get("location")).toContain(
      "/storage/filesystem-download?",
    );
    const privateDownload = await app.request(
      `/api/portal/submissions/SUB-${fixture.submission.number}/attachments/${internal.id}`,
      { headers },
    );
    expect(privateDownload.status).toBe(404);
  });

  it("denies staff without intake triage capability before returning submission attachments", async () => {
    const fixture = await setupAcceptanceFixture();
    await createSubmissionAttachment(fixture);
    mockAuthenticatedSession(fixture.user);
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "unassigned-test-role" })
      .where(eq(schema.workspaceUserTable.userId, fixture.user.id));
    const { app } = createApp();

    const response = await app.request(
      `/api/submissions/SUB-${fixture.submission.number}`,
    );
    expect(response.status).toBe(403);
  });

  it("writes mapped values and one-time defaults atomically with the accepted work item", async () => {
    const fixture = await setupAcceptanceFixture();
    mockAuthenticatedSession(fixture.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/submissions/SUB-${fixture.submission.number}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: fixture.project.id,
          typeId: fixture.type.id,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "accepted",
      workItemKey: expect.any(String),
    });

    const [accepted] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, fixture.submission.id));
    expect(accepted?.state).toBe("accepted");
    expect(accepted?.formData).toEqual({
      title: "Replace the laptop",
      asset: "LT-27",
    });
    const values = await db
      .select({
        fieldId: schema.customFieldValueTable.customFieldId,
        value: schema.customFieldValueTable.value,
        entityId: schema.customFieldValueTable.entityId,
        organisationId: schema.customFieldValueTable.organisationId,
      })
      .from(schema.customFieldValueTable)
      .where(
        and(
          eq(schema.customFieldValueTable.projectId, fixture.project.id),
          eq(schema.customFieldValueTable.entityType, "work_item"),
        ),
      );
    expect(values).toEqual(
      expect.arrayContaining([
        {
          fieldId: fixture.mappedField.id,
          value: "LT-27",
          entityId: accepted?.workItemId,
          organisationId: fixture.organisation.id,
        },
        {
          fieldId: fixture.defaultField.id,
          value: "north",
          entityId: accepted?.workItemId,
          organisationId: fixture.organisation.id,
        },
      ]),
    );
    expect(values).toHaveLength(2);
    const acceptedEvents = await db
      .select({
        kind: schema.outboxTable.kind,
        payload: schema.outboxTable.payload,
      })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "submission.accepted"));
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0]?.payload).toMatchObject({
      kind: "submission.accepted",
      payload: {
        ref: `SUB-${fixture.submission.number}`,
        workItemKey: expect.any(String),
      },
      scope: {
        workspaceId: fixture.workspace.id,
        organisationId: fixture.organisation.id,
      },
    });
  });

  it("accepts a staged file with the pinned assignee, default state, privacy and SLA arrival", async () => {
    const fixture = await setupAcceptanceFixture({ withFile: true });
    const staffPerson = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, fixture.user.id))
        .limit(1),
      "intake fixture staff person",
    );
    const projectRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "project",
          key: `intake-project-role-${randomUUID()}`,
          name: "Intake assignee",
          rank: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "intake fixture project role",
    );
    await db.insert(schema.membershipTable).values({
      personId: staffPerson.id,
      scope: "project",
      scopeId: fixture.project.id,
      roleId: projectRole.id,
    });
    await db
      .update(schema.requestTypeTable)
      .set({ defaultAssigneeId: staffPerson.id, forcePrivate: true })
      .where(eq(schema.requestTypeTable.id, fixture.requestType.id));
    await db
      .update(schema.requestTypeVersionTable)
      .set({ defaultAssigneeId: staffPerson.id })
      .where(eq(schema.requestTypeVersionTable.id, fixture.version.id));
    const attachment = await createSubmissionAttachment(fixture);
    mockAuthenticatedSession(fixture.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/submissions/SUB-${fixture.submission.number}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: fixture.project.id,
          typeId: fixture.type.id,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "accepted",
      workItemKey: expect.any(String),
    });

    const [accepted] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, fixture.submission.id));
    const [workItem] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, accepted!.workItemId!));
    expect(workItem).toMatchObject({
      assigneeId: staffPerson.id,
      customerVisibility: "private",
    });
    expect(workItem?.slaStartedAt?.getTime()).toBe(
      fixture.submission.submittedAt?.getTime(),
    );
    const [state] = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.id, workItem!.stateId));
    expect(state).toMatchObject({
      projectId: fixture.project.id,
      isDefault: true,
    });
    const [transferred] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, attachment.id));
    expect(transferred).toMatchObject({
      state: "ready",
      submissionId: null,
      submissionFieldKey: "files",
      workItemId: workItem?.id,
      customerVisible: true,
    });
  });

  it("refuses a deleted pinned mapping without creating a work item or custom value", async () => {
    const fixture = await setupAcceptanceFixture({ deleteMappedField: true });
    mockAuthenticatedSession(fixture.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/submissions/SUB-${fixture.submission.number}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: fixture.project.id,
          typeId: fixture.type.id,
        }),
      },
    );
    expect(response.status).toBe(409);
    const [submission] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, fixture.submission.id));
    expect(submission?.state).toBe("new");
    const acceptedEvents = await db
      .select({ eventId: schema.outboxTable.eventId })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "submission.accepted"));
    expect(acceptedEvents).toHaveLength(0);
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
    expect(await db.select().from(schema.customFieldValueTable)).toHaveLength(
      0,
    );
  });

  it("finalizes auto-accept from the pinned version in one transaction and starts SLA at submission time", async () => {
    const fixture = await setupAcceptanceFixture({ autoAccept: true });
    await authenticatePortalRequester(fixture);
    const app = createPortalRouterHarness();
    const headers = {
      host: "portal.localhost:5174",
      origin: "http://portal.localhost:5174",
      "content-type": "application/json",
    };
    const draftResponse = await app.request("/api/portal/submissions/drafts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestTypeKey: fixture.requestType.key,
        formData: { title: "Replace the laptop", asset: "LT-27" },
      }),
    });
    expect(draftResponse.status).toBe(200);
    const draft = (await draftResponse.json()) as {
      ref: string;
      state: string;
    };
    expect(draft.state).toBe("draft");
    const finalizeResponse = await app.request(
      `/api/portal/submissions/${draft.ref}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          formData: { title: "Replace the laptop", asset: "LT-27" },
        }),
      },
    );
    expect(finalizeResponse.status).toBe(200);
    expect(await finalizeResponse.json()).toMatchObject({
      state: "accepted",
      workItemKey: expect.any(String),
    });
    const [submission] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, Number(draft.ref.slice(4))));
    expect(submission?.state).toBe("accepted");
    expect(submission?.formData).not.toHaveProperty("files");
    expect(submission?.submittedAt).toBeInstanceOf(Date);
    const [workItem] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, submission!.workItemId!));
    expect(workItem?.slaStartedAt?.getTime()).toBe(
      submission?.submittedAt?.getTime(),
    );
    const events = await db
      .select({ kind: schema.outboxTable.kind })
      .from(schema.outboxTable)
      .where(
        inArray(schema.outboxTable.kind, [
          "submission.received",
          "submission.accepted",
        ]),
      );
    expect(events.map((event) => event.kind).sort()).toEqual([
      "submission.accepted",
      "submission.received",
    ]);
  });

  it("keeps failed auto-accept mapping retryable and emits no submitted/accepted event", async () => {
    const fixture = await setupAcceptanceFixture({
      autoAccept: true,
      deleteMappedField: true,
    });
    await authenticatePortalRequester(fixture);
    const app = createPortalRouterHarness();
    const headers = {
      host: "portal.localhost:5174",
      origin: "http://portal.localhost:5174",
      "content-type": "application/json",
    };
    const draftResponse = await app.request("/api/portal/submissions/drafts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestTypeKey: fixture.requestType.key,
        formData: { title: "Replace the laptop", asset: "LT-27" },
      }),
    });
    const draft = (await draftResponse.json()) as { ref: string };
    const response = await app.request(
      `/api/portal/submissions/${draft.ref}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          formData: { title: "Replace the laptop", asset: "LT-27" },
        }),
      },
    );
    expect(response.status).toBe(409);
    const [submission] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, Number(draft.ref.slice(4))));
    expect(submission?.state).toBe("draft");
    expect(submission?.submittedAt).toBeNull();
    expect(await db.select().from(schema.outboxTable)).toHaveLength(0);
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
  });

  it("does not submit or auto-accept a file-backed draft without a completed owned upload", async () => {
    const fixture = await setupAcceptanceFixture({
      autoAccept: true,
      withFile: true,
    });
    await authenticatePortalRequester(fixture);
    const app = createPortalRouterHarness();
    const headers = {
      host: "portal.localhost:5174",
      origin: "http://portal.localhost:5174",
      "content-type": "application/json",
    };
    const draftResponse = await app.request("/api/portal/submissions/drafts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestTypeKey: fixture.requestType.key,
        formData: { title: "Replace the laptop", asset: "LT-27" },
      }),
    });
    expect(draftResponse.status).toBe(200);
    const draft = (await draftResponse.json()) as { ref: string };
    const response = await app.request(
      `/api/portal/submissions/${draft.ref}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          formData: { title: "Replace the laptop", asset: "LT-27" },
        }),
      },
    );
    expect(response.status).toBe(400);
    const [submission] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, Number(draft.ref.slice(4))));
    expect(submission?.state).toBe("draft");
    expect(submission?.submittedAt).toBeNull();
    expect(await db.select().from(schema.outboxTable)).toHaveLength(0);
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
  });

  it("transfers a completed owner upload atomically on auto-accept and rejects another requester", async () => {
    const fixture = await setupAcceptanceFixture({
      autoAccept: true,
      withFile: true,
    });
    const requesterUser = await authenticatePortalRequester(fixture);
    const portalApp = createPortalRouterHarness();
    const headers = {
      host: "portal.localhost:5174",
      origin: "http://portal.localhost:5174",
      "content-type": "application/json",
    };
    const draftResponse = await portalApp.request(
      "/api/portal/submissions/drafts",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestTypeKey: fixture.requestType.key,
          formData: { title: "Replace the laptop", asset: "LT-27" },
        }),
      },
    );
    expect(draftResponse.status).toBe(200);
    const draft = (await draftResponse.json()) as { ref: string };

    for (const fieldKey of ["missing-file-field", "title"]) {
      const invalidPresign = await portalApp.request(
        `/api/portal/submissions/${draft.ref}/attachments/presign`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            fieldKey,
            filename: "evidence.png",
            contentType: "image/png",
            size: PNG_BYTES.length,
          }),
        },
      );
      expect(invalidPresign.status).toBe(400);
    }

    const presignResponse = await portalApp.request(
      `/api/portal/submissions/${draft.ref}/attachments/presign`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          fieldKey: "files",
          filename: "evidence.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    expect(presignResponse.status).toBe(200);
    const upload = (await presignResponse.json()) as {
      attachmentId: string;
      fieldKey: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    expect(upload.fieldKey).toBe("files");
    expect(new URL(upload.uploadUrl).origin).toBe(
      process.env.TASKDESK_AGENT_URL,
    );

    const secondDraftResponse = await portalApp.request(
      "/api/portal/submissions/drafts",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestTypeKey: fixture.requestType.key,
          formData: { title: "Replace the laptop", asset: "LT-27" },
        }),
      },
    );
    const secondDraft = (await secondDraftResponse.json()) as { ref: string };
    const crossSubmissionComplete = await portalApp.request(
      `/api/portal/submissions/${secondDraft.ref}/attachments/${upload.attachmentId}/complete`,
      { method: "POST", headers },
    );
    expect(crossSubmissionComplete.status).toBe(404);
    const notReadyFinalize = await portalApp.request(
      `/api/portal/submissions/${draft.ref}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          formData: {
            title: "Replace the laptop",
            asset: "LT-27",
            files: [upload.attachmentId],
          },
        }),
      },
    );
    expect(notReadyFinalize.status).toBe(400);

    const { app: agentApp } = createApp();
    const putResponse = await agentApp.request(upload.uploadUrl, {
      method: "PUT",
      headers: upload.uploadHeaders,
      body: PNG_BYTES,
    });
    expect(putResponse.status).toBe(204);

    const otherUser = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `portal-${randomUUID()}`,
          email: `portal-${randomUUID()}@example.com`,
          emailVerified: true,
          name: "Different requester",
        })
        .returning(),
      "another intake requester user",
    );
    await db.insert(schema.personTable).values({
      organisationId: fixture.organisation.id,
      side: "customer",
      active: true,
      userId: otherUser.id,
      displayName: "Different requester",
    });
    mockAuthenticatedSession(otherUser, { portal: "customer" });
    const deniedComplete = await portalApp.request(
      `/api/portal/submissions/${draft.ref}/attachments/${upload.attachmentId}/complete`,
      { method: "POST", headers },
    );
    expect(deniedComplete.status).toBe(404);
    const [pending] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, upload.attachmentId));
    expect(pending?.state).toBe("pending");
    expect(pending?.submissionId).toBeTruthy();

    mockAuthenticatedSession(requesterUser, { portal: "customer" });
    const completeResponse = await portalApp.request(
      `/api/portal/submissions/${draft.ref}/attachments/${upload.attachmentId}/complete`,
      { method: "POST", headers },
    );
    expect(completeResponse.status).toBe(200);
    expect(await completeResponse.json()).toMatchObject({
      id: upload.attachmentId,
      state: "ready",
    });

    const finalizeResponse = await portalApp.request(
      `/api/portal/submissions/${draft.ref}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          formData: {
            title: "Replace the laptop",
            asset: "LT-27",
            files: [upload.attachmentId],
          },
        }),
      },
    );
    expect(finalizeResponse.status, await finalizeResponse.clone().text()).toBe(
      200,
    );
    const receipt = (await finalizeResponse.json()) as {
      state: string;
      workItemKey: string;
    };
    expect(receipt.state).toBe("accepted");
    const [submission] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, Number(draft.ref.slice(4))));
    expect(submission?.state).toBe("accepted");
    const [transferred] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, upload.attachmentId));
    expect(transferred).toMatchObject({
      state: "ready",
      submissionId: null,
      submissionFieldKey: "files",
      workItemId: submission?.workItemId,
      customerVisible: true,
    });
    expect(submission?.workItemId).toBeTruthy();
    expect(await db.select().from(schema.workItemTable)).toHaveLength(1);
    const eventKinds = await db
      .select({ kind: schema.outboxTable.kind })
      .from(schema.outboxTable);
    expect(eventKinds.map((row) => row.kind).sort()).toEqual([
      "submission.accepted",
      "submission.received",
      "work_item.created",
    ]);
  });

  it("rejects invalid uploaded bytes without making the submission attachment ready", async () => {
    const fixture = await setupAcceptanceFixture({ withFile: true });
    await authenticatePortalRequester(fixture);
    const portalApp = createPortalRouterHarness();
    const headers = {
      host: "portal.localhost:5174",
      origin: "http://portal.localhost:5174",
      "content-type": "application/json",
    };
    const draftResponse = await portalApp.request(
      "/api/portal/submissions/drafts",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestTypeKey: fixture.requestType.key,
          formData: { title: "Replace the laptop", asset: "LT-27" },
        }),
      },
    );
    const draft = (await draftResponse.json()) as { ref: string };
    const presignResponse = await portalApp.request(
      `/api/portal/submissions/${draft.ref}/attachments/presign`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          fieldKey: "files",
          filename: "invalid.png",
          contentType: "image/png",
          size: NOT_A_PNG.length,
        }),
      },
    );
    const upload = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    const { app: agentApp } = createApp();
    expect(
      (
        await agentApp.request(upload.uploadUrl, {
          method: "PUT",
          headers: upload.uploadHeaders,
          body: NOT_A_PNG,
        })
      ).status,
    ).toBe(204);
    const completeResponse = await portalApp.request(
      `/api/portal/submissions/${draft.ref}/attachments/${upload.attachmentId}/complete`,
      { method: "POST", headers },
    );
    expect(completeResponse.status).toBe(400);
    expect(
      await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, upload.attachmentId)),
    ).toHaveLength(0);
    const [submission] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, Number(draft.ref.slice(4))));
    expect(submission?.state).toBe("draft");
    expect(submission?.submittedAt).toBeNull();
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
    expect(await db.select().from(schema.outboxTable)).toHaveLength(0);
  });

  it("keeps the public portal-origin API edge closed by CP-19 before P3 identity acceptance", async () => {
    const fixture = await setupAcceptanceFixture({ autoAccept: true });
    await authenticatePortalRequester(fixture);
    const { app } = createApp();
    const response = await app.request("/api/portal/submissions/drafts", {
      method: "POST",
      headers: {
        host: "portal.localhost:5174",
        origin: "http://portal.localhost:5174",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requestTypeKey: fixture.requestType.key,
        formData: { title: "Replace the laptop", asset: "LT-27" },
      }),
    });
    expect(response.status).toBe(404);
    expect(await db.select().from(schema.submissionTable)).toHaveLength(1);
    expect(await db.select().from(schema.outboxTable)).toHaveLength(0);
  });
});
