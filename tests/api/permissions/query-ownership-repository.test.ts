import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../apps/api/src/database")>();
  return { ...actual, default: {} };
});
vi.mock("@taskdesk/domain", () => ({
  evaluateApprovalWithdrawalDecision: vi.fn(),
}));

import { isActiveInstanceAdmin } from "../../../apps/api/src/approval/repository";
import { schema } from "../../../apps/api/src/database";

const dialect = new PgDialect();

function queryHarness(
  rowsForSelect: (index: number) => unknown[],
  resolveAtWhere = false,
) {
  const calls: {
    from?: unknown;
    joins: Array<{ table: unknown; condition: unknown }>;
    where?: unknown;
    limit?: number;
    whereConditions: unknown[];
    inserts: Array<{ values: unknown; conflictTarget?: unknown }>;
  } = { joins: [], whereConditions: [], inserts: [] };
  let selectCount = 0;
  const executor = {
    select: vi.fn(() => {
      const rows = rowsForSelect(selectCount++);
      const builder = {
        from(table: unknown) {
          calls.from = table;
          return builder;
        },
        innerJoin(table: unknown, condition: unknown) {
          calls.joins.push({ table, condition });
          return builder;
        },
        where(condition: unknown) {
          calls.where = condition;
          calls.whereConditions.push(condition);
          return resolveAtWhere ? Promise.resolve(rows) : builder;
        },
        limit(value: number) {
          calls.limit = value;
          return Promise.resolve(rows);
        },
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values(values: unknown) {
        const insert = { values } as {
          values: unknown;
          conflictTarget?: unknown;
        };
        calls.inserts.push(insert);
        return {
          onConflictDoNothing(options: { target: unknown }) {
            insert.conflictTarget = options.target;
            return Promise.resolve();
          },
        };
      },
    })),
  };
  return {
    calls,
    executor,
  };
}

describe("repository-owned approval reads", () => {
  it("rechecks active staff admin status using the supplied transaction", async () => {
    const harness = queryHarness(() => [{ id: "admin-user" }]);

    const result = await isActiveInstanceAdmin(
      harness.executor as never,
      "admin-user",
    );

    expect(result).toBe(true);
    expect(harness.executor.select).toHaveBeenCalledOnce();
    expect(harness.calls.from).toBe(schema.userTable);
    expect(harness.calls.joins[0]?.table).toBe(schema.personTable);
    expect(
      dialect.sqlToQuery(harness.calls.joins[0]?.condition as never).params,
    ).toEqual(["staff", true]);
    expect(dialect.sqlToQuery(harness.calls.where as never).params).toEqual([
      "admin-user",
      "admin",
    ]);
    expect(harness.calls.limit).toBe(1);
  });

  it("rejects users without an active staff-admin row", async () => {
    const harness = queryHarness(() => []);

    const result = await isActiveInstanceAdmin(
      harness.executor as never,
      "inactive-user",
    );

    expect(result).toBe(false);
    expect(dialect.sqlToQuery(harness.calls.where as never).params).toEqual([
      "inactive-user",
      "admin",
    ]);
  });
});
