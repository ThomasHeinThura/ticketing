import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForSignal<T>(signal: Promise<T>, description: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      signal,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          5_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function nextSubmissionNumber() {
  const result = await db.execute<{ number: string }>(
    sql`SELECT nextval(pg_get_serial_sequence('submission', 'number')) AS number`,
  );
  const value = result.rows[0]?.number;
  if (value === undefined)
    throw new Error("expected submission sequence value");
  return Number(value);
}

function findPostgresSqlState(error: unknown) {
  let current = error;
  const visited = new Set<object>();
  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    if ("code" in current) return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

describe("integration database reset lock acquisition", () => {
  it("rolls back partial locks on a real NOWAIT conflict, then performs a full reset", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember();
    const initialSequenceValues = [
      await nextSubmissionNumber(),
      await nextSubmissionNumber(),
    ];
    expect(initialSequenceValues).toEqual([1, 2]);

    const reader = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const lockProbe = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await reader.connect();
    await lockProbe.connect();
    await reader.query("BEGIN");
    await reader.query('LOCK TABLE "workspace" IN ACCESS SHARE MODE');

    const failedLock = deferred<{ attempt: number; code: unknown }>();
    const continueReset = deferred();
    let reset: Promise<void> | undefined;
    try {
      reset = resetTestDatabase({
        onLockUnavailable: async ({ attempt, error }) => {
          const code = findPostgresSqlState(error);
          if (attempt === 1) {
            failedLock.resolve({ attempt, code });
            await continueReset.promise;
          }
        },
      });
      await expect(
        waitForSignal(failedLock.promise, "a real 55P03 reset lock failure"),
      ).resolves.toEqual({
        attempt: 1,
        code: "55P03",
      });

      // The lock error was observed only after its transaction rolled back. The reset had
      // already attempted the alphabetically earlier account table before reaching workspace.
      await lockProbe.query("BEGIN");
      await lockProbe.query(
        'LOCK TABLE "account" IN ACCESS EXCLUSIVE MODE NOWAIT',
      );
      await lockProbe.query("ROLLBACK");
      const workspace = await db.query.workspaceTable.findFirst({
        where: eq(schema.workspaceTable.id, member.workspace.id),
      });
      expect(workspace?.id).toBe(member.workspace.id);

      continueReset.resolve();
      await reader.query("ROLLBACK");
      await expect(reset).resolves.toBeUndefined();
    } finally {
      continueReset.resolve();
      await reader.query("ROLLBACK").catch(() => {});
      await lockProbe.query("ROLLBACK").catch(() => {});
      await Promise.allSettled(reset ? [reset] : []);
      await reader.end();
      await lockProbe.end();
    }

    expect(
      await db.query.workspaceTable.findFirst({
        where: eq(schema.workspaceTable.id, member.workspace.id),
      }),
    ).toBeUndefined();
    expect(
      await db.query.userTable.findFirst({
        where: eq(schema.userTable.id, member.user.id),
      }),
    ).toBeUndefined();
    expect(await nextSubmissionNumber()).toBe(1);
  }, 20_000);

  it("propagates unrelated test-database guard errors without retrying", async () => {
    const originalUrl = process.env.TASKDESK_DATABASE_URL;
    if (!originalUrl) throw new Error("expected integration database URL");
    const invalidUrl = new URL(originalUrl);
    invalidUrl.pathname = "/taskdesk_prod";
    let lockUnavailableCalls = 0;
    process.env.TASKDESK_DATABASE_URL = invalidUrl.toString();
    try {
      await expect(
        resetTestDatabase({
          onLockUnavailable: () => {
            lockUnavailableCalls += 1;
          },
        }),
      ).rejects.toThrow('Refusing to manage non-test database "taskdesk_prod"');
    } finally {
      process.env.TASKDESK_DATABASE_URL = originalUrl;
    }
    expect(lockUnavailableCalls).toBe(0);
  });

  it("fails clearly after its bounded lock retry budget while preserving rows", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember();
    const reader = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await reader.connect();
    await reader.query("BEGIN");
    await reader.query('LOCK TABLE "workspace" IN ACCESS SHARE MODE');

    let lockUnavailableCalls = 0;
    try {
      await expect(
        resetTestDatabase({
          onLockUnavailable: ({ error }) => {
            lockUnavailableCalls += 1;
            const code = findPostgresSqlState(error);
            expect(code).toBe("55P03");
          },
        }),
      ).rejects.toMatchObject({
        message:
          "Could not acquire all test-reset table locks after 5 attempts",
      });
    } finally {
      await reader.query("ROLLBACK");
      await reader.end();
    }
    expect(lockUnavailableCalls).toBe(5);
    expect(
      await db.query.workspaceTable.findFirst({
        where: eq(schema.workspaceTable.id, member.workspace.id),
      }),
    ).toMatchObject({ id: member.workspace.id });
  }, 20_000);
});
