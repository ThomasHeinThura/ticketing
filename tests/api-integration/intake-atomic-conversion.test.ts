/** IQ-14/16a regression: acceptance is a single durable conversion and two acceptors
 * racing the same submitted version can create exactly one work item. */
import { randomUUID } from "node:crypto";
import type { FormSchema, FormValue } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  acceptSubmission,
  createSubmission,
  findPortalSubmission,
  publishRequestType,
} from "../../apps/api/src/intake/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "work-item type",
  );
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "state template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId, stateTemplateId: template.id, isDefault: true })
      .returning(),
    "project state",
  );
}

async function createManualAcceptanceFixture(
  formSchema: FormSchema,
  formData: Record<string, FormValue>,
) {
  const member = await createWorkspaceMember({ role: "admin" });
  const staff = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, member.user.id),
          eq(schema.personTable.side, "staff"),
        ),
      ),
    "staff actor",
  );
  const organisation = requireRow(
    await db
      .insert(schema.organisationTable)
      .values({ key: `customer-${randomUUID()}`, name: "Customer" })
      .returning(),
    "organisation",
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
    "requester",
  );
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await db
    .update(schema.projectTable)
    .set({ organisationId: organisation.id })
    .where(eq(schema.projectTable.id, project.id));
  const type = await makeWorkItemType(member.workspace.id);
  await makeDefaultState(member.workspace.id, project.id);
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: member.workspace.id,
        key: `req-${randomUUID()}`,
        name: "Help",
        group: "General",
        workItemTypeId: type.id,
        defaultProjectId: project.id,
        formSchema,
      })
      .returning(),
    "request type",
  );
  const version = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: member.workspace.id,
        requestTypeId: requestType.id,
        number: 1,
        formSchema,
        workItemTypeId: type.id,
        defaultProjectId: project.id,
      })
      .returning(),
    "request type version",
  );
  const submission = requireRow(
    await db
      .insert(schema.submissionTable)
      .values({
        organisationId: organisation.id,
        requesterId: requester.id,
        requestTypeId: requestType.id,
        requestTypeVersionId: version.id,
        formData,
        state: "new",
        submittedAt: new Date(),
      })
      .returning(),
    "submission",
  );
  return {
    staff,
    workspace: member.workspace,
    project,
    type,
    submission,
  };
}

