import { DEFAULT_ROLE_NAMES, defaultRolePayloads } from "@taskdesk/permissions";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, database } = vi.hoisted(() => {
  const state = {
    workspaceRows: [] as Array<{ id: string }>,
    existingRoleRows: [] as Array<{ workspaceId: string; role: string }>,
    healedRows: [] as Array<{ id: string }>,
    selects: [] as Array<{
      projection: unknown;
      table?: unknown;
      where?: unknown;
    }>,
    updates: [] as Array<{ table?: unknown; set?: unknown; where?: unknown }>,
    inserts: [] as Array<{
      table?: unknown;
      values?: unknown;
      conflictTarget?: unknown;
    }>,
    tableExists: true,
  };

  const database = {
    execute: vi.fn(async () => ({ rows: [{ exists: state.tableExists }] })),
    select: vi.fn((projection: unknown) => {
      const call: (typeof state.selects)[number] = { projection };
      state.selects.push(call);
      return {
        from(table: unknown) {
          call.table = table;
          if (state.selects.length === 1) {
            return Promise.resolve(state.workspaceRows);
          }
          return {
            where(condition: unknown) {
              call.where = condition;
              return Promise.resolve(state.existingRoleRows);
            },
          };
        },
      };
    }),
    update: vi.fn((table: unknown) => {
      const call: (typeof state.updates)[number] = { table };
      state.updates.push(call);
      return {
        set(values: unknown) {
          call.set = values;
          return {
            where(condition: unknown) {
              call.where = condition;
              return {
                returning: async () => state.healedRows,
              };
            },
          };
        },
      };
    }),
    insert: vi.fn((table: unknown) => {
      const call: (typeof state.inserts)[number] = { table };
      state.inserts.push(call);
      return {
        values(values: unknown) {
          call.values = values;
          return {
            onConflictDoNothing(options: { target: unknown }) {
              call.conflictTarget = options.target;
              return Promise.resolve();
            },
          };
        },
      };
    }),
  };

  return { state, database };
});

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  return { default: database, schema };
});

import db, { schema } from "../../../apps/api/src/database";
import {
  listAllWorkspaceIds,
  listWorkspaceRoleKeys,
} from "../../../apps/api/src/utils/repository";
import { seedDefaultWorkspaceRoles } from "../../../apps/api/src/utils/seed-default-workspace-roles";

const dialect = new PgDialect();

function queryExecutor(rows: unknown[]) {
  const calls: Array<{
    projection?: unknown;
    table?: unknown;
    where?: unknown;
  }> = [];
  const executor = {
    select: vi.fn((projection: unknown) => {
      const call: (typeof calls)[number] = { projection };
      calls.push(call);
      return {
        from(table: unknown) {
          call.table = table;
          if (table === schema.workspaceTable) return Promise.resolve(rows);
          return {
            where(condition: unknown) {
              call.where = condition;
              return Promise.resolve(rows);
            },
          };
        },
      };
    }),
  };
  return { calls, executor };
}

beforeEach(() => {
  state.workspaceRows = [];
  state.existingRoleRows = [];
  state.healedRows = [];
  state.selects = [];
  state.updates = [];
  state.inserts = [];
  state.tableExists = true;
  vi.clearAllMocks();
});

