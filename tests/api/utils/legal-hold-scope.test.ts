import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  PROJECT_UNDER_OPEN_HOLD,
  WORK_ITEM_UNDER_OPEN_HOLD,
  workspaceUnderOpenHold,
} from "../../../apps/api/src/utils/legal-hold-scope";

const text = (fragment: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  new PgDialect().sqlToQuery(fragment).sql;

/** Everything a hard delete of a work item removes (PA-12); every scope must fence all of it. */
const WORK_ITEM_SOURCES = [
  '"request_participant"',
  '"added_by"',
  '"comment_version"',
  '"edited_by"',
  '"deleted_by"',
  '"watcher"',
  '"approval"',
  '"attachment"',
  '"uploaded_by"',
];
const PROJECT_SOURCES = [
  '"stakeholder"',
  '"project_feature_flag"',
  '"task"',
  '"time_entry"',
  '"task_activity"',
  '"task_comment"',
  '"asset"',
  '"created_by"',
];

describe("legal-hold scope is one shared predicate (N4)", () => {
  it("the work-item predicate (purge, gc) covers every cascaded person source", () => {
    const sqlText = text(WORK_ITEM_UNDER_OPEN_HOLD);
    for (const source of WORK_ITEM_SOURCES) expect(sqlText).toContain(source);
  });

  it("the project predicate (purge, gc) covers work-item and project-level sources", () => {
    const sqlText = text(PROJECT_UNDER_OPEN_HOLD);
    for (const source of [...WORK_ITEM_SOURCES, ...PROJECT_SOURCES])
      expect(sqlText).toContain(source);
  });

  it("the workspace predicate covers the same sources plus workspace members", () => {
    const sqlText = text(workspaceUnderOpenHold("ws-1"));
    for (const source of [...WORK_ITEM_SOURCES, ...PROJECT_SOURCES])
      expect(sqlText).toContain(source);
    expect(sqlText).toContain('"workspace_member"');
  });

  it("the workspace predicate also covers submission, attachment and membership people (M8)", () => {
    const sqlText = text(workspaceUnderOpenHold("ws-1"));
    for (const source of [
      '"submission"',
      '"requester_id"',
      '"claimed_by"',
      '"membership"',
      '"membership_grant"',
      '"oidc_group_mapping"',
      '"scim_group_mapping"',
    ])
      expect(sqlText).toContain(source);
  });

  it("comment.deleted_by and comment_version.edited_by are resolved through person.user_id (M9)", () => {
    const sqlText = text(WORK_ITEM_UNDER_OPEN_HOLD);
    expect(sqlText).toMatch(
      /"user_id" IN \(\s*SELECT x\."deleted_by" FROM "comment"/u,
    );
    expect(sqlText).toMatch(
      /"user_id" IN \(\s*SELECT v\."edited_by" FROM "comment_version"/u,
    );
  });
});
