import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { unregisterImportAdapter } from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { clearFakeFixtures } from "../../../apps/api/src/imports/engine/test-adapter";
import { createApp } from "../../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "../helpers/agent-authority";
import { mockAuthenticatedSession } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/database";
import { seedMockedSessionForStepUp } from "../helpers/step-up";
import {
  call,
  confirmAll,
  dryRunAndExecuteBody,
  engineFixture,
  makeRecords,
  post,
  registerFake,
  req,
  runRow,
  setFakeFixture,
  startRun,
} from "./engine-helpers";

beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
  clearFakeFixtures();
  registerFake(100);
});
afterEach(() => unregisterImportAdapter("import.mcp"));

type F = Awaited<ReturnType<typeof engineFixture>>;
type App = ReturnType<typeof createApp>["app"];
const json = { "content-type": "application/json" };

async function pending(f: F, count: number, id: string) {
  setFakeFixture(id, { records: makeRecords(f.type.key, count) });
  const { app } = createApp();
  const { run, mapping } = await startRun(app, f, id);
  const confirmed = await confirmAll(
    app,
    f.key,
    run.id,
    mapping.mappingVersion,
  );
  const dry = await dryRunAndExecuteBody(app, f.key, run.id);
  return { app, run, confirmed, dry };
}

async function sessionAndToken(app: App, f: F, pendingActionId: string) {
  await seedMockedSessionForStepUp(f.user.id, "p4-test-password");
  const [user] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.id, f.user.id));
  mockAuthenticatedSession({ ...(user as never), role: "admin" });
  const send = (path: string, body: unknown) => {
    const r = withConfiguredAgentAuthority(path, {
      method: "POST",
      headers: json,
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
    password: "p4-test-password",
  });
  expect(proof.status, await proof.clone().text()).toBe(200);
  return ((await proof.json()) as { token: string }).token;
}

function approve(app: App, id: string, token: string, typedCount: string) {
  const r = withConfiguredAgentAuthority(
    `/api/me/pending-actions/${id}/approve`,
    {
      method: "POST",
      headers: {
        ...json,
        "x-taskdesk-step-up-token": token,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ typedCount }),
    },
  );
  return app.request(r.input, r.init);
}

describe("run-level import approval (D2)", () => {
  it("returns pending_approval above 50 writes, approves with the exact count and step-up, then runs", async () => {
    const f = await engineFixture();
    const { app, run, dry } = await pending(f, 60, "approve");
    const requested = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(requested).toMatchObject({ status: "pending_approval" });
    const row = (
      await db
        .select()
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, requested.pendingActionId))
    )[0];
    expect(row).toMatchObject({
      action: "mcp_destructive",
      targetType: "import_run",
      routeKey: "POST /api/imports/{id}/execute",
      confirmationRequired: "typed_count_step_up",
      state: "pending",
    });
    expect(row?.payloadSummary).toMatchObject({
      kind: "import_run",
      totalCount: 60,
      writes: 60,
    });
    // A repeat request returns the same pending action; nothing runs.
    const again = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(again.pendingActionId).toBe(requested.pendingActionId);
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);

    const token = await sessionAndToken(app, f, requested.pendingActionId);
    expect(
      (await approve(app, requested.pendingActionId, token, "59")).status,
    ).toBe(400);
    const ok = await approve(app, requested.pendingActionId, token, "60");
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await runRow(run.id)).toMatchObject({
      approvedDigest: dry.body.dryRunDigest,
      approvedCount: 60,
    });
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);

    const started = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(started.status).toBe("started");
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await db.select().from(schema.workItemTable)).toHaveLength(60);
  });

  it("a mapping change after approval is refused: the approval is cleared and execute needs a new dry run", async () => {
    const f = await engineFixture();
    const { app, run, dry } = await pending(f, 60, "changed");
    const requested = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    const token = await sessionAndToken(app, f, requested.pendingActionId);
    expect(
      (await approve(app, requested.pendingActionId, token, "60")).status,
    ).toBe(200);
    const mapping = await call(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      undefined,
      200,
    );
    const entry = mapping.entries.find(
      (e: { domain: string }) => e.domain === "state",
    );
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      post({
        expectedMappingVersion: mapping.mappingVersion,
        entries: [
          {
            domain: "state",
            value: entry.value,
            target: { kind: "group", group: "started" },
          },
        ],
      }),
      200,
    );
    expect(await runRow(run.id)).toMatchObject({
      approvedDigest: null,
      engineDryRunDigest: null,
    });
    // The stale binding no longer executes.
    expect(
      (await req(app, f.key, `/api/imports/${run.id}/execute`, post(dry.body)))
        .status,
    ).toBe(409);
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
  });

  it("an outstanding request is invalidated by a mapping change, and the next request does not collide", async () => {
    const f = await engineFixture();
    const { app, run, dry } = await pending(f, 60, "invalidate");
    const first = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    const mapping = await call(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      undefined,
      200,
    );
    const entry = mapping.entries.find(
      (e: { domain: string }) => e.domain === "state",
    );
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      post({
        expectedMappingVersion: mapping.mappingVersion,
        entries: [
          {
            domain: "state",
            value: entry.value,
            target: { kind: "group", group: "started" },
          },
        ],
      }),
      200,
    );
    const old = (
      await db
        .select()
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, first.pendingActionId))
    )[0];
    expect(old).toMatchObject({
      state: "invalidated",
      invalidationReason: "version_changed",
    });
    const dry2 = await dryRunAndExecuteBody(app, f.key, run.id);
    const second = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry2.body),
      202,
    );
    expect(second.status).toBe("pending_approval");
    expect(second.pendingActionId).not.toBe(first.pendingActionId);
  });

  it("a run at or below 50 writes starts without approval", async () => {
    const f = await engineFixture();
    const { app, run, dry } = await pending(f, 50, "small");
    const started = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(started.status).toBe("started");
  });
});
