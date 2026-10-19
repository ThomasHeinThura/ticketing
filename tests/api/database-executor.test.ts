import { describe, expect, expectTypeOf, it } from "vitest";
import db, { type DatabaseInstance } from "../../apps/api/src/database";
import {
  type Executor,
  executorOrDefault,
  type Transaction,
} from "../../apps/api/src/database/executor";

describe("database executor contract (#580)", () => {
  it("returns the supplied handle unchanged, whether connection or transaction", () => {
    const connection = {} as DatabaseInstance;
    const transaction = {} as Transaction;

    expect(executorOrDefault(connection)).toBe(connection);
    expect(executorOrDefault(transaction)).toBe(transaction);
  });

  it("falls back to the shared connection only when no handle is supplied", () => {
    expect(executorOrDefault()).toBe(db);
    expect(executorOrDefault(undefined)).toBe(db);
  });

  it("types both the shared connection and a transaction as an Executor", () => {
    expectTypeOf(db).toExtend<Executor>();
    expectTypeOf<Transaction>().toExtend<Executor>();
    expectTypeOf(executorOrDefault).returns.toEqualTypeOf<Executor>();
  });

  it("exposes the query surface repositories use on either handle", () => {
    expectTypeOf<Executor>().toHaveProperty("select");
    expectTypeOf<Executor>().toHaveProperty("insert");
    expectTypeOf<Executor>().toHaveProperty("update");
    expectTypeOf<Executor>().toHaveProperty("delete");
    expectTypeOf<Executor>().toHaveProperty("execute");
    expectTypeOf<Executor>().toHaveProperty("transaction");
  });
});
