import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import type { createApp } from "../../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "../helpers/agent-authority";
import { mockAnonymousSession } from "../helpers/auth";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "../helpers/fixtures";
import { ensureCreationWorkflow } from "../helpers/workflow";

export type App = ReturnType<typeof createApp>["app"];
const jsonHeaders = { "content-type": "application/json" };

/** One admin user, one workspace with a project, a type, a default state and MCP import keys. */
export async function writerFixture() {
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
        key: `writer-${randomUUID()}`,
        name: "Imported task",
        category: "delivery",
      })
      .returning(),
    "writer work item type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: workspace.id,
        key: `writer-state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "writer state template",
  );
  const defaultState = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: template.id,
        isDefault: true,
      })
      .returning(),
    "writer default state",
  );
  await ensureCreationWorkflow({
    workspaceId: workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.mcp", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
  const fullKey = await createPersonalApiKey(
    { userId: user.id },
    {
      name: "writer full MCP",
      capabilities: [
        "instance:admin",
        "work_item:create",
        "work_item:read",
        "work_item:update",
      ],
      isMcp: true,
    },
  );
  const noAdminKey = await createPersonalApiKey(
    { userId: user.id },
    {
      name: "writer no instance admin MCP",
      capabilities: ["work_item:create", "work_item:read", "work_item:update"],
      isMcp: true,
    },
  );
  const [person] = await db
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id));
  if (!person) throw new Error("writer fixture person missing");
  return {
    user,
    workspace,
    project,
    type,
    defaultState,
    fullKey,
    noAdminKey,
    person,
  };
}
export type WriterFixture = Awaited<ReturnType<typeof writerFixture>>;

export function request(
  app: App,
  key: string,
  path: string,
  init: RequestInit = {},
) {
  mockAnonymousSession();
  const headers = new Headers(init.headers);
  headers.set("x-api-key", key);
  const configured = withConfiguredAgentAuthority(path, { ...init, headers });
  return app.request(configured.input, configured.init);
}

function idempotentJson(method: string, body: unknown) {
  return {
    method,
    headers: { ...jsonHeaders, "Idempotency-Key": randomUUID() },
    body: JSON.stringify(body),
  } satisfies RequestInit;
}

export async function createRun(
  app: App,
  f: WriterFixture,
  sourceRef: string,
  key = f.fullKey.key,
) {
  const response = await request(
    app,
    key,
    "/api/imports",
    idempotentJson("POST", {
      workspaceId: f.workspace.id,
      projectId: f.project.id,
      pluginId: "import.mcp",
      sourceRef,
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: string; version: number };
}

export type CommitResult = {
  kind: string;
  counts: Record<string, number>;
  rows: Array<{
    sourceType: string;
    sourceId: string;
    targetId?: string;
    outcome: string;
    code?: string;
  }>;
  lossCounts?: Record<string, number>;
};

/** Dry-run then execute one chunk; returns both bodies. Fails the test on a non-200. */
export async function commitChunk(
  app: App,
  f: WriterFixture,
  runId: string,
  chunkId: string,
  records: unknown[],
  key = f.fullKey.key,
) {
  const runResponse = await request(app, key, `/api/imports/${runId}`);
  expect(runResponse.status, await runResponse.clone().text()).toBe(200);
  const run = (await runResponse.json()) as { version: number };
  const previewResponse = await request(
    app,
    key,
    `/api/imports/${runId}/dry-run`,
    idempotentJson("POST", {
      chunkId,
      expectedVersion: run.version,
      records,
    }),
  );
  expect(previewResponse.status, await previewResponse.clone().text()).toBe(
    200,
  );
  const preview = (await previewResponse.json()) as {
    previewDigest: string;
    runVersion: number;
    counts: Record<string, number>;
    plan?: Record<string, number>;
  };
  const executeResponse = await request(
    app,
    key,
    `/api/imports/${runId}/records`,
    idempotentJson("POST", {
      chunkId,
      expectedVersion: preview.runVersion,
      records,
      previewDigest: preview.previewDigest,
    }),
  );
  expect(executeResponse.status, await executeResponse.clone().text()).toBe(
    200,
  );
  return {
    preview,
    commit: (await executeResponse.json()) as CommitResult,
  };
}

export function record(
  f: WriterFixture,
  sourceId: string,
  extra: Record<string, unknown> = {},
  title = `Imported ${sourceId}`,
) {
  return {
    sourceType: "issue",
    sourceId,
    item: { typeId: f.type.id, title },
    ...extra,
  };
}

export async function getReport(
  app: App,
  f: WriterFixture,
  runId: string,
): Promise<{
  chunks: Array<{
    chunkId: string;
    counts: Record<string, number>;
    lossCounts?: Record<string, number>;
    losses?: Array<Record<string, string>>;
    plan?: Record<string, number>;
  }>;
}> {
  const response = await request(
    app,
    f.fullKey.key,
    `/api/imports/${runId}/report`,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as never;
}

/** Dry-run only: returns the preview needed to execute the chunk by hand. */
export async function previewChunk(
  app: App,
  f: WriterFixture,
  runId: string,
  chunkId: string,
  records: unknown[],
) {
  const runResponse = await request(
    app,
    f.fullKey.key,
    `/api/imports/${runId}`,
  );
  const run = (await runResponse.json()) as { version: number };
  const response = await request(
    app,
    f.fullKey.key,
    `/api/imports/${runId}/dry-run`,
    idempotentJson("POST", { chunkId, expectedVersion: run.version, records }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as {
    previewDigest: string;
    runVersion: number;
  };
}