async function waitForBlockedProjectAcceptances(
  observer: Client,
  blockerPid: number,
  expectedCount: number,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await observer.query("SELECT pg_stat_clear_snapshot()");
    const result = await observer.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND $1 = ANY(pg_blocking_pids(pid))
          AND query ILIKE '%from "project"%'
          AND query ILIKE '%for no key update%'
      `,
      [blockerPid],
    );
    if (Number(result.rows[0]?.count ?? 0) >= expectedCount) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function waitForBlockedProjectArchive(
  observer: Client,
  blockerPid: number,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await observer.query("SELECT pg_stat_clear_snapshot()");
    const result = await observer.query<{ waiting: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND $1 = ANY(pg_blocking_pids(pid))
            AND query ILIKE 'update "project"%'
        ) AS waiting
      `,
      [blockerPid],
    );
    if (result.rows[0]?.waiting === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe("intake atomic conversion", () => {
  beforeEach(async () => resetTestDatabase());

  it("refuses to publish auto-accept to an organisation the pinned project cannot serve", async () => {
    const { workspace } = await createWorkspaceMember({ role: "admin" });
    const organisations = await db
      .insert(schema.organisationTable)
      .values([
        { key: `customer-a-${randomUUID()}`, name: "Customer A" },
        { key: `customer-b-${randomUUID()}`, name: "Customer B" },
      ])
      .returning();
    const projectOrganisation = requireRow([organisations[0]], "project org");
    const otherOrganisation = requireRow([organisations[1]], "other org");
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: projectOrganisation.id })
      .where(eq(schema.projectTable.id, project.id));
    const workItemType = await makeWorkItemType(workspace.id);
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: workspace.id,
          key: `audience-${randomUUID()}`,
          name: "Automatic request",
          group: "General",
          workItemTypeId: workItemType.id,
          defaultProjectId: project.id,
          formSchema: {
            fields: [
              {
                key: "summary",
                type: "text",
                label: "Summary",
                required: true,
                mapsTo: { field: "title" },
              },
            ],
          },
          autoAccept: true,
          customerVisible: true,
        })
        .returning(),
      "request type",
    );
    await db.insert(schema.organisationRequestTypeTable).values([
      { organisationId: projectOrganisation.id, requestTypeId: requestType.id },
      { organisationId: otherOrganisation.id, requestTypeId: requestType.id },
    ]);

    await expect(
      publishRequestType(requestType.id, "test-actor"),
    ).rejects.toMatchObject({ status: 422 });
    const [unchanged] = await db
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, requestType.id));
    const versions = await db
      .select()
      .from(schema.requestTypeVersionTable)
      .where(eq(schema.requestTypeVersionTable.requestTypeId, requestType.id));
    expect(unchanged?.published).toBe(false);
    expect(versions).toHaveLength(0);
  });

  it("does not convert forged answers for hidden mapped fields", async () => {
    const formSchema: FormSchema = {
      fields: [
        {
          key: "summary",
          type: "text",
          label: "Summary",
          required: true,
          mapsTo: { field: "title" },
        },
        { key: "gate", type: "text", label: "Gate" },
        {
          key: "impact",
          type: "select",
          label: "Impact",
          options: ["Everyone"],
          mapsTo: { field: "priority", map: { Everyone: "urgent" } },
          showIf: { field_key: "gate", op: "eq", value: "on" },
        },
        {
          key: "internal_note",
          type: "text",
          label: "Internal note",
          mapsTo: { field: "description" },
          showIf: { field_key: "gate", op: "eq", value: "on" },
        },
      ],
    };
    const fixture = await createManualAcceptanceFixture(formSchema, {
      summary: "Hidden mapping request",
      gate: "off",
      impact: "Everyone",
      internal_note: "forged hidden description",
    });

    const converted = await acceptSubmission(
      `SUB-${fixture.submission.number}`,
      fixture.workspace.id,
      fixture.staff.id,
      fixture.project.id,
      fixture.type.id,
    );
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, converted.workItem.id));

    expect(item?.priority).toBeNull();
    expect(JSON.stringify(item?.description)).not.toContain(
      "forged hidden description",
    );

    const visibleSubmission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: fixture.submission.organisationId,
          requesterId: fixture.submission.requesterId,
          requestTypeId: fixture.submission.requestTypeId,
          requestTypeVersionId: fixture.submission.requestTypeVersionId,
          formData: {
            summary: "Visible mapping request",
            gate: "on",
            impact: "Everyone",
            internal_note: "visible description",
          },
          state: "new",
          submittedAt: new Date(),
        })
        .returning(),
      "visible mapping submission",
    );
    const visibleConversion = await acceptSubmission(
      `SUB-${visibleSubmission.number}`,
      fixture.workspace.id,
      fixture.staff.id,
      fixture.project.id,
      fixture.type.id,
    );
    const [visibleItem] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, visibleConversion.workItem.id));

    expect(visibleItem?.priority).toBe("urgent");
    expect(JSON.stringify(visibleItem?.description)).toContain(
      "visible description",
    );
  });

  it("serializes manual acceptance with project archival", async () => {
    const formSchema: FormSchema = {
      fields: [
        {
          key: "summary",
          type: "text",
          label: "Summary",
          required: true,
          mapsTo: { field: "title" },
        },
      ],
    };
    const fixture = await createManualAcceptanceFixture(formSchema, {
      summary: "Archive race",
    });
    const blocker = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    let transactionOpen = false;
    let acceptance: Promise<
      | {
          status: "fulfilled";
          value: Awaited<ReturnType<typeof acceptSubmission>>;
        }
      | { status: "rejected"; error: unknown }
    > | null = null;

    await blocker.connect();
    await observer.connect();
    try {
      await blocker.query("BEGIN");
      transactionOpen = true;
      await blocker.query('SELECT id FROM "project" WHERE id = $1 FOR UPDATE', [
        fixture.project.id,
      ]);
      const { rows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = rows[0]?.pid;
      if (blockerPid === undefined)
        throw new Error("Could not read project-lock backend PID");

      acceptance = acceptSubmission(
        `SUB-${fixture.submission.number}`,
        fixture.workspace.id,
        fixture.staff.id,
        fixture.project.id,
        fixture.type.id,
      ).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );

      const waitsForProjectLock = await waitForBlockedProjectAcceptances(
        observer,
        blockerPid,
        1,
      );
      await blocker.query(
        'UPDATE "project" SET archived_at = now() WHERE id = $1',
        [fixture.project.id],
      );
      await blocker.query("COMMIT");
      transactionOpen = false;

      expect(waitsForProjectLock).toBe(true);
      const outcome = await acceptance;
      expect(outcome.status).toBe("rejected");
      if (outcome.status !== "rejected")
        throw new Error(
          "Acceptance unexpectedly succeeded after project archival",
        );
      expect(outcome.error).toMatchObject({ status: 422 });
      const [submission] = await db
        .select()
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.id, fixture.submission.id));
      const createdItems = await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.projectId, fixture.project.id));
      expect(submission?.workItemId).toBeNull();
      expect(createdItems).toHaveLength(0);
    } finally {
      if (transactionOpen) await blocker.query("ROLLBACK");
      if (acceptance) await acceptance;
      await observer.end();
      await blocker.end();
    }
  });

  it("serializes three acceptances for one project before a queued archive", async () => {
    const formSchema: FormSchema = {
      fields: [
        {
          key: "summary",
          type: "text",
          label: "Summary",
          required: true,
          mapsTo: { field: "title" },
        },
      ],
    };
    const fixture = await createManualAcceptanceFixture(formSchema, {
      summary: "First concurrent request",
    });
    const secondSubmission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: fixture.submission.organisationId,
          requesterId: fixture.submission.requesterId,
          requestTypeId: fixture.submission.requestTypeId,
          requestTypeVersionId: fixture.submission.requestTypeVersionId,
          formData: { summary: "Second concurrent request" },
          state: "new",
          submittedAt: new Date(),
        })
        .returning(),
      "second concurrent submission",
    );
    const customerUser = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `customer-user-${randomUUID()}`,
          name: "Portal Requester",
          email: `${randomUUID()}@example.com`,
          emailVerified: true,
        })
        .returning(),
      "customer user",
    );
    await db.insert(schema.personTable).values({
      userId: customerUser.id,
      organisationId: fixture.submission.organisationId,
      side: "customer",
      displayName: "Portal Requester",
    });
    const autoType = await makeWorkItemType(fixture.workspace.id);
    const autoRequestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: fixture.workspace.id,
          key: `auto-${randomUUID()}`,
          name: "Automatic request",
          group: "General",
          workItemTypeId: autoType.id,
          defaultProjectId: fixture.project.id,
          formSchema,
          autoAccept: true,
          customerVisible: true,
          published: true,
        })
        .returning(),
      "auto-accept request type",
    );
    await db.insert(schema.requestTypeVersionTable).values({
      workspaceId: fixture.workspace.id,
      requestTypeId: autoRequestType.id,
      number: 1,
      formSchema,
      workItemTypeId: autoType.id,
      defaultProjectId: fixture.project.id,
      autoAccept: true,
    });
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: fixture.submission.organisationId,
      requestTypeId: autoRequestType.id,
    });
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey: "feature.intake", enabled: true })
      .onConflictDoNothing();
    const blocker = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const archiver = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    let transactionOpen = false;
    const operations: Array<
      Promise<{ status: "fulfilled" } | { status: "rejected"; error: unknown }>
    > = [];
    let archive: Promise<
      { status: "fulfilled" } | { status: "rejected"; error: unknown }
    > | null = null;

    await blocker.connect();
    await observer.connect();
    await archiver.connect();
    try {
      await blocker.query("BEGIN");
      transactionOpen = true;
      await blocker.query('SELECT id FROM "project" WHERE id = $1 FOR UPDATE', [
        fixture.project.id,
      ]);
      const { rows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = rows[0]?.pid;
      if (blockerPid === undefined)
        throw new Error("Could not read project-lock backend PID");

      for (const submission of [fixture.submission, secondSubmission]) {
        operations.push(
          acceptSubmission(
            `SUB-${submission.number}`,
            fixture.workspace.id,
            fixture.staff.id,
            fixture.project.id,
            fixture.type.id,
          ).then(
            () => ({ status: "fulfilled" as const }),
            (error: unknown) => ({ status: "rejected" as const, error }),
          ),
        );
      }
      operations.push(
        createSubmission({
          userId: customerUser.id,
          key: autoRequestType.key,
          formData: { summary: "Concurrent auto-accepted request" },
        }).then(
          (result) =>
            result.state === "accepted"
              ? { status: "fulfilled" as const }
              : {
                  status: "rejected" as const,
                  error: new Error("Auto-accept did not accept the submission"),
                },
          (error: unknown) => ({ status: "rejected" as const, error }),
        ),
      );
      const acceptorsQueued = await waitForBlockedProjectAcceptances(
        observer,
        blockerPid,
        3,
      );
      archive = archiver
        .query(
          'UPDATE "project" SET archived_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
          [fixture.project.id],
        )
        .then(
          () => ({ status: "fulfilled" as const }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
      const archiveQueued = await waitForBlockedProjectArchive(
        observer,
        blockerPid,
      );
      await blocker.query("COMMIT");
      transactionOpen = false;

      expect(acceptorsQueued).toBe(true);
      expect(archiveQueued).toBe(true);
      const outcomes = await Promise.all(operations);
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(3);
      expect(
        outcomes.filter((outcome) => outcome.status === "rejected"),
      ).toHaveLength(0);
      const archiveOutcome = await archive;
      expect(archiveOutcome.status).toBe("fulfilled");
      if (archiveOutcome.status !== "fulfilled")
        throw new Error("Project archive failed after all three acceptances");

      const submissions = await db
        .select({ workItemId: schema.submissionTable.workItemId })
        .from(schema.submissionTable)
        .where(
          and(
            eq(schema.submissionTable.id, fixture.submission.id),
            eq(
              schema.submissionTable.requestTypeId,
              fixture.submission.requestTypeId,
            ),
          ),
        );
      const secondRows = await db
        .select({ workItemId: schema.submissionTable.workItemId })
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.id, secondSubmission.id));
      expect(submissions[0]?.workItemId).toBeTruthy();
      expect(secondRows[0]?.workItemId).toBeTruthy();
      const autoRows = await db
        .select({ workItemId: schema.submissionTable.workItemId })
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.requestTypeId, autoRequestType.id));
      expect(autoRows).toHaveLength(1);
      expect(autoRows[0]?.workItemId).toBeTruthy();
      const createdItems = await db
        .select({
          id: schema.workItemTable.id,
          number: schema.workItemTable.number,
        })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.projectId, fixture.project.id));
      expect(createdItems).toHaveLength(3);
      const linkedItemIds = [
        submissions[0]?.workItemId,
        secondRows[0]?.workItemId,
        autoRows[0]?.workItemId,
      ];
      expect(new Set(linkedItemIds).size).toBe(3);
      expect(new Set(createdItems.map(({ id }) => id))).toEqual(
        new Set(linkedItemIds),
      );
      const itemNumbers = createdItems
        .map(({ number }) => number)
        .sort((left, right) => left - right);
      const [firstItemNumber, secondItemNumber, thirdItemNumber] = itemNumbers;
      if (
        firstItemNumber === undefined ||
        secondItemNumber === undefined ||
        thirdItemNumber === undefined
      ) {
        throw new Error("Expected three converted work item numbers");
      }
      expect(secondItemNumber).toBe(firstItemNumber + 1);
      expect(thirdItemNumber).toBe(secondItemNumber + 1);
      const [project] = await db
        .select({ archivedAt: schema.projectTable.archivedAt })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, fixture.project.id));
      expect(project?.archivedAt).not.toBeNull();
    } finally {
      if (transactionOpen) await blocker.query("ROLLBACK");
      await Promise.allSettled(operations);
      if (archive) await archive;
      await archiver.end();
      await observer.end();
      await blocker.end();
    }
  });

  it("races acceptors and atomically transfers comments, attachments, watcher, and submission SLA time", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { workspace } = member;
    const staff = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(
          and(
            eq(schema.personTable.userId, member.user.id),
            eq(schema.personTable.side, "staff"),
          ),
        ),
      "staff actor",
    );
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `customer-${randomUUID()}`, name: "Customer" })
        .returning(),
      "organisation",
    );
    const person = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          organisationId: organisation.id,
          side: "customer",
          displayName: "Requester",
        })
        .returning(),
      "requester",
    );
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.projectTable.id, project.id));
    const type = await makeWorkItemType(workspace.id);
    const chosenType = await makeWorkItemType(workspace.id);
    await makeDefaultState(workspace.id, project.id);
    const formSchema = {
      fields: [
        {
          key: "summary",
          type: "text",
          label: "Summary",
          required: true,
          mapsTo: { field: "title" },
        },
      ],
    };
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: workspace.id,
          key: `req-${randomUUID()}`,
          name: "Help",
          group: "General",
          workItemTypeId: type.id,
          defaultProjectId: project.id,
          formSchema,
        })
        .returning(),
      "request type",
    );
    const version = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: workspace.id,
          requestTypeId: requestType.id,
          number: 1,
          formSchema,
          workItemTypeId: type.id,
          defaultProjectId: project.id,
        })
        .returning(),
      "request type version",
    );
    const submittedAt = new Date("2026-01-02T03:04:05.000Z");
    const submission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: organisation.id,
          requesterId: person.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: version.id,
          formData: { summary: "Cannot sign in" },
          state: "new",
          submittedAt,
          createdAt: submittedAt,
          updatedAt: submittedAt,
        })
        .returning(),
      "submission",
    );
    await db.insert(schema.requestParticipantTable).values({
      submissionId: submission.id,
      personId: person.id,
      addedBy: person.id,
    });
    const customerMessageAt = new Date("2026-01-02T03:05:00.000Z");
    const firstResponseAt = new Date("2026-01-02T03:09:00.000Z");
    await db.insert(schema.submissionMessageTable).values([
      {
        submissionId: submission.id,
        authorId: person.id,
        actorType: "customer",
        body: "Details",
        createdAt: customerMessageAt,
      },
      {
        submissionId: submission.id,
        authorId: person.id,
        actorType: "triager",
        body: "We are checking",
        createdAt: firstResponseAt,
      },
    ]);
    const attachment = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: workspace.id,
          organisationId: organisation.id,
          submissionId: submission.id,
          submissionFieldKey: "evidence",
          objectKey: `pending/${randomUUID()}`,
          filename: "details.txt",
          mimeType: "text/plain",
          size: 6,
          state: "ready",
          customerVisible: true,
          uploadedBy: person.id,
        })
        .returning(),
      "submission attachment",
    );

    const portalView = await findPortalSubmission(
      `SUB-${submission.number}`,
      person.id,
    );
    const serializedPortalView = JSON.stringify(portalView);
    expect(serializedPortalView).not.toContain("defaultAssigneeId");
    expect(serializedPortalView).not.toContain("workItemTypeId");
    expect(serializedPortalView).not.toContain("workspaceId");

    const outcomes = await Promise.allSettled([
      acceptSubmission(
        `SUB-${submission.number}`,
        workspace.id,
        staff.id,
        project.id,
        chosenType.id,
      ),
      acceptSubmission(
        `SUB-${submission.number}`,
        workspace.id,
        staff.id,
        project.id,
        chosenType.id,
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const [converted] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, submission.id));
    expect(converted?.state).toBe("accepted");
    const workItemId = converted?.workItemId;
    if (!workItemId) throw new Error("Acceptance did not create a work item");
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, workItemId));
    if (!item) throw new Error("Converted work item was not persisted");
    expect(item?.title).toBe("Cannot sign in");
    expect(item?.typeId).toBe(chosenType.id);
    expect(item?.slaStartedAt?.toISOString()).toBe(submittedAt.toISOString());
    expect(item?.firstResponseAt?.toISOString()).toBe(
      firstResponseAt.toISOString(),
    );
    const [movedAttachment] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, attachment.id));
    expect(movedAttachment?.submissionId).toBeNull();
    expect(movedAttachment?.workItemId).toBe(item?.id);
    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, item.id));
    expect(
      comments.map((comment) => comment.createdAt.toISOString()).sort(),
    ).toEqual(
      [customerMessageAt.toISOString(), firstResponseAt.toISOString()].sort(),
    );
    const [watcher] = await db
      .select()
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.workItemId, item.id));
    expect(watcher?.personId).toBe(person.id);
    const [participant] = await db
      .select()
      .from(schema.requestParticipantTable)
      .where(eq(schema.requestParticipantTable.workItemId, item.id));
    expect(participant?.personId).toBe(person.id);
    const acceptedEvents = await db
      .select({ payload: schema.outboxTable.payload })
      .from(schema.outboxTable)
      .where(
        and(
          eq(schema.outboxTable.kind, "submission.accepted"),
          eq(schema.outboxTable.organisationId, organisation.id),
        ),
      );
    expect(
      acceptedEvents.filter(
        (event) =>
          (event.payload as { ref?: string }).ref ===
          `SUB-${submission.number}`,
      ),
    ).toHaveLength(1);
    const claimAudits = await db
      .select({
        id: schema.auditLogTable.id,
        actorId: schema.auditLogTable.actorId,
        actorType: schema.auditLogTable.actorType,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "submission.claimed"),
          eq(schema.auditLogTable.entityId, submission.id),
        ),
      );
    expect(claimAudits).toHaveLength(1);
    expect(claimAudits[0]).toMatchObject({
      actorId: staff.id,
      actorType: "person",
    });

    // IQ-7 permits a triager to override the pinned type, but only with a type in the
    // submission workspace. A foreign-workspace id fails closed before any item is made.
    const { workspace: otherWorkspace } = await createWorkspaceMember({
      role: "admin",
    });
    const foreignType = await makeWorkItemType(otherWorkspace.id);
    const secondSubmission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: organisation.id,
          requesterId: person.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: version.id,
          formData: { summary: "Another request" },
          state: "new",
          submittedAt: new Date(),
        })
        .returning(),
      "second submission",
    );
    await expect(
      acceptSubmission(
        `SUB-${secondSubmission.number}`,
        workspace.id,
        staff.id,
        project.id,
        foreignType.id,
      ),
    ).rejects.toMatchObject({ status: 422 });
    const [notConverted] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, secondSubmission.id));
    expect(notConverted?.state).toBe("new");
    expect(notConverted?.workItemId).toBeNull();
  });

  it("attributes auto-accept conversion to the system while retaining the customer requester", async () => {
    const { workspace } = await createWorkspaceMember({ role: "admin" });
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `customer-${randomUUID()}`, name: "Customer" })
        .returning(),
      "organisation",
    );
    const customerUser = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `customer-user-${randomUUID()}`,
          name: "Portal Requester",
          email: `${randomUUID()}@example.com`,
          emailVerified: true,
        })
        .returning(),
      "customer user",
    );
    const requester = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId: customerUser.id,
          organisationId: organisation.id,
          side: "customer",
          displayName: "Portal Requester",
        })
        .returning(),
      "requester",
    );
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.projectTable.id, project.id));
    const type = await makeWorkItemType(workspace.id);
    await makeDefaultState(workspace.id, project.id);
    const formSchema = {
      fields: [
        {
          key: "summary",
          type: "text",
          label: "Summary",
          required: true,
          mapsTo: { field: "title" },
        },
      ],
    };
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: workspace.id,
          key: `auto-${randomUUID()}`,
          name: "Automatic request",
          group: "General",
          workItemTypeId: type.id,
          defaultProjectId: project.id,
          formSchema,
          autoAccept: true,
          customerVisible: true,
          published: true,
        })
        .returning(),
      "request type",
    );
    await db.insert(schema.requestTypeVersionTable).values({
      workspaceId: workspace.id,
      requestTypeId: requestType.id,
      number: 1,
      formSchema,
      workItemTypeId: type.id,
      defaultProjectId: project.id,
      autoAccept: true,
    });
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: organisation.id,
      requestTypeId: requestType.id,
    });
    await db.insert(schema.instanceFeatureFlagTable).values({
      featureKey: "feature.intake",
      enabled: true,
    });

    const result = await createSubmission({
      userId: customerUser.id,
      key: requestType.key,
      formData: { summary: "Reset access" },
    });
    expect(result.state).toBe("accepted");
    expect(result.workItemId).toBeTruthy();
    const portalPage = await findPortalSubmission(
      `SUB-${result.number}`,
      requester.id,
    );
    expect(portalPage.workItem).toMatchObject({
      title: "Reset access",
      description: "",
      state: "Backlog",
      priority: null,
    });
    expect(portalPage.workItem).not.toHaveProperty("key");
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    await expect(
      createSubmission({
        userId: customerUser.id,
        key: requestType.key,
        formData: { summary: "Should stay retryable" },
      }),
    ).rejects.toMatchObject({ status: 422 });
    const submissionsAfterRejectedRetry = await db
      .select({ id: schema.submissionTable.id })
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.requestTypeId, requestType.id));
    expect(submissionsAfterRejectedRetry).toHaveLength(1);
    await db
      .update(schema.projectTable)
      .set({ archivedAt: null })
      .where(eq(schema.projectTable.id, project.id));
    await db
      .update(schema.requestTypeTable)
      .set({ defaultProjectId: null })
      .where(eq(schema.requestTypeTable.id, requestType.id));
    await expect(
      publishRequestType(requestType.id, "test-actor"),
    ).rejects.toMatchObject({
      status: 422,
    });
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, result.workItemId ?? ""));
    expect(item?.requesterId).toBe(requester.id);

    const ref = `SUB-${result.number}`;
    const events = await db
      .select({
        kind: schema.outboxTable.kind,
        payload: schema.outboxTable.payload,
      })
      .from(schema.outboxTable);
    const accepted = events
      .filter((event) => event.kind === "submission.accepted")
      .map(
        (event) =>
          event.payload as { actor?: unknown; payload?: { ref?: string } },
      )
      .filter((event) => event.payload?.ref === ref);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.actor).toEqual({
      type: "system",
      id: null,
      name: "Request type auto-accept",
    });
    const workItemCreated = events
      .filter((event) => event.kind === "work_item.created")
      .map(
        (event) =>
          event.payload as {
            actor?: unknown;
            payload?: { requesterId?: string };
          },
      )
      .find((event) => event.payload?.requesterId === requester.id);
    expect(workItemCreated?.actor).toEqual({
      type: "system",
      id: null,
      name: "Request type auto-accept",
    });
    const activity = await db
      .select({
        actorId: schema.activityTable.actorId,
        actorType: schema.activityTable.actorType,
      })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, item?.id ?? ""));
    expect(activity[0]).toMatchObject({ actorId: null, actorType: "system" });
  });
});
