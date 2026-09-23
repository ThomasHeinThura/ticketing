import { describe, expect, it } from "vitest";
import bulkUpdateTasks from "../../../apps/api/src/task/controllers/bulk-update-tasks";

// S6 (Opus review of PR #307, delta round): `bulkUpdateTasks` takes `workspaceId`
// from its one caller's `c.get("workspaceId")`, set by `workspaceAccess.fromTasks()`.
// That is true of every route wired up today, but it is an invariant of the ROUTE,
// not of this function's own signature -- a future re-mount without `fromTasks()`
// would otherwise pass `undefined`/`""` straight into an `eq(...)` filter and rely on
// the ORM matching no row to fail closed as a 404, which is correct by accident. This
// proves the function itself fails loudly (500) before touching the database at all,
// rather than trusting the caller.
describe("issue #307 S6: bulkUpdateTasks fails closed when workspaceId is falsy", () => {
  it("throws 500 for an empty workspaceId, before any database access", async () => {
    await expect(
      bulkUpdateTasks({
        taskIds: ["some-task-id"],
        operation: "delete",
        userId: "some-user-id",
        // Deliberately the falsy value a missing/broken middleware would produce --
        // cast because the real call site's type is `string`, not `string | ""`.
        workspaceId: "" as string,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
