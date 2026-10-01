import { Client } from "pg";

type FreezeTarget = {
  table: "project" | "work_item";
  id: string;
  freeze: "delete" | "archive";
};

export async function observesLockBlocker(
  client: Client,
  lockOwnerPid: number,
) {
  // pg_stat_activity's current-query data is cached after its first read in a
  // transaction. This observer intentionally polls inside the transaction
  // holding the row lock, so refresh the snapshot before every poll.
  await client.query("SELECT pg_stat_clear_snapshot()");
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
  return result.rows[0]?.waiting === true;
}

export async function waitForLockBlocker(
  client: Client,
  lockOwnerPid: number,
  shouldStop: () => boolean = () => false,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !shouldStop()) {
    if (await observesLockBlocker(client, lockOwnerPid)) return true;
    if (!shouldStop()) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function raceProjectOrItemFreeze<T>(
  target: FreezeTarget,
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
    const freeze =
      target.freeze === "archive"
        ? target.table === "project"
          ? "UPDATE project SET archived_at = now() WHERE id = $1"
          : "UPDATE work_item SET archived_at = now() WHERE id = $1"
        : target.table === "project"
          ? "UPDATE project SET deleted_at = now(), purge_after = now() WHERE id = $1"
          : "UPDATE work_item SET deleted_at = now() WHERE id = $1";
    const frozen = await client.query(freeze, [target.id]);
    if (frozen.rowCount !== 1) {
      throw new Error("raceProjectOrItemFreeze: update matched no row");
    }

    const lockOwner = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const lockOwnerPid = lockOwner.rows[0]?.pid;
    if (lockOwnerPid === undefined) {
      throw new Error("raceProjectOrItemFreeze: could not read lock owner pid");
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

    const blockedOnRowLock = await waitForLockBlocker(
      client,
      lockOwnerPid,
      () => operationResult !== undefined,
    );

    await client.query("COMMIT");
    transactionOpen = false;
    await pendingOperation;

    if (operationResult === undefined) {
      throw new Error("raceProjectOrItemFreeze: operation did not settle");
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
  return raceProjectOrItemFreeze(
    { table: "project", id: projectId, freeze: "delete" },
    operation,
  );
}

export function raceProjectArchive<T>(
  projectId: string,
  operation: () => Promise<T>,
) {
  return raceProjectOrItemFreeze(
    { table: "project", id: projectId, freeze: "archive" },
    operation,
  );
}

export function raceWorkItemSoftDelete<T>(
  workItemId: string,
  operation: () => Promise<T>,
) {
  return raceProjectOrItemFreeze(
    { table: "work_item", id: workItemId, freeze: "delete" },
    operation,
  );
}

export function raceWorkItemArchive<T>(
  workItemId: string,
  operation: () => Promise<T>,
) {
  return raceProjectOrItemFreeze(
    { table: "work_item", id: workItemId, freeze: "archive" },
    operation,
  );
}
