/**
 * PTM-04 field intent at the controller: the update writes only the base fields it was given, and
 * everything about the key (PR-13, live clash, permanent claim, claim write) runs only when a
 * slug was sent. The row lock and PR-9 are unchanged. A recording stand-in
 * for the transaction keeps this offline; the real-database interleavings are in
 * `tests/api-integration/project-field-intent.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  results: {} as Record<string, Row[][]>,
  statements: [] as Array<{ op: string; table: string; values?: Row }>,
}));

vi.mock("../../../apps/api/src/database", () => {
  const nameOf = (table: unknown) =>
    (table as { __name?: string }).__name ?? "unknown";
  const chain = (op: string, table: string) => {
    const link: Record<string, unknown> = {};
    const record = (values?: Row) =>
      state.statements.push({ op, table, ...(values ? { values } : {}) });
    const next = () => (state.results[table] ?? []).shift() ?? [];
    for (const method of ["where", "for", "onConflictDoNothing"])
      link[method] = () => link;
    // The statements end in `limit` or `returning`, which answer with the queued rows.
    for (const method of ["limit", "returning"])
      link[method] = () => Promise.resolve(next());
    link.set = (values: Row) => {
      record(values);
      return link;
    };
    link.values = (values: Row) => {
      record(values);
      return link;
    };
    return link;
  };
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        state.statements.push({ op: "select", table: nameOf(table) });
        return chain("select", nameOf(table));
      },
    }),
    update: (table: unknown) => chain("update", nameOf(table)),
    insert: (table: unknown) => chain("insert", nameOf(table)),
  };
  return {
    default: { transaction: async (run: (t: typeof tx) => unknown) => run(tx) },
  };
});
vi.mock("../../../apps/api/src/database/schema", () => ({
  projectTable: Object.assign(
    { id: "id", slug: "slug", workspaceId: "workspaceId", deletedAt: "d" },
    { __name: "project" },
  ),
  projectSlugClaimTable: Object.assign(
    { slug: "slug", projectId: "projectId" },
    { __name: "claim" },
  ),
  workspaceTable: Object.assign(
    { id: "id", defaultServiceCalendarId: "cal" },
    { __name: "workspace" },
  ),
}));
vi.mock("../../../apps/api/src/utils/is-unique-violation", () => ({
  isUniqueViolation: () => false,
}));
vi.mock("../../../apps/api/src/project/controllers/create-project", () => ({
  ProjectSlugTakenError: class ProjectSlugTakenError extends Error {},
}));
vi.mock("../../../apps/api/src/project/effective-settings", () => ({
  resolveProjectServiceCalendarId: ({
    overrideId,
    workspaceDefaultId,
  }: {
    overrideId: string | null;
    workspaceDefaultId: string | null;
  }) => overrideId ?? workspaceDefaultId,
}));

import updateProjectWithActor from "../../../apps/api/src/project/controllers/update-project";

vi.mock("../../../apps/api/src/events/audit-savepoint", () => ({
  appendAuditSavepoint: async () => false,
}));
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({ notifyCurrentInstanceAdminsOfAuditFailure: async () => {} }),
);

type UpdateArgs = Parameters<typeof updateProjectWithActor>;
const actor = { actorId: "u1", actorType: "person" } as UpdateArgs[7];
// Field-intent cases do not assert audit; the History API tests own that.
type FieldArgs = [
  UpdateArgs[0],
  UpdateArgs[1],
  UpdateArgs[2],
  UpdateArgs[3],
  UpdateArgs[4],
  UpdateArgs[5],
  UpdateArgs[6],
];
const updateProject = (...args: FieldArgs) =>
  updateProjectWithActor(...args, actor);

const stored = {
  id: "p1",
  name: "Old name",
  icon: "Layout",
  slug: "OLD",
  description: "old",
  kind: "project",
  supportLevel: null,
  serviceCalendarId: null,
  serviceCalendarMode: "inherit",
  defaultCommentVisibility: "public",
  managerId: null,
  startDate: null,
  endDate: null,
  defaultAssigneeId: null,
  organisationId: null,
};

// `withSlug`: the project reads are the locked row, then (only when a slug is sent) the live
// clash read, then the update's returning row.
function seed(updated: Row, withSlug = false) {
  state.results = {
    workspace: [[{ id: "w1", defaultServiceCalendarId: null }]],
    project: withSlug
      ? [[{ ...stored }], [], [updated]]
      : [[{ ...stored }], [updated]],
    claim: [[], [{ projectId: "p1" }]],
  };
}
const queued = (table: string) => state.results[table] as Row[][];
async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { status?: number; constructor: { name: string } };
  }
  throw new Error("expected the update to be refused");
}
const setValues = () =>
  state.statements.find((s) => s.op === "update" && s.values)?.values;
const touched = (op: string, table: string) =>
  state.statements.filter((s) => s.op === op && s.table === table).length;

beforeEach(() => {
  state.results = {};
  state.statements = [];
});

describe("update project controller: field intent (PTM-04)", () => {
  it("writes only the supplied base fields and skips the whole key block when no slug is sent", async () => {
    seed({ ...stored, description: "new" });
    await updateProject("p1", undefined, undefined, undefined, "new", "w1", {});
    expect(setValues()).toEqual({ description: "new" });
    // Only the locked project read: no clash read, no claim read, no claim write.
    expect(touched("select", "project")).toBe(1);
    expect(touched("select", "claim")).toBe(0);
    expect(touched("insert", "claim")).toBe(0);
  });

  it("does not rewrite a stored legacy key when it is not sent", async () => {
    seed({ ...stored, name: "Renamed" });
    queued("project")[0] = [{ ...stored, slug: "legacy-key" }];
    await updateProject(
      "p1",
      "Renamed",
      undefined,
      undefined,
      undefined,
      "w1",
      {},
    );
    expect(setValues()).toEqual({ name: "Renamed" });
  });

  it("runs the full key block, and claims the key, when a slug is sent", async () => {
    seed({ ...stored, slug: "NEW" }, true);
    await updateProject("p1", undefined, undefined, "NEW", undefined, "w1", {});
    expect(setValues()).toEqual({ slug: "NEW" });
    expect(touched("select", "project")).toBe(2); // locked read + live clash read
    expect(touched("select", "claim")).toBe(1);
    expect(touched("insert", "claim")).toBe(1);
  });

  it("refuses a changed slug that is not 2-15 uppercase letters, with no write", async () => {
    seed({ ...stored }, true);
    const error = await rejection(
      updateProject("p1", undefined, undefined, "bad-key", undefined, "w1", {}),
    );
    expect(error.status).toBe(400);
    expect(setValues()).toBeUndefined();
  });

  it("sends the same legacy-looking key back unchanged without PR-13 objecting", async () => {
    seed({ ...stored, slug: "legacy-key" }, true);
    queued("project")[0] = [{ ...stored, slug: "legacy-key" }];
    await updateProject(
      "p1",
      undefined,
      undefined,
      "legacy-key",
      undefined,
      "w1",
      {},
    );
    expect(setValues()).toEqual({ slug: "legacy-key" });
  });

  it("refuses a slug another live project holds with a taken error and no write", async () => {
    seed({ ...stored }, true);
    queued("project")[1] = [{ id: "other" }];
    const error = await rejection(
      updateProject("p1", undefined, undefined, "TAKEN", undefined, "w1", {}),
    );
    expect(error.constructor.name).toBe("ProjectSlugTakenError");
    expect(setValues()).toBeUndefined();
  });

  it("refuses a slug another project holds a permanent claim on", async () => {
    seed({ ...stored }, true);
    queued("claim")[0] = [{ projectId: "someone-else" }];
    const error = await rejection(
      updateProject("p1", undefined, undefined, "CLAIMED", undefined, "w1", {}),
    );
    expect(error.constructor.name).toBe("ProjectSlugTakenError");
    expect(setValues()).toBeUndefined();
  });

  it("keeps PR-9 under the lock: a managed service cannot lose its support level, nothing written", async () => {
    seed({ ...stored });
    queued("project")[0] = [
      {
        ...stored,
        kind: "managed_service",
        supportLevel: "L2",
        serviceCalendarId: "cal-1",
        serviceCalendarMode: "override",
      },
    ];
    await expect(
      updateProject("p1", undefined, undefined, undefined, undefined, "w1", {
        supportLevel: null,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(setValues()).toBeUndefined();
  });

  it("refuses a new or changed end date on a managed service, but keeps a stored one", async () => {
    const managed = {
      ...stored,
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: "cal-1",
      serviceCalendarMode: "override",
      endDate: "2026-12-31",
    };
    const call = (endDate: string | null) => {
      seed({ ...managed });
      queued("project")[0] = [managed];
      return updateProject(
        "p1",
        undefined,
        undefined,
        undefined,
        undefined,
        "w1",
        {
          endDate,
        },
      );
    };
    await expect(call("2027-01-31")).rejects.toMatchObject({
      status: 422,
      message: "managed_service_has_no_end_date",
    });
    expect(setValues()).toBeUndefined();
    // Re-sending the stored value and clearing it are not "setting" one: nothing is forced out.
    await expect(call("2026-12-31")).resolves.toBeDefined();
    await expect(call(null)).resolves.toBeDefined();
    // Switching a dated delivery project to managed keeps its end date.
    seed({ ...managed });
    queued("project")[0] = [{ ...managed, kind: "project" }];
    await expect(
      updateProject("p1", undefined, undefined, undefined, undefined, "w1", {
        kind: "managed_service",
      }),
    ).resolves.toBeDefined();
  });

  it("a soft-deleted or missing project is 404 whatever the body", async () => {
    seed({ ...stored });
    queued("project")[0] = [];
    await expect(
      updateProject("p1", "x", undefined, undefined, undefined, "w1", {}),
    ).rejects.toMatchObject({ status: 404 });
    expect(setValues()).toBeUndefined();
  });

  it("keeps a null, an empty string and a cleared optional exactly as sent", async () => {
    seed({ ...stored });
    await updateProject("p1", undefined, undefined, undefined, "", "w1", {
      managerId: null,
      defaultCommentVisibility: "internal",
    });
    expect(setValues()).toEqual({
      description: "",
      defaultCommentVisibility: "internal",
      managerId: null,
    });
  });
});
