import type { ResolvedIdentity } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import db from "../../../apps/api/src/database";
import {
  buildTaskLabelByNameQuery,
  buildWorkspaceLabelByNameQuery,
} from "../../../apps/api/src/label/repository";

const identity: ResolvedIdentity = {
  userId: "user-id",
  personId: "person-id",
  side: "staff",
  organisationId: "",
  portal: "agent",
  credential: "session",
  memberships: [],
  teamIds: [],
  reach: { kind: "membership" },
  authority: [],
};

describe("label repository current-reach SQL generation", () => {
  it("uses a physical label table reference for task-bound content and project reach", () => {
    const query = buildTaskLabelByNameQuery(db, identity, "task-id", "Bug");
    const { sql, params } = query.toSQL();

    expect(sql).toContain('from "label"');
    expect(sql).not.toContain('from "label" "labelTable"');
    expect(sql).toContain('"label"."workspace_id"');
    expect(sql).toContain('"project"."deleted_at" is null');
    expect(sql).toContain('"membership"');
    expect(sql).toContain('"role"');
    expect(params).toContain("task-id");
    expect(params).toContain("Bug");
  });

  it("uses a physical label table reference for workspace definitions and workspace reach", () => {
    const query = buildWorkspaceLabelByNameQuery(
      db,
      identity,
      "workspace-id",
      "Bug",
    );
    const { sql, params } = query.toSQL();

    expect(sql).toContain('from "label"');
    expect(sql).not.toContain('from "label" "labelTable"');
    expect(sql).toContain('"label"."workspace_id"');
    expect(sql).toContain('"membership"');
    expect(sql).toContain('"role"');
    expect(params).toContain("workspace-id");
    expect(params).toContain("Bug");
  });
});
