import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { importRunTable } from "../../../apps/api/src/database/schema-imports";
import type { SourceRecord } from "../../../apps/api/src/imports/engine/adapter";
import { registerImportAdapter } from "../../../apps/api/src/imports/engine/adapter";
import { grantRunApproval } from "../../../apps/api/src/imports/engine/service";
import { runSetupJob } from "../../../apps/api/src/imports/engine/setup-job";
import {
  createFakeAdapter,
  setFakeFixture,
} from "../../../apps/api/src/imports/engine/test-adapter";
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
export const jsonHeaders = { "content-type": "application/json" };
const capabilities = [
  "instance:admin",
  "work_item:create",
  "work_item:read",
  "work_item:update",
];

export async function seedProject(workspaceId: string, userId: string) {
  const { project } = await createProjectFixture({ workspaceId });
  await grantWorkItemProjectAccess(userId, project.id);
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `eng-${randomUUID()}`,
        name: "Engine task",
        category: "delivery",
      })
      .returning(),
    "engine type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `eng-state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "engine state template",
  );
  await db.insert(schema.stateTable).values({
    projectId: project.id,
    stateTemplateId: template.id,
    isDefault: true,
  });
  await ensureCreationWorkflow({
    workspaceId,
    projectId: project.id,
    typeId: type.id,
  });
  return { project, type };
}

export async function engineFixture() {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, user.id));
  const { project, type } = await seedProject(workspace.id, user.id);
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.mcp", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
  const key = await createPersonalApiKey(
    { userId: user.id },
    { name: "engine full MCP", capabilities, isMcp: true },
  );
  return { user, workspace, project, type, key: key.key, keyId: key.id };
}