describe("default workspace role query ownership", () => {
  it("reads workspace IDs through the supplied executor", async () => {
    const rows = [{ id: "workspace-1" }, { id: "workspace-2" }];
    const harness = queryExecutor(rows);

    await expect(listAllWorkspaceIds(harness.executor as never)).resolves.toBe(
      rows,
    );

    expect(harness.executor.select).toHaveBeenCalledOnce();
    const [call] = harness.calls;
    if (!call) throw new Error("workspace query was not recorded");
    expect((call.projection as { id: unknown }).id).toBe(
      schema.workspaceTable.id,
    );
    expect(call.table).toBe(schema.workspaceTable);
    expect(call.where).toBeUndefined();
  });

  it("filters role keys by workspace IDs and default-role names", async () => {
    const workspaceIds = ["workspace-1", "workspace-2"];
    const roles = [...DEFAULT_ROLE_NAMES];
    const rows = [{ workspaceId: "workspace-1", role: "viewer" }];
    const harness = queryExecutor(rows);

    await expect(
      listWorkspaceRoleKeys(harness.executor as never, workspaceIds, roles),
    ).resolves.toBe(rows);

    expect(harness.executor.select).toHaveBeenCalledOnce();
    const [call] = harness.calls;
    if (!call) throw new Error("workspace-role query was not recorded");
    const projection = call.projection as {
      workspaceId: unknown;
      role: unknown;
    };
    expect(projection.workspaceId).toBe(schema.workspaceRoleTable.workspaceId);
    expect(projection.role).toBe(schema.workspaceRoleTable.role);
    expect(call.table).toBe(schema.workspaceRoleTable);
    expect(dialect.sqlToQuery(call.where as never).params).toEqual([
      ...workspaceIds,
      ...roles,
    ]);
  });

  it("stops after the workspace query when no workspaces exist", async () => {
    await seedDefaultWorkspaceRoles();

    expect(db.select).toHaveBeenCalledOnce();
    expect(state.inserts).toHaveLength(0);
    expect(state.updates[0]?.set).toEqual({ isSystem: true });
  });

  it("does not insert defaults when every workspace role already exists", async () => {
    state.workspaceRows = [{ id: "workspace-1" }];
    state.existingRoleRows = DEFAULT_ROLE_NAMES.map((role) => ({
      workspaceId: "workspace-1",
      role,
    }));

    await seedDefaultWorkspaceRoles();

    expect(state.inserts).toHaveLength(0);
    expect(state.updates[0]?.set).toEqual({ isSystem: true });
    expect(dialect.sqlToQuery(state.updates[0]?.where as never).params).toEqual(
      [...DEFAULT_ROLE_NAMES, false],
    );
  });

  it("preserves large startup batches and the existing conflict target", async () => {
    state.workspaceRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `workspace-${index + 1}`,
    }));

    await seedDefaultWorkspaceRoles();

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(state.updates[0]?.table).toBe(schema.workspaceRoleTable);
    expect(state.updates[0]?.set).toEqual({ isSystem: true });
    expect(dialect.sqlToQuery(state.updates[0]?.where as never).params).toEqual(
      [...DEFAULT_ROLE_NAMES, false],
    );
    expect(state.selects[0]?.table).toBe(schema.workspaceTable);
    expect(state.selects[1]?.table).toBe(schema.workspaceRoleTable);
    const roleQueryParams = dialect.sqlToQuery(
      state.selects[1]?.where as never,
    ).params;
    expect(roleQueryParams.slice(0, state.workspaceRows.length)).toEqual(
      state.workspaceRows.map((workspace) => workspace.id),
    );
    expect(roleQueryParams.slice(-DEFAULT_ROLE_NAMES.length)).toEqual(
      DEFAULT_ROLE_NAMES,
    );
    expect(
      state.inserts.map((insert) => (insert.values as unknown[]).length),
    ).toEqual([1000, 1000, 1000, 3]);
    expect(
      state.inserts.every(
        (insert) => insert.table === schema.workspaceRoleTable,
      ),
    ).toBe(true);
    for (const insert of state.inserts) {
      const conflictTarget = insert.conflictTarget as unknown[];
      expect(conflictTarget[0]).toBe(schema.workspaceRoleTable.workspaceId);
      expect(conflictTarget[1]).toBe(schema.workspaceRoleTable.role);
    }
    const insertedRows = state.inserts.flatMap(
      (insert) =>
        insert.values as Array<{
          workspaceId: string;
          role: string;
          permission: string;
          isSystem: boolean;
        }>,
    );
    expect(insertedRows).toHaveLength(1001 * DEFAULT_ROLE_NAMES.length);
    expect(insertedRows.slice(0, DEFAULT_ROLE_NAMES.length)).toEqual(
      DEFAULT_ROLE_NAMES.map((role) => ({
        workspaceId: "workspace-1",
        role,
        permission: JSON.stringify(defaultRolePayloads[role]),
        isSystem: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })),
    );
  });
});
