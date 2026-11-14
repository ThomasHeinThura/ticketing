import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  owns: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  evaluate: vi.fn(),
  feature: vi.fn(),
  event: vi.fn(),
}));
vi.mock("../../../apps/api/src/database", async () => ({
  default: {
    execute: mocks.execute,
    select: mocks.select,
    insert: mocks.insert,
    transaction: (run: (tx: unknown) => unknown) =>
      run({
        execute: mocks.execute,
        select: mocks.select,
        insert: mocks.insert,
      }),
  },
  schema: await import("../../../apps/api/src/database/schema"),
}));
vi.mock("../../../apps/api/src/scheduler/repository", () => ({
  claimJobLease: mocks.claim,
  ownsJobLease: mocks.owns,
  releaseJobLease: mocks.release,
  renewJobLease: mocks.renew,
  listTasksNeedingReminder: vi.fn(),
  insertReminderSent: vi.fn(),
}));
vi.mock("../../../apps/api/src/feature-flag/enforce", () => ({
  projectFeatureEnabled: mocks.feature,
}));
vi.mock("../../../apps/api/src/sla-policy/evaluation", () => ({
  evaluateStoredWorkItemSla: mocks.evaluate,
}));
vi.mock("../../../apps/api/src/scheduler/sla-escalation", () => ({
  enqueueSlaEvent: mocks.event,
}));

import { checkIdentityConnectionHealth } from "../../../apps/api/src/identity/connection-health";
import { sweepExpiredImpersonations } from "../../../apps/api/src/instance/impersonation/finish";
import { runScheduledJobWithHistory } from "../../../apps/api/src/instance/jobs/runtime";
import { checkDueDateReminders } from "../../../apps/api/src/scheduler/due-date-reminders";
import { withJobLease } from "../../../apps/api/src/scheduler/leader-lock";
import {
  scanSla,
  scanWorkItemSla,
} from "../../../apps/api/src/scheduler/sla-scan";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue(true);
  mocks.owns.mockResolvedValue(true);
  mocks.release.mockResolvedValue(undefined);
  mocks.renew.mockResolvedValue(true);
  mocks.execute.mockResolvedValue({ rowCount: 1, rows: [] });
});
afterEach(() => vi.useRealTimers());

describe("leased scheduler jobs", () => {
  it("returns empty outcomes without touching the database when held elsewhere", async () => {
    mocks.claim.mockResolvedValue(false);
    await expect(checkDueDateReminders()).resolves.toEqual({ degraded: false });
    await expect(checkIdentityConnectionHealth()).resolves.toEqual({
      checked: 0,
      healthy: 0,
      degraded: 0,
      invalid: 0,
    });
    await expect(sweepExpiredImpersonations()).resolves.toBe(0);
    expect(mocks.claim.mock.calls.map((args) => args[0])).toEqual([
      "due-date-reminders",
      "plugin-health",
      "impersonation-cap",
    ]);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("renews the claimed job lease with its actual owner during a scheduled run", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const running = runScheduledJobWithHistory("example", () =>
      withJobLease(
        "example",
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        () => undefined,
      ),
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.renew).toHaveBeenCalledWith(
      "example",
      mocks.claim.mock.calls[0]?.[1],
      "60 seconds",
      expect.anything(),
    );
    finish?.();
    await running;
  });

  it("deletes the standby history row when another replica owns the lease", async () => {
    mocks.claim.mockResolvedValue(false);
    const handler = vi.fn();
    await runScheduledJobWithHistory("example", () =>
      withJobLease("example", handler, () => "busy"),
    );
    expect(handler).not.toHaveBeenCalled();
    const queries = mocks.execute.mock.calls.map(([statement]) =>
      new PgDialect().sqlToQuery(statement),
    );
    const deletion = queries.find((query) =>
      query.sql.includes("DELETE FROM instance_job_run"),
    );
    expect(deletion?.sql).toContain("state = 'running' AND runner_id =");
    expect(deletion?.params).toHaveLength(2);
    expect(queries.some((query) => query.sql.includes("SET state = $1"))).toBe(
      false,
    );
  });
});

it("reuses the locked SLA item and writes cache only for changed metrics", async () => {
  const item = {
    id: "item",
    projectId: "project",
    slaPolicyVersionId: "policy",
    workspaceId: "workspace",
  };
  const due = new Date("2026-11-14T12:00:00Z");
  const selections = [
    [item],
    [{ id: "project" }],
    [{ metric: "response", state: "ok", dueAt: due }],
  ];
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => {
        const value = selections.shift();
        return Object.assign(Promise.resolve(value), {
          for: async () => value,
        });
      },
    }),
  }));
  mocks.feature.mockResolvedValue(true);
  mocks.execute.mockResolvedValue({ rows: [{ now: "2026-11-14T10:00:00Z" }] });
  mocks.evaluate.mockResolvedValue({
    metrics: [{ metric: "response", state: "ok", dueAt: new Date(due) }],
  });
  await expect(scanWorkItemSla("item")).resolves.toBe(0);
  expect(mocks.evaluate).toHaveBeenCalledWith(
    expect.anything(),
    "item",
    expect.any(Date),
    item,
  );
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.event).not.toHaveBeenCalled();
});

it("filters archived projects in the candidate query", async () => {
  let condition: Parameters<PgDialect["sqlToQuery"]>[0] | undefined;
  const join = vi.fn(() => ({
    where: (value: typeof condition) => {
      condition = value;
      return { orderBy: () => ({ limit: async () => [] }) };
    },
  }));
  mocks.select.mockReturnValue({ from: () => ({ innerJoin: join }) });
  await expect(scanSla()).resolves.toEqual({
    scanned: 0,
    emitted: 0,
    degraded: false,
  });
  expect(join).toHaveBeenCalledOnce();
  expect(
    new PgDialect().sqlToQuery(condition as NonNullable<typeof condition>).sql,
  ).toContain('"project"."archived_at" is null');
});

it("writes a changed SLA state and still emits its transition", async () => {
  const item = {
    id: "item",
    key: "TASK-1",
    projectId: "project",
    slaPolicyVersionId: "policy",
    workspaceId: "workspace",
  };
  const selections = [
    [item],
    [{ id: "project" }],
    [{ metric: "response", state: "ok", dueAt: null }],
  ];
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => {
        const value = selections.shift();
        return Object.assign(Promise.resolve(value), {
          for: async () => value,
        });
      },
    }),
  }));
  const upsert = vi.fn().mockResolvedValue(undefined);
  mocks.insert.mockReturnValue({
    values: () => ({ onConflictDoUpdate: upsert }),
  });
  mocks.feature.mockResolvedValue(true);
  mocks.execute.mockResolvedValue({ rows: [{ now: "2026-11-14T10:00:00Z" }] });
  mocks.evaluate.mockResolvedValue({
    metrics: [
      { metric: "response", state: "at_risk", dueAt: null, consumedPct: 90 },
    ],
  });
  mocks.event.mockResolvedValue(undefined);
  await expect(scanWorkItemSla("item")).resolves.toBe(1);
  expect(upsert).toHaveBeenCalledOnce();
  expect(mocks.event).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ kind: "sla.at_risk" }),
    expect.anything(),
  );
});
