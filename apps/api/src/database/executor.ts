import db, { type DatabaseInstance } from "./index";

/**
 * Repository executor contract (issue #580, decision D1).
 *
 * Repositories own every statement. A service or controller may open a transaction with
 * `db.transaction(...)`, but each statement inside it must go through a repository
 * function that accepts the handle:
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   const item = await lockWorkItem(tx, key, workspaceId);
 *   await insertActivity(tx, { ... });
 * });
 * ```
 *
 * Convention (same wording as docs/04-engineering/coding-standards.md, "Query ownership"):
 * a repository function that always runs inside a caller's transaction takes
 * `executor: Executor` as its FIRST parameter. A function that is callable both inside and
 * outside a transaction takes `executor?: Executor` as its LAST parameter and resolves it
 * with `executorOrDefault`. A function that never joins a transaction may use the shared
 * `db` directly. Repositories never open or commit a transaction on a handle they were
 * given, and always await their statement and return rows (never a query builder).
 */

/** The transaction handle Drizzle passes to a `db.transaction` callback. */
export type Transaction = Parameters<
  Parameters<DatabaseInstance["transaction"]>[0]
>[0];

/** Anything a repository statement can run against: the shared connection or one transaction. */
export type Executor = DatabaseInstance | Transaction;

/** The handle the caller supplied, or the shared connection when none was. */
export function executorOrDefault(executor?: Executor): Executor {
  return executor ?? db;
}
