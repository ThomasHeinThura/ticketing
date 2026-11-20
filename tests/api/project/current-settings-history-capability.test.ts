import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import {
  currentProjectReadPredicate,
  currentWorkspaceManageSettingsPredicate,
} from "../../../apps/api/src/database/repositories/identity-scope.repository";
import {
  projectTable,
  workspaceTable,
} from "../../../apps/api/src/database/schema";
import { servicePrincipalFromFacts } from "../../../apps/api/src/permissions/service-principal";
import { identityFor } from "../../../tests/permissions/matrix-fixture";

function capture() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const executor = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });
  return { executor, queries };
}

describe("P4 current source capability SQL", () => {
  it("requires current scoped or unambiguous legacy workspace manage-settings role", async () => {
    const { executor, queries } = capture();
    await executor
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(
        currentWorkspaceManageSettingsPredicate(
          identityFor("instance_admin"),
          workspaceTable.id,
          executor as never,
        ),
      );
    const query = queries[0];
    expect(query?.sql).toContain('"person"."active"');
    expect(query?.sql).toContain('"user"."banned"');
    expect(query?.sql).toContain('from "membership" inner join "role"');
    expect(query?.sql).toContain('from "workspace_member"');
    expect(query?.sql).toContain('"p4_duplicate_workspace_member"');
    expect(query?.sql).toContain('from "workspace_role"');
    expect(query?.sql).not.toContain('"user"."role" =');
    expect(
      query?.sql.match(/\?\|\s+ARRAY\[\$\d+(?:,\s*\$\d+)*\]::text\[\]/g),
    ).toHaveLength(2);
    expect(query?.params).toContain("workspace:manage_settings");
  });

  it("rechecks direct, nearest inherited and additive workspace project-read paths", async () => {
    const { executor, queries } = capture();
    await executor
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        currentProjectReadPredicate(
          identityFor("owner"),
          projectTable.id,
          projectTable.workspaceId,
          executor as never,
        ),
      );
    const query = queries[0];
    expect(query?.sql).toContain('"person"."active"');
    expect(query?.sql).toContain('"user"."banned"');
    expect(query?.sql).toContain("WITH RECURSIVE p4_chain");
    expect(query?.sql).toContain("p4_chain.depth < 4");
    expect(query?.sql).toContain('"p4_nearest_member"');
    expect(query?.sql).toContain('"p4_nearest_role"');
    expect(query?.sql).toContain('"membership"."scope_id" =');
    expect(query?.sql).toContain('"workspace_member"');
    expect(query?.sql).not.toContain('"user"."role" =');
    expect(query?.params).toContain("project:read");
    expect(
      query?.sql.match(/\?\|\s+ARRAY\[\$\d+(?:,\s*\$\d+)*\]::text\[\]/g)
        ?.length,
    ).toBeGreaterThan(2);
  });

  it("denies customer and service principals before a role read", async () => {
    const { executor, queries } = capture();
    await executor
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        currentProjectReadPredicate(
          identityFor("customer"),
          projectTable.id,
          projectTable.workspaceId,
          executor as never,
        ),
      );
    expect(queries[0]?.sql).toContain("false");
    expect(queries[0]?.sql).not.toContain('from "membership"');
    const service = servicePrincipalFromFacts({
      apiKeyId: "key-1",
      workspaceId: "w1",
      capabilities: ["workspace:manage_settings"],
      organisationId: "org-1",
    });
    if (!service) throw new Error("Missing service key identity");
    await executor
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        currentProjectReadPredicate(
          service,
          projectTable.id,
          projectTable.workspaceId,
          executor as never,
        ),
      );
    expect(queries[1]?.sql).toContain("false");
    await executor
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(
        currentWorkspaceManageSettingsPredicate(
          service,
          workspaceTable.id,
          executor as never,
        ),
      );
    expect(queries[2]?.sql).toContain('from "api_key"');
    expect(queries[2]?.sql).toContain('"apikey"."enabled" =');
    expect(queries[2]?.params).toContain("workspace:manage_settings");
  });
});
