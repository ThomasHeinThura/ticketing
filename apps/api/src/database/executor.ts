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
 * Convention for repository functions that can take part in a transaction: the executor
 * is the FIRST parameter, named `executor`, typed `Executor`. A function that is only
 * ever called outside a transaction may use the default `db` instead and omit it, or
 * take `executor?: Executor` as its last parameter and resolve it with
 * `executorOrDefault`. Repositories never open or commit a transaction on a handle they
 * were given, and always await their statement and return rows (never a query builder).
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
