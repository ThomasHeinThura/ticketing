import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { cleanupExpiredImportChunks } from "../../apps/api/src/imports/expiry-cleanup";
import { createApp } from "../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { seedMockedSessionForStepUp } from "./helpers/step-up";
import {
  createRun,
  request as mcpRequest,
  previewChunk,
  record,
  writerFixture,
} from "./imports/writer-fixture";

const jsonHeaders = { "content-type": "application/json" };
type App = ReturnType<typeof createApp>["app"];

async function issueStepUpAndApprove(
  app: App,
  userId: string,
  pendingActionId: string,
  typedCount: string,
) {
  await seedMockedSessionForStepUp(userId, "p25-test-password");
  const [user] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  mockAuthenticatedSession({ ...(user as object), role: "admin" } as never);

  const send = (path: string, body: unknown) => {
    const r = withConfiguredAgentAuthority(path, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    return app.request(r.input, r.init);
  };

  const challenge = await send("/api/me/step-up/challenges", {
    kind: "pending_action",
    pendingActionId,
  });
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const issued = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };

  const proof = await send("/api/me/step-up", {
    kind: "pending_action",
    pendingActionId,
    challengeId: issued.challengeId,
    nonce: issued.nonce,
    method: "password",
    password: "p25-test-password",
  });
  expect(proof.status, await proof.clone().text()).toBe(200);
  const { token } = (await proof.json()) as { token: string };

  const approvalReq = withConfiguredAgentAuthority(
    `/api/me/pending-actions/${pendingActionId}/approve`,
    {
      method: "POST",
      headers: {
        ...jsonHeaders,
        "x-taskdesk-step-up-token": token,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ typedCount }),
    },
  );
  return app.request(approvalReq.input, approvalReq.init);
}

