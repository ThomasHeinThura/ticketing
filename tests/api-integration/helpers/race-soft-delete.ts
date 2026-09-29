import { Client } from "pg";

type SoftDeleteTarget = {
  table: "project" | "work_item";
  id: string;
};

async function raceSoftDelete<T>(
  target: SoftDeleteTarget,
  operation: () => Promise<T>,
): Promise<{
  blockedOnRowLock: boolean;
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
    const deletion =
      target.table === "project"
        ? "UPDATE project SET deleted_at = now(), purge_after = now() WHERE id = $1"
        : "UPDATE work_item SET deleted_at = now() WHERE id = $1";
    const deleted = await client.query(deletion, [target.id]);
    if (deleted.rowCount !== 1) {
      throw new Error("raceSoftDelete: update matched no row");
    }

    const lockOwner = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const lockOwnerPid = lockOwner.rows[0]?.pid;
    if (lockOwnerPid === undefined) {
      throw new Error("raceSoftDelete: could not read lock owner pid");
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

    let blockedOnRowLock = false;
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      !blockedOnRowLock &&
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
      blockedOnRowLock = result.rows[0]?.waiting === true;
      if (!blockedOnRowLock && operationResult === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    await client.query("COMMIT");
    transactionOpen = false;
    await pendingOperation;

    if (operationResult === undefined) {
      throw new Error("raceSoftDelete: operation did not settle");
    }

    return { blockedOnRowLock, operation: operationResult };
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    await client.end();
  }
}

export function raceProjectSoftDelete<T>(
  projectId: string,
  operation: () => Promise<T>,
) {
  return raceSoftDelete({ table: "project", id: projectId }, operation);
}

export function raceWorkItemSoftDelete<T>(
  workItemId: string,
  operation: () => Promise<T>,
) {
  return raceSoftDelete({ table: "work_item", id: workItemId }, operation);
}
