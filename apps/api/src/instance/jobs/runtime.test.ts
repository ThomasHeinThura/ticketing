import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../database", () => ({
  default: {
    execute: mocks.execute,
    transaction: (run: (tx: unknown) => unknown) =>
      run({ execute: mocks.execute }),
  },
}));
vi.mock("../../permissions/resolve-identity", () => ({
  resolveIdentity: async () => ({}),
}));
vi.mock("@taskdesk/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/permissions")>()),
  evaluatePolicy: () => ({ allowed: true }),
}));
vi.mock("../../scheduler/repository", () => ({
  claimJobLease: async () => true,
  ownsJobLease: async () => true,
  renewJobLease: async () => true,
  releaseJobLease: mocks.release,
}));

import { startJobRunWorker, stopJobRunWorker } from "./runtime";

afterEach(async () => {
  await stopJobRunWorker();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("stops polling synchronously but drains the manual handler, history and lease release", async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  let finishHandler: (() => void) | undefined;
  let finishRelease: (() => void) | undefined;
  const handler = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishHandler = resolve;
      }),
  );
  mocks.execute.mockImplementation(async (statement) => {
    const query = new PgDialect().sqlToQuery(statement);
    if (query.sql.includes("WHERE trigger = 'manual' AND state = 'queued'")) {
      return {
        rows: [
          { id: "manual-1", name: "example", actorPersonId: "admin-person" },
        ],
      };
    }
    if (query.sql.includes("FROM instance_job_configuration"))
      return { rows: [{ enabled: true }] };
    if (query.sql.includes('SELECT u.id AS "userId"'))
      return { rows: [{ userId: "admin-user" }] };
    if (
      query.sql.includes("UPDATE instance_job_run") &&
      query.params.includes("succeeded")
    )
      events.push("history");
    return { rows: [{ id: "manual-1" }], rowCount: 1 };
  });
  mocks.release.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        events.push("release");
        finishRelease = resolve;
      }),
  );

  startJobRunWorker(() => handler);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(handler).toHaveBeenCalledOnce();
  let drained = false;
  const stopping = Promise.resolve(stopJobRunWorker()).then(() => {
    drained = true;
  });
  try {
    await Promise.resolve();
    expect(drained).toBe(false);
    finishHandler?.();
    await vi.waitFor(() => expect(events).toEqual(["history", "release"]));
    expect(drained).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(handler).toHaveBeenCalledOnce();
    finishRelease?.();
    await stopping;
    expect(drained).toBe(true);
  } finally {
    finishHandler?.();
    finishRelease?.();
    await stopping;
  }
});