describe("P-25: import approval survives original preview expiry while pending_action is live", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("executes a large records chunk cleanly 35 minutes after preview creation when approved within pending_action TTL", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "p25-records");

    const records = Array.from({ length: 51 }, (_, index) =>
      record(f, `REC-${index + 1}`),
    );
    const preview = await previewChunk(app, f, run.id, "chunk-51", records);

    // Simulate preview created 25 minutes ago (5 minutes left on original 30m preview TTL).
    await db.execute(sql`
      UPDATE import_run
      SET created_at = clock_timestamp() - interval '25 minutes',
          updated_at = clock_timestamp() - interval '25 minutes',
          dry_run_expires_at = clock_timestamp() + interval '5 minutes'
      WHERE id = ${run.id}
    `);
    await db.execute(sql`
      UPDATE import_chunk
      SET created_at = clock_timestamp() - interval '25 minutes',
          expires_at = clock_timestamp() + interval '5 minutes'
      WHERE import_run_id = ${run.id} AND chunk_id = 'chunk-51'
    `);

    const commitRes = await mcpRequest(
      app,
      f.fullKey.key,
      `/api/imports/${run.id}/records`,
      {
        method: "POST",
        headers: { ...jsonHeaders, "Idempotency-Key": randomUUID() },
        body: JSON.stringify({
          chunkId: "chunk-51",
          expectedVersion: preview.runVersion,
          previewDigest: preview.previewDigest,
          records,
        }),
      },
    );
    expect(commitRes.status).toBe(202);
    const pendingBody = (await commitRes.json()) as {
      pendingActionId: string;
    };

    const [actionRow] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingBody.pendingActionId));
    const [chunkAfterRequest] = await db
      .select()
      .from(schema.importChunkTable)
      .where(eq(schema.importChunkTable.importRunId, run.id));
    const [runAfterRequest] = await db
      .select()
      .from(schema.importRunTable)
      .where(eq(schema.importRunTable.id, run.id));

    expect(actionRow).toBeDefined();
    expect(chunkAfterRequest?.expiresAt.getTime()).toBeGreaterThanOrEqual(
      actionRow?.expiresAt.getTime() ?? 0,
    );
    expect(runAfterRequest?.dryRunExpiresAt?.getTime()).toBeGreaterThanOrEqual(
      actionRow?.expiresAt.getTime() ?? 0,
    );

    // Advance 10 more minutes via timestamp shift: preview is now 35 minutes old (past 30m TTL!),
    // while pending_action (15m TTL from t=25m) still has ~5 minutes remaining.
    await db.execute(sql`
      UPDATE import_run
      SET created_at = created_at - interval '10 minutes',
          updated_at = updated_at - interval '10 minutes',
          dry_run_expires_at = dry_run_expires_at - interval '10 minutes'
      WHERE id = ${run.id}
    `);
    await db.execute(sql`
      UPDATE import_chunk
      SET created_at = created_at - interval '10 minutes',
          expires_at = expires_at - interval '10 minutes'
      WHERE import_run_id = ${run.id} AND chunk_id = 'chunk-51'
    `);
    await db.execute(sql`
      UPDATE pending_action
      SET created_at = created_at - interval '10 minutes',
          expires_at = expires_at - interval '10 minutes'
      WHERE id = ${pendingBody.pendingActionId}
    `);

    await cleanupExpiredImportChunks();

    const approved = await issueStepUpAndApprove(
      app,
      f.user.id,
      pendingBody.pendingActionId,
      "51",
    );
    expect(approved.status, await approved.clone().text()).toBe(200);

    const items = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, f.project.id));
    expect(items).toHaveLength(51);
  });

  it("executes a large links chunk cleanly when chunk preview age exceeds 30 minutes while pending_action is still valid", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "p25-links");

    // Seed 51 work items to link against.
    const items = await db
      .insert(schema.workItemTable)
      .values(
        Array.from({ length: 51 }, (_, index) => ({
          workspaceId: f.workspace.id,
          projectId: f.project.id,
          typeId: f.type.id,
          stateId: f.defaultState.id,
          key: `P25L-${index + 1}`,
          number: index + 1,
          title: `Target ${index + 1}`,
        })),
      )
      .returning({ id: schema.workItemTable.id });

    const links = items.map((item, index) => ({
      sourceType: "issue",
      sourceId: `LINK-${index + 1}`,
      targetType: "work_item" as const,
      targetId: item.id,
    }));

    const linkRes = await mcpRequest(
      app,
      f.fullKey.key,
      `/api/imports/${run.id}/links`,
      {
        method: "POST",
        headers: { ...jsonHeaders, "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ links }),
      },
    );
    expect(linkRes.status).toBe(202);
    const { pendingActionId } = (await linkRes.json()) as {
      pendingActionId: string;
    };

    // Simulate a scenario where pending_action has 5m left even after 35m since chunk creation,
    // and trigger idempotent replay to verify createImportLinks extends chunk.expiresAt to pending.expiresAt.
    await db.execute(sql`
      UPDATE pending_action
      SET created_at = clock_timestamp() - interval '35 minutes',
          expires_at = clock_timestamp() + interval '5 minutes'
      WHERE id = ${pendingActionId}
    `);
    await db.execute(sql`
      UPDATE import_chunk
      SET created_at = clock_timestamp() - interval '35 minutes',
          expires_at = clock_timestamp() - interval '5 minutes'
      WHERE pending_action_id = ${pendingActionId}
    `);

    const replayRes = await mcpRequest(
      app,
      f.fullKey.key,
      `/api/imports/${run.id}/links`,
      {
        method: "POST",
        headers: { ...jsonHeaders, "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ links }),
      },
    );
    expect(replayRes.status).toBe(202);

    await cleanupExpiredImportChunks();

    const approved = await issueStepUpAndApprove(
      app,
      f.user.id,
      pendingActionId,
      "51",
    );
    expect(approved.status, await approved.clone().text()).toBe(200);

    const persistedLinks = await db
      .select()
      .from(schema.importRecordLinkTable)
      .where(eq(schema.importRecordLinkTable.importRunId, run.id));
    expect(persistedLinks).toHaveLength(51);
  });
});
