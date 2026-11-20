import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import { currentProjectReachPredicate } from "../../../apps/api/src/database/repositories/identity-scope.repository";
import { projectTable } from "../../../apps/api/src/database/schema";
import { identityFor } from "../../../tests/permissions/matrix-fixture";

describe("current owner-team project reach SQL", () => {
  it("rechecks team membership, current person and workspace membership after identity resolution", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const executor = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    const identity = { ...identityFor("member"), teamIds: ["team-1"] };
    await executor
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor as never,
        ),
      );
    expect(queries[0]?.sql).toContain(
      'join "team_member" "reach_owner_team_member"',
    );
    expect(queries[0]?.sql).toContain(
      '"reach_owner_user"."id" = "reach_owner_team_member"."user_id"',
    );
    expect(queries[0]?.sql).toContain(
      'from "workspace_member" "reach_owner_workspace_member"',
    );
    expect(queries[0]?.sql).toContain('join "person" "reach_owner_person"');
    expect(queries[0]?.params).toContain("team-1");
  });
});
