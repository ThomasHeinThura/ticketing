import { Client } from "pg";

/** Keeps a project soft-delete uncommitted until the operation waits on its row lock. */
export async function raceProjectSoftDelete<T>(
  projectId: string,
  operation: () => Promise<T>,
): Promise<{
  blockedOnProjectLock: boolean;
  operation: PromiseSettledResult<T>;
}> {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  await client.connect();

  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const deleted = await client.query(
      "UPDATE project SET deleted_at = now(), purge_after = now() WHERE id = $1",
      [projectId],
    );
    if (deleted.rowCount !== 1) {
      throw new Error("raceProjectSoftDelete: project update matched no row");
    }

    const lockOwner = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const lockOwnerPid = lockOwner.rows[0]?.pid;
    if (lockOwnerPid === undefined) {
      throw new Error("raceProjectSoftDelete: could not read lock owner pid");
    }

    let operationResult: PromiseSettledResult<T> | undefined;
    const pendingOperation = Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          operationResult = { status: "fulfilled", value };
        },
        (reason: unknown) => {
          operationResult = { status: "rejected", reason };
        },
      );

    let blockedOnProjectLock = false;
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      !blockedOnProjectLock &&
      operationResult === undefined
    ) {
      const result = await client.query<{ waiting: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND $1 = ANY(pg_blocking_pids(pid))
          ) AS waiting
        `,
        [lockOwnerPid],
      );
      blockedOnProjectLock = result.rows[0]?.waiting === true;
      if (!blockedOnProjectLock && operationResult === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    await client.query("COMMIT");
    transactionOpen = false;
    await pendingOperation;

    if (operationResult === undefined) {
      throw new Error("raceProjectSoftDelete: operation did not settle");
    }

    return { blockedOnProjectLock, operation: operationResult };
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    await client.end();
  }
}
