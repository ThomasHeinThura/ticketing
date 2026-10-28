import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { claimVerifiedImportPlaceholder } from "../../../apps/api/src/identity/placeholder-claim";
import { createApp } from "../../../apps/api/src/index";
import { resolveAssigneeEligibility } from "../../../apps/api/src/work-item/assignee-eligibility";
import { resetTestDatabase } from "../helpers/database";
import { requireRow } from "../helpers/fixtures";
import {
  commitChunk,
  createRun,
  getReport,
  record,
  request,
  writerFixture,
} from "./writer-fixture";

beforeEach(async () => resetTestDatabase());

async function commentsOf(workItemId: string) {
  return db
    .select()
    .from(schema.commentTable)
    .where(eq(schema.commentTable.workItemId, workItemId));
}

describe("import writer: authorship and identity (IM-6, IM-7, D3)", () => {
  it("maps a known email to the existing person, case-insensitively, without creating a placeholder", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "authorship-known");
    const upper = f.user.email.toUpperCase();
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "K-1", {
        sourceAuthorEmail: upper,
        comments: [
          {
            sourceId: "k1-c1",
            authorEmail: `  ${upper} `.trim(),
            body: "Known author comment",
            createdAt: "2024-03-01T10:00:00.000Z",
          },
        ],
      }),
    ]);
    expect(commit.counts).toMatchObject({ created: 1, rejected: 0 });
    const targetId = commit.rows[0]?.targetId as string;
    const [comment] = await commentsOf(targetId);
    expect(comment?.authorId).toBe(f.person.id);
    expect(comment?.actorType).toBe("person");
    const placeholders = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.isPlaceholder, true));
    expect(placeholders).toHaveLength(0);
    const [created] = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, targetId),
          eq(schema.activityTable.verb, "created"),
        ),
      );
    expect(created?.actorId).toBe(f.person.id);
    expect(created?.origin).toBe("imported");
  });

  it("creates an unassignable, claimable placeholder for an unknown email and reuses it", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "authorship-unknown");
    const email = "Departed.Staff@Example.TEST";
    const { commit, preview } = await commitChunk(app, f, run.id, "c1", [
      record(f, "U-1", {
        comments: [
          {
            sourceId: "u1-c1",
            authorEmail: email,
            authorName: "Departed Staff",
            body: "Written by someone who left",
          },
        ],
        assigneeEmail: email,
      }),
      record(f, "U-2", {
        comments: [{ sourceId: "u2-c1", authorEmail: email, body: "Again" }],
      }),
    ]);
    expect(preview.plan).toMatchObject({
      authorAddresses: 1,
      placeholdersToCreate: 1,
      comments: 2,
    });
    const placeholders = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.isPlaceholder, true));
    expect(placeholders).toHaveLength(1);
    const [placeholder] = placeholders;
    expect(placeholder).toMatchObject({
      userId: null,
      side: "staff",
      organisationId: f.workspace.organisationId,
      displayName: "Departed Staff",
    });
    const claims = await db.select().from(schema.importPlaceholderClaimTable);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      personId: placeholder?.id,
      importRunId: run.id,
      normalizedEmail: "departed.staff@example.test",
      claimedAt: null,
    });

    // both comments say who wrote them, and share the one placeholder
    const first = await commentsOf(commit.rows[0]?.targetId as string);
    const second = await commentsOf(commit.rows[1]?.targetId as string);
    expect(first[0]?.authorId).toBe(placeholder?.id);
    expect(second[0]?.authorId).toBe(placeholder?.id);

    // unassignable: no roster membership, and the assignee was not written
    const eligibility = await resolveAssigneeEligibility(
      db,
      f.project.id,
      placeholder?.id as string,
    );
    expect(eligibility.eligible).toBe(false);
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, commit.rows[0]?.targetId as string));
    expect(item?.assigneeId).toBeNull();
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toMatchObject({
      assignee_unmatched: 1,
    });

    // a rerun in a second run reuses the placeholder: still one person, one claim row
    const second2 = await createRun(app, f, "authorship-unknown-second");
    await commitChunk(app, f, second2.id, "c1", [
      record(f, "U-9", {
        comments: [{ sourceId: "u9-c1", authorEmail: email, body: "Later" }],
      }),
    ]);
    expect(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.isPlaceholder, true)),
    ).toHaveLength(1);
    expect(
      await db.select().from(schema.importPlaceholderClaimTable),
    ).toHaveLength(1);

    // claimable: the verified owner of that address claims the SAME person
    const claimant = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `claimant-${randomUUID()}`,
          name: "Verified claimant",
          email: "departed.staff@example.test",
          emailVerified: true,
        })
        .returning(),
      "claimant",
    );
    const claimed = await db.transaction((tx) =>
      claimVerifiedImportPlaceholder(tx, {
        userId: claimant.id,
        verifiedEmail: "departed.staff@example.test",
        side: "staff",
        organisationId: f.workspace.organisationId,
        method: "email_otp",
      }),
    );
    expect(claimed).toMatchObject({
      kind: "claimed",
      personId: placeholder?.id,
    });
    const [afterClaim] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, placeholder?.id as string));
    expect(afterClaim).toMatchObject({
      userId: claimant.id,
      isPlaceholder: false,
    });
    // history authorship survives the claim
    const [kept] = await commentsOf(commit.rows[0]?.targetId as string);
    expect(kept?.authorId).toBe(placeholder?.id);
  });

  it("scopes email matching to the workspace organisation (tenant isolation)", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const other = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `other-${randomUUID()}`,
          name: "Other organisation",
          isInternal: false,
          active: true,
          portalAccess: true,
        })
        .returning(),
      "other organisation",
    );
    const foreignUser = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `foreign-${randomUUID()}`,
          name: "Foreign",
          email: "shared.address@example.test",
          emailVerified: true,
        })
        .returning(),
      "foreign user",
    );
    const foreignPerson = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId: foreignUser.id,
          organisationId: other.id,
          side: "staff",
          displayName: "Foreign person",
        })
        .returning(),
      "foreign person",
    );
    const run = await createRun(app, f, "authorship-tenant");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "T-1", {
        comments: [
          {
            sourceId: "t1-c1",
            authorEmail: "SHARED.address@example.test",
            body: "Must not link to another organisation",
          },
        ],
      }),
    ]);
    const [comment] = await commentsOf(commit.rows[0]?.targetId as string);
    expect(comment?.authorId).not.toBe(foreignPerson.id);
    const [author] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, comment?.authorId as string));
    expect(author).toMatchObject({
      isPlaceholder: true,
      organisationId: f.workspace.organisationId,
    });
  });

  it("preserves source timestamps with the imported-origin marker and never moves audit time", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "authorship-time");
    const before = Date.now();
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "TS-1", {
        sourceCreatedAt: "2021-05-04T08:30:00.000Z",
        sourceUpdatedAt: "2022-06-07T09:00:00.000Z",
        sourceResolvedAt: "2022-06-08T09:00:00.000Z",
        sourceUrl: "https://source.example.test/issues/TS-1",
        comments: [
          {
            sourceId: "ts1-c1",
            body: "Historic comment",
            createdAt: "2021-05-05T11:00:00.000Z",
            updatedAt: "2021-05-06T12:00:00.000Z",
          },
        ],
        history: [
          {
            sourceId: "ts1-h1",
            at: "2021-05-10T10:00:00.000Z",
            field: "Priority",
            from: "Low",
            to: "High",
          },
        ],
      }),
    ]);
    const targetId = commit.rows[0]?.targetId as string;
    const [comment] = await commentsOf(targetId);
    expect(comment?.createdAt.toISOString()).toBe("2021-05-05T11:00:00.000Z");
    expect(comment?.updatedAt.toISOString()).toBe("2021-05-06T12:00:00.000Z");
    expect(comment?.origin).toBe("imported");
    expect(comment?.importedAt?.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );

    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, targetId));
    const created = activity.find((row) => row.verb === "created");
    expect(created?.createdAt.toISOString()).toBe("2021-05-04T08:30:00.000Z");
    expect(created?.origin).toBe("imported");
    const history = activity.find((row) => row.field === "Priority");
    expect(history).toMatchObject({
      verb: "updated",
      visibility: "internal",
      origin: "imported",
      oldValue: "Low",
      newValue: "High",
    });
    expect(history?.createdAt.toISOString()).toBe("2021-05-10T10:00:00.000Z");

    // the work item's own clocks (SLA/metrics) and the audit chain are not moved
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, targetId));
    expect(item?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(item?.resolvedAt).toBeNull();
    const audits = await db.select().from(schema.auditLogTable);
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits)
      expect(audit.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5000);

    // the source times and URL live on the provenance row
    const [provenance] = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(
        and(
          eq(schema.importProvenanceTable.workItemId, targetId),
          eq(schema.importProvenanceTable.entityType, "work_item"),
        ),
      );
    expect(provenance).toMatchObject({
      system: "authorship-time",
      externalId: "issue:TS-1",
      url: "https://source.example.test/issues/TS-1",
      origin: "imported",
      importRunId: run.id,
    });
    expect(provenance?.sourceCreatedAt?.toISOString()).toBe(
      "2021-05-04T08:30:00.000Z",
    );
    expect(provenance?.sourceResolvedAt?.toISOString()).toBe(
      "2022-06-08T09:00:00.000Z",
    );
  });

  it("reports an implausible source time instead of storing it", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "authorship-future");
    const future = new Date(Date.now() + 365 * 86400_000).toISOString();
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "F-1", {
        comments: [
          { sourceId: "f1-c1", body: "From the future", createdAt: future },
        ],
      }),
    ]);
    const [comment] = await commentsOf(commit.rows[0]?.targetId as string);
    expect(comment?.createdAt.getTime()).toBeLessThan(Date.now() + 60_000);
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toMatchObject({
      timestamp_invalid: 1,
    });
  });

  it("defaults comment visibility to internal and keeps an explicit public", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "authorship-visibility");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "V-1", {
        comments: [
          { sourceId: "v1-default", body: "No visibility given" },
          {
            sourceId: "v1-public",
            body: "Explicitly public",
            visibility: "public",
          },
        ],
      }),
    ]);
    const comments = await commentsOf(commit.rows[0]?.targetId as string);
    const bySource = new Map(
      await Promise.all(
        comments.map(async (comment) => {
          const [link] = await db
            .select()
            .from(schema.importProvenanceTable)
            .where(eq(schema.importProvenanceTable.entityId, comment.id));
          return [link?.externalId, comment.visibility] as const;
        }),
      ),
    );
    expect(bySource.get("issue:V-1#comment:v1-default")).toBe("internal");
    expect(bySource.get("issue:V-1#comment:v1-public")).toBe("public");
  });

  it("only an instance-admin import run may set authors and timestamps", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "authorship-no-admin");
    const response = await request(
      app,
      f.noAdminKey.key,
      `/api/imports/${run.id}/dry-run`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          chunkId: "c1",
          expectedVersion: 1,
          records: [
            record(f, "N-1", { sourceCreatedAt: "2020-01-01T00:00:00.000Z" }),
          ],
        }),
      },
    );
    expect([403, 404]).toContain(response.status);
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.isPlaceholder, true)),
    ).toHaveLength(0);
  });
});
