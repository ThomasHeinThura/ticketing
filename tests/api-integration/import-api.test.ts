import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { seedMockedSessionForStepUp } from "./helpers/step-up";
import { ensureCreationWorkflow } from "./helpers/workflow";

type App = ReturnType<typeof createApp>["app"];
const jsonHeaders = { "content-type": "application/json" };
const fullImportCapabilities = [
  "instance:admin",
  "work_item:create",
  "work_item:read",
  "work_item:update",
];

async function fixture(options: { mcpEnabled?: boolean } = {}) {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, user.id));
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await grantWorkItemProjectAccess(user.id, project.id);

  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: workspace.id,
        key: `import-test-${randomUUID()}`,
        name: "Imported task",
        category: "delivery",
      })
      .returning(),
    "import work item type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: workspace.id,
        key: `import-state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "import state template",
  );
  await db.insert(schema.stateTable).values({
    projectId: project.id,
    stateTemplateId: template.id,
    isDefault: true,
  });
  await ensureCreationWorkflow({
    workspaceId: workspace.id,
    projectId: project.id,
    typeId: type.id,
  });

  if (options.mcpEnabled ?? true) {
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey: "feature.mcp", enabled: true })
      .onConflictDoUpdate({
        target: schema.instanceFeatureFlagTable.featureKey,
        set: { enabled: true },
      });
  }

  const fullKey = await createPersonalApiKey(
    { userId: user.id },
    {
      name: "import integration full MCP",
      capabilities: fullImportCapabilities,
      isMcp: true,
    },
  );
  const limitedKey = await createPersonalApiKey(
    { userId: user.id },
    {
      name: "import integration limited MCP",
      capabilities: ["instance:admin"],
      isMcp: true,
    },
  );
  const noAdminKey = await createPersonalApiKey(
    { userId: user.id },
    {
      name: "import integration no instance admin MCP",
      capabilities: ["work_item:create", "work_item:read", "work_item:update"],
      isMcp: true,
    },
  );
  return { user, workspace, project, type, fullKey, limitedKey, noAdminKey };
}

function request(app: App, key: string, path: string, init: RequestInit = {}) {
  mockAnonymousSession();
  const headers = new Headers(init.headers);
  headers.set("x-api-key", key);
  const configured = withConfiguredAgentAuthority(path, {
    ...init,
    headers,
  });
  return app.request(configured.input, configured.init);
}

function idempotentJson(method: string, body: unknown, key = randomUUID()) {
  return {
    method,
    headers: { ...jsonHeaders, "Idempotency-Key": key },
    body: JSON.stringify(body),
  } satisfies RequestInit;
}

function makeRecords(typeId: string, count: number, prefix = "source") {
  return Array.from({ length: count }, (_, index) => ({
    sourceType: "issue",
    sourceId: `${prefix}-${index + 1}`,
    item: {
      typeId,
      title: `Imported title ${prefix} ${index + 1}`,
      description: `Private source description ${prefix} ${index + 1}`,
    },
  }));
}

async function createRun(
  app: App,
  key: string,
  workspaceId: string,
  projectId: string,
  sourceRef: string,
) {
  const response = await request(
    app,
    key,
    "/api/imports",
    idempotentJson("POST", {
      workspaceId,
      projectId,
      pluginId: "import.mcp",
      sourceRef,
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: string; version: number };
}

async function preview(
  app: App,
  key: string,
  runId: string,
  typeId: string,
  count: number,
  prefix: string,
) {
  const body = {
    chunkId: `chunk-${prefix}`,
    expectedVersion: 1,
    records: makeRecords(typeId, count, prefix),
  };
  const response = await request(
    app,
    key,
    `/api/imports/${runId}/dry-run`,
    idempotentJson("POST", body),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return {
    body: { ...body, expectedVersion: 2 },
    preview: (await response.json()) as {
      previewDigest: string;
      runVersion: number;
      counts: Record<string, number>;
    },
  };
}

async function seedSessionForApproval(userId: string) {
  await seedMockedSessionForStepUp(userId, "p4-test-password");
  const [user] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  if (!user) throw new Error("approval user missing");
  mockAuthenticatedSession({ ...user, role: "admin" });
}

async function pendingActionToken(app: App, pendingActionId: string) {
  const challengeRequest = withConfiguredAgentAuthority(
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ kind: "pending_action", pendingActionId }),
    },
  );
  const challenge = await app.request(
    challengeRequest.input,
    challengeRequest.init,
  );
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const issued = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proofRequest = withConfiguredAgentAuthority("/api/me/step-up", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      kind: "pending_action",
      pendingActionId,
      challengeId: issued.challengeId,
      nonce: issued.nonce,
      method: "password",
      password: "p4-test-password",
    }),
  });
  const proof = await app.request(proofRequest.input, proofRequest.init);
  expect(proof.status, await proof.clone().text()).toBe(200);
  return ((await proof.json()) as { token: string }).token;
}

beforeEach(async () => resetTestDatabase());

describe("MCP import API contract", () => {
  it("conceals import routes while the persisted MCP feature flag is off", async () => {
    const { workspace, project, fullKey } = await fixture({
      mcpEnabled: false,
    });
    const { app } = createApp();
    const response = await request(
      app,
      fullKey.key,
      "/api/imports",
      idempotentJson("POST", {
        workspaceId: workspace.id,
        projectId: project.id,
        pluginId: "import.mcp",
        sourceRef: "feature-disabled",
      }),
    );
    expect(response.status).toBe(404);
    expect(await db.select().from(schema.importRunTable)).toHaveLength(0);
  });

  it("creates idempotently, previews strictly, commits once, and exposes safe run reports", async () => {
    const { user, workspace, project, type, fullKey } = await fixture();
    const { app } = createApp();
    const createBody = {
      workspaceId: workspace.id,
      projectId: project.id,
      pluginId: "import.mcp",
      sourceRef: "source-system-1",
    };
    const createKey = randomUUID();
    const createRequest = idempotentJson("POST", createBody, createKey);
    const first = await request(
      app,
      fullKey.key,
      "/api/imports",
      createRequest,
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const run = (await first.json()) as { id: string; version: number };
    const replay = await request(
      app,
      fullKey.key,
      "/api/imports",
      createRequest,
    );
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(await replay.json()).toMatchObject({ id: run.id });
    expect(
      await db
        .select()
        .from(schema.importRunTable)
        .where(eq(schema.importRunTable.id, run.id)),
    ).toHaveLength(1);

    const changedRetry = await request(
      app,
      fullKey.key,
      "/api/imports",
      idempotentJson(
        "POST",
        { ...createBody, sourceRef: "different-source" },
        createKey,
      ),
    );
    expect(changedRetry.status).toBe(422);

    const list = await request(
      app,
      fullKey.key,
      `/api/imports?workspaceId=${workspace.id}&projectId=${project.id}`,
    );
    expect(list.status, await list.clone().text()).toBe(200);
    expect(await list.json()).toMatchObject({ runs: [{ id: run.id }] });
    const detail = await request(app, fullKey.key, `/api/imports/${run.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: run.id });

    const chunk = await preview(app, fullKey.key, run.id, type.id, 1, "small");
    expect(chunk.preview.counts).toMatchObject({ created: 1, processed: 1 });
    expect(chunk.preview.previewDigest).toMatch(/^[a-f0-9]{64}$/u);
    const incorrect = {
      ...chunk.body,
      records: makeRecords(type.id, 1, "tampered"),
      previewDigest: chunk.preview.previewDigest,
    };
    const stale = await request(
      app,
      fullKey.key,
      `/api/imports/${run.id}/records`,
      idempotentJson("POST", incorrect),
    );
    expect(stale.status).toBe(409);

    const executeBody = {
      ...chunk.body,
      previewDigest: chunk.preview.previewDigest,
    };
    const executeRequest = idempotentJson("POST", executeBody);
    const committed = await request(
      app,
      fullKey.key,
      `/api/imports/${run.id}/records`,
      executeRequest,
    );
    expect(committed.status, await committed.clone().text()).toBe(200);
    expect(await committed.json()).toMatchObject({ kind: "committed" });
    const committedReplay = await request(
      app,
      fullKey.key,
      `/api/imports/${run.id}/records`,
      executeRequest,
    );
    expect(committedReplay.status).toBe(200);
    // A new transport key bypasses the 24-hour middleware cache: the durable chunk
    // must replay even after its execution preview expired and run version advanced.
    await db
      .update(schema.importChunkTable)
      .set({ expiresAt: new Date(Date.now() - 86400_000) })
      .where(eq(schema.importChunkTable.importRunId, run.id));
    const durableReplay = await request(
      app,
      fullKey.key,
      `/api/imports/${run.id}/records`,
      idempotentJson("POST", executeBody),
    );
    expect(durableReplay.status, await durableReplay.clone().text()).toBe(200);
    expect(await durableReplay.json()).toMatchObject({
      kind: "committed",
      counts: { created: 1 },
    });
    const changedDurableReplay = await request(
      app,
      fullKey.key,
      `/api/imports/${run.id}/records`,
      idempotentJson("POST", {
        ...executeBody,
        records: makeRecords(type.id, 1, "changed-durable"),
      }),
    );
    expect(changedDurableReplay.status).toBe(409);

    expect(await db.select().from(schema.workItemTable)).toHaveLength(1);
    expect(await db.select().from(schema.importRecordLinkTable)).toHaveLength(
      1,
    );
    const reportResponse = await request(
      app,
      fullKey.key,
      `/api/imports/${run.id}/report`,
    );
    expect(reportResponse.status).toBe(200);
    const reportText = await reportResponse.text();
    expect(reportText).not.toContain("Private source description");
    expect(reportText).not.toContain("sourceId");
    const report = JSON.parse(reportText) as {
      chunks: Array<{ state: string; counts: Record<string, number> }>;
    };
    expect(report.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "committed",
          counts: {
            created: 1,
            updated: 0,
            skipped: 0,
            rejected: 0,
            processed: 1,
          },
        }),
      ]),
    );

    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.actorId, user.id));
    expect(audits.some((row) => row.action === "import.run")).toBe(true);
    const auditPayloads = JSON.stringify(
      audits.map((row) => ({ before: row.before, after: row.after })),
    );
    expect(auditPayloads).not.toContain("Private source description");
    expect(auditPayloads).not.toContain("Imported title");
  });

  it("preserves import creation and sends a fixed admin notice when its audit append fails", async () => {
    const { user, workspace, project, fullKey } = await fixture();
    const { app } = createApp();

    // Recover only this test's exact DDL names if an earlier interrupted run left them.
    await db.execute(
      sql`DROP TRIGGER IF EXISTS import_api_reject_audit ON audit_log`,
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS import_api_reject_audit()`);
    await db.execute(sql`
      CREATE FUNCTION import_api_reject_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'import.run' THEN
          RAISE EXCEPTION 'test-only import audit rejection';
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await db.execute(sql`
      CREATE TRIGGER import_api_reject_audit
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION import_api_reject_audit()
    `);
    try {
      const sourceRef = "private-audit-source-sentinel";
      const response = await request(
        app,
        fullKey.key,
        "/api/imports",
        idempotentJson("POST", {
          workspaceId: workspace.id,
          projectId: project.id,
          pluginId: "import.mcp",
          sourceRef,
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const run = (await response.json()) as { id: string; sourceRef: string };
      expect(run.sourceRef).toBe(sourceRef);
      expect(
        await db
          .select()
          .from(schema.importRunTable)
          .where(eq(schema.importRunTable.id, run.id)),
      ).toHaveLength(1);

      const alerts = await db
        .select({
          userId: schema.notificationTable.userId,
          title: schema.notificationTable.title,
          content: schema.notificationTable.content,
          type: schema.notificationTable.type,
          eventData: schema.notificationTable.eventData,
        })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "audit_write_failed"));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        userId: user.id,
        title: "An audit write failed",
        content: "An audit write failed during mutation.",
        type: "audit_write_failed",
        eventData: { operation: "mutation" },
      });
      expect(JSON.stringify(alerts)).not.toContain(sourceRef);
      expect(JSON.stringify(alerts)).not.toContain(
        "test-only import audit rejection",
      );
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS import_api_reject_audit ON audit_log`,
      );
      await db.execute(sql`DROP FUNCTION IF EXISTS import_api_reject_audit()`);
    }
  });

  it("enforces project reach and the MCP key's stored capability subset", async () => {
    const { workspace, project, fullKey, limitedKey, noAdminKey } =
      await fixture();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherProject = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const { app } = createApp();

    const outside = await request(
      app,
      fullKey.key,
      "/api/imports",
      idempotentJson("POST", {
        workspaceId: other.workspace.id,
        projectId: otherProject.project.id,
        pluginId: "import.mcp",
        sourceRef: "foreign-project",
      }),
    );
    // The owner's instance-admin role gives global reach, but it does not supply
    // work_item:create authority in this other workspace. The route reaches the
    // capability decision and refuses with 403 rather than treating this as no reach.
    expect(outside.status).toBe(403);

    const mismatchedBinding = await request(
      app,
      fullKey.key,
      "/api/imports",
      idempotentJson("POST", {
        workspaceId: workspace.id,
        projectId: otherProject.project.id,
        pluginId: "import.mcp",
        sourceRef: "workspace-project-mismatch",
      }),
    );
    expect(mismatchedBinding.status).toBe(404);

    const limited = await request(
      app,
      limitedKey.key,
      "/api/imports",
      idempotentJson("POST", {
        workspaceId: workspace.id,
        projectId: project.id,
        pluginId: "import.mcp",
        sourceRef: "limited-key",
      }),
    );
    expect(limited.status).toBe(403);

    const keyWithoutAdmin = await request(
      app,
      noAdminKey.key,
      "/api/imports",
      idempotentJson("POST", {
        workspaceId: workspace.id,
        projectId: project.id,
        pluginId: "import.mcp",
        sourceRef: "missing-instance-admin",
      }),
    );
    expect(keyWithoutAdmin.status).toBe(403);
    expect(await db.select().from(schema.importRunTable)).toHaveLength(0);
  });

  it("stages large record chunks without targets, then requires exact count and real step-up", async () => {
    const { user, workspace, project, type, fullKey } = await fixture();
    const { app } = createApp();
    const run = await createRun(
      app,
      fullKey.key,
      workspace.id,
      project.id,
      "large-record-source",
    );
    const chunk = await preview(app, fullKey.key, run.id, type.id, 51, "large");
    const executeBody = {
      ...chunk.body,
      previewDigest: chunk.preview.previewDigest,
    };
    const largeCommitRequest = idempotentJson("POST", executeBody);
    const staged = await request(
      app,
      fullKey.key,
      `/api/imports/${run.id}/records`,
      largeCommitRequest,
    );
    expect(staged.status, await staged.clone().text()).toBe(202);
    const pending = (await staged.json()) as {
      kind: string;
      pendingActionId: string;
      chunkId: string;
    };
    expect(pending.kind).toBe("pending_approval");
    const stagedReplay = await request(
      app,
      fullKey.key,
      `/api/imports/${run.id}/records`,
      largeCommitRequest,
    );
    expect(stagedReplay.status).toBe(202);
    expect(await stagedReplay.json()).toMatchObject({
      pendingActionId: pending.pendingActionId,
    });
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
    expect(await db.select().from(schema.importRecordLinkTable)).toHaveLength(
      0,
    );
    const approvalRows = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    const approval = requireRow(approvalRows, "large import approval");
    expect(approval.payloadSummary).toEqual({
      kind: "mcp_import_chunk",
      operation: "records",
      recordCount: 51,
      pluginId: "import.mcp",
    });
    expect(JSON.stringify(approval)).not.toContain(
      "Private source description",
    );
    expect(JSON.stringify(approval)).not.toContain("Imported title");

    await seedSessionForApproval(user.id);
    const token = await pendingActionToken(app, pending.pendingActionId);
    const wrongCountRequest = withConfiguredAgentAuthority(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { ...jsonHeaders, "x-taskdesk-step-up-token": token },
        body: JSON.stringify({ typedCount: "50" }),
      },
    );
    const wrongCount = await app.request(
      wrongCountRequest.input,
      wrongCountRequest.init,
    );
    expect(wrongCount.status).toBe(400);
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);

    const approveRequest = withConfiguredAgentAuthority(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          ...jsonHeaders,
          "x-taskdesk-step-up-token": token,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ typedCount: "51" }),
      },
    );
    const approved = await app.request(
      approveRequest.input,
      approveRequest.init,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    const approvedBody = (await approved.json()) as { state?: string };
    expect(approvedBody.state).toBe("executed");
    expect(await db.select().from(schema.workItemTable)).toHaveLength(51);
    expect(await db.select().from(schema.importRecordLinkTable)).toHaveLength(
      51,
    );
    const chunks = await db
      .select()
      .from(schema.importChunkTable)
      .where(eq(schema.importChunkTable.importRunId, run.id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.state).toBe("committed");

    // A large identity-link batch has its own exact server-side binding and is also
    // staged without writing any link rows until an elevated owner approves it.
    const [target] = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .limit(1);
    if (!target)
      throw new Error("approved import did not create target work items");
    const linkRun = await createRun(
      app,
      fullKey.key,
      workspace.id,
      project.id,
      "large-link-source",
    );
    const linkEntries = Array.from({ length: 51 }, (_, index) => ({
      sourceType: "issue",
      sourceId: `linked-source-${index + 1}`,
      targetType: "work_item" as const,
      targetId: target.id,
    }));
    const linkRequest = idempotentJson("POST", { links: linkEntries });
    const stagedLinks = await request(
      app,
      fullKey.key,
      `/api/imports/${linkRun.id}/links`,
      linkRequest,
    );
    expect(stagedLinks.status, await stagedLinks.clone().text()).toBe(202);
    const linkPending = (await stagedLinks.json()) as {
      kind: string;
      pendingActionId: string;
    };
    expect(linkPending.kind).toBe("pending_approval");
    const stagedLinksReplay = await request(
      app,
      fullKey.key,
      `/api/imports/${linkRun.id}/links`,
      linkRequest,
    );
    expect(stagedLinksReplay.status).toBe(202);
    expect(await stagedLinksReplay.json()).toMatchObject({
      pendingActionId: linkPending.pendingActionId,
    });
    expect(await db.select().from(schema.importRecordLinkTable)).toHaveLength(
      51,
    );
    const linkApprovalRows = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, linkPending.pendingActionId));
    const linkApproval = requireRow(linkApprovalRows, "large link approval");
    expect(linkApproval.payloadSummary).toEqual({
      kind: "mcp_import_chunk",
      operation: "links",
      recordCount: 51,
      pluginId: "import.mcp",
    });
    expect(JSON.stringify(linkApproval)).not.toContain("linked-source");

    // API-key requests deliberately clear the mocked browser session. Restore
    // the same persisted owner session before requesting its fresh human proof.
    mockAuthenticatedSession({ ...user, role: "admin" });
    const linkToken = await pendingActionToken(
      app,
      linkPending.pendingActionId,
    );
    const linkApproveRequest = withConfiguredAgentAuthority(
      `/api/me/pending-actions/${linkPending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          ...jsonHeaders,
          "x-taskdesk-step-up-token": linkToken,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ typedCount: "51" }),
      },
    );
    const linkApproved = await app.request(
      linkApproveRequest.input,
      linkApproveRequest.init,
    );
    expect(linkApproved.status, await linkApproved.clone().text()).toBe(200);
    expect(await db.select().from(schema.importRecordLinkTable)).toHaveLength(
      102,
    );
  });
});