export function req(
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

export const post = (body?: unknown, idempotencyKey: string = randomUUID()) =>
  ({
    method: "POST",
    headers: { ...jsonHeaders, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body ?? {}),
  }) satisfies RequestInit;

// biome-ignore lint/suspicious/noExplicitAny: loose JSON bodies in assertions
export async function call<T = Record<string, any>>(
  app: App,
  key: string,
  path: string,
  init: RequestInit | undefined,
  expected: number,
): Promise<T> {
  const response = await req(app, key, path, init);
  const text = await response.clone().text();
  expect(response.status, text).toBe(expected);
  return (await response.json()) as T;
}

export function makeRecords(
  typeKey: string,
  count: number,
  options: { state?: (index: number) => string; prefix?: string } = {},
): SourceRecord[] {
  const prefix = options.prefix ?? "SRC";
  return Array.from({ length: count }, (_, index) => ({
    sourceType: "issue",
    sourceId: `${prefix}-${index + 1}`,
    sourceUrl: `https://source.example.test/browse/${prefix}-${index + 1}`,
    title: `Imported ${prefix} ${index + 1}`,
    description: `Imported description ${index + 1}`,
    facets: [
      { domain: "type" as const, value: typeKey },
      { domain: "state" as const, value: options.state?.(index) ?? "Backlog" },
    ],
  }));
}

export function registerFake(chunkSize: number) {
  registerImportAdapter("import.mcp", () =>
    createFakeAdapter("import.mcp", chunkSize),
  );
}

export { setFakeFixture };

/**
 * A setup step (discovery, whole-run dry run) is a background job: the POST answers 202 and the work
 * happens in the worker. Tests run with the post-request kick off, so this drives the worker the way
 * the kick would, then reads the job's final state from the engine DTO.
 */
export async function runSetupStep(
  app: App,
  key: string,
  runId: string,
  step: "discover" | "dry-run-all",
  options: { expectFailure?: string } = {},
) {
  const accepted = await call(
    app,
    key,
    `/api/imports/${runId}/${step}`,
    post(),
    202,
  );
  expect(["accepted", "running"]).toContain(accepted.status);
  await runSetupJob(runId);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const engine = await call(
      app,
      key,
      `/api/imports/${runId}/engine`,
      undefined,
      200,
    );
    if (engine.job && engine.job.status !== "running") {
      if (options.expectFailure === undefined)
        expect(engine.job, JSON.stringify(engine.job)).toMatchObject({
          status: "completed",
        });
      else
        expect(engine.job).toMatchObject({
          status: "failed",
          failure: options.expectFailure,
        });
      return engine;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("setup job did not finish");
}

/** Discovery, then the saved mapping (what the synchronous discover used to return). */
export async function discoverAndWait(app: App, key: string, runId: string) {
  await runSetupStep(app, key, runId, "discover");
  return call(app, key, `/api/imports/${runId}/mapping`, undefined, 200);
}

/** Whole-run dry run, then its report. */
export async function dryRunAndWait(app: App, key: string, runId: string) {
  await runSetupStep(app, key, runId, "dry-run-all");
  return call(app, key, `/api/imports/${runId}/dry-run-all`, undefined, 200);
}

/** Source + run + discover for a fixture id. Returns ids and the discovered mapping. */
export async function startRun(
  app: App,
  f: { key: string; workspace: { id: string }; project: { id: string } },
  fixtureId: string,
  sourceRef = fixtureId,
) {
  const source = await call(
    app,
    f.key,
    "/api/import-sources",
    post({
      workspaceId: f.workspace.id,
      pluginId: "import.mcp",
      name: `${sourceRef}-${randomUUID()}`,
      config: { fixture: fixtureId },
      credential: "fixture-secret-credential",
    }),
    200,
  );
  const run = await call(
    app,
    f.key,
    `/api/import-sources/${source.id}/runs`,
    post({ projectId: f.project.id, sourceRef }),
    200,
  );
  const mapping = await discoverAndWait(app, f.key, run.id);
  return { source, run, mapping };
}

export async function confirmAll(
  app: App,
  key: string,
  runId: string,
  mappingVersion: number,
) {
  return call(
    app,
    key,
    `/api/imports/${runId}/mapping`,
    post({
      expectedMappingVersion: mappingVersion,
      entries: [],
      confirmProposals: true,
    }),
    200,
  );
}

export async function dryRunAndExecuteBody(
  app: App,
  key: string,
  runId: string,
) {
  const report = await dryRunAndWait(app, key, runId);
  return {
    report,
    body: {
      dryRunDigest: report.digest as string,
      mappingVersion: report.mappingVersion as number,
      totalCount: report.counts.processed as number,
    },
  };
}

export async function runRow(runId: string) {
  return requireRow(
    await db.select().from(importRunTable).where(eq(importRunTable.id, runId)),
    "run row",
  );
}

type PendingFixture = {
  user: { id: string };
  workspace: { id: string };
  project: { id: string };
  keyId: string;
};

/** Simulates the run-level pending action having been requested and executed. */
export async function requestPending(f: PendingFixture, runId: string) {
  const person = (
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, f.user.id))
  )[0];
  const pending = requireRow(
    await db
      .insert(schema.pendingActionTable)
      .values({
        requestedByPersonId: person?.id ?? "unknown",
        credentialType: "api_key",
        credentialId: f.keyId,
        origin: "mcp",
        action: "mcp_destructive",
        targetType: "import_run",
        targetIds: [runId],
        payload: {},
        routeKey: "POST /api/imports/{id}/execute",
        payloadHash: "0".repeat(64),
        payloadSummary: {},
        workspaceId: f.workspace.id,
        projectId: f.project.id,
        confirmationRequired: "typed_count_step_up",
        state: "executed",
        expiresAt: new Date(Date.now() + 3_600_000),
        traceId: randomUUID(),
      })
      .returning(),
    "pending action",
  );
  await db
    .update(importRunTable)
    .set({ approvalPendingActionId: pending.id })
    .where(eq(importRunTable.id, runId));
  return pending;
}

/** The pending action's executor calling the grant hook with the exact binding. */
export async function grantExecutedApproval(
  f: PendingFixture,
  runId: string,
  binding: { digest: string; totalCount: number; mappingVersion: number },
) {
  const pending = await requestPending(f, runId);
  await db.transaction((tx) =>
    grantRunApproval(tx, { runId, pendingActionId: pending.id, ...binding }),
  );
  return pending;
}
