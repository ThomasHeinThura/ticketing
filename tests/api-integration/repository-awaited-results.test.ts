import type { ResolvedIdentity } from "@taskdesk/permissions";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import {
  findLabelsByTaskId,
  findTaskLabelByName,
  findWorkspaceLabelByName,
  listLabelsByWorkspaceId,
  listTaskLabelCopiesWithTask,
  listTaskLabelCopyTaskIds,
  lockTaskLabelCopies,
} from "../../apps/api/src/label/repository";
import { getCalendarWorkspace } from "../../apps/api/src/service-calendar/repository";
import {
  getCalendarForEvaluation,
  getPinnedVersionForEvaluation,
  getPolicyWorkspace,
  getWorkItemSlaSourceQuery,
  listGoalsForEvaluation,
} from "../../apps/api/src/sla-policy/repository";
import { resetTestDatabase } from "./helpers/database";

/**
 * Issue #580 rule: a repository function awaits its statement and returns rows, never a
 * query builder. A Drizzle builder is thenable but is not a native Promise, so a caller that
 * forgets to await (or a service that chains onto the result) would silently misbehave.
 */
describe("repository functions return awaited results (#580)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const missing = "00000000-0000-4000-8000-000000000000";
  const identity: ResolvedIdentity = {
    userId: missing,
    personId: missing,
    side: "staff",
    organisationId: "",
    portal: "agent",
    credential: "session",
    memberships: [],
    teamIds: [],
    reach: { kind: "membership" },
    authority: [],
  };

  it.each([
    ["getCalendarWorkspace", () => getCalendarWorkspace(missing)],
    ["getPolicyWorkspace", () => getPolicyWorkspace(missing)],
    [
      "getPinnedVersionForEvaluation",
      () => getPinnedVersionForEvaluation(missing, missing),
    ],
    [
      "getCalendarForEvaluation",
      () => getCalendarForEvaluation(missing, missing),
    ],
    ["listGoalsForEvaluation", () => listGoalsForEvaluation(missing, missing)],
    ["findLabelsByTaskId", () => findLabelsByTaskId(identity, missing)],
    [
      "listLabelsByWorkspaceId",
      () => listLabelsByWorkspaceId(identity, missing),
    ],
    [
      "listTaskLabelCopiesWithTask",
      () => listTaskLabelCopiesWithTask(db, missing, "missing"),
    ],
    [
      "listTaskLabelCopyTaskIds",
      () => listTaskLabelCopyTaskIds(db, missing, "missing"),
    ],
    [
      "lockTaskLabelCopies",
      () => lockTaskLabelCopies(db, missing, "missing", []),
    ],
    [
      "getWorkItemSlaSourceQuery",
      () => getWorkItemSlaSourceQuery(db, "NOPE-1", missing),
    ],
  ])("%s returns a native promise of an array", async (_name, call) => {
    const pending = call();
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toEqual([]);
  });

  it.each([
    [
      "findTaskLabelByName",
      () => findTaskLabelByName(db, identity, missing, "missing"),
    ],
    [
      "findWorkspaceLabelByName",
      () => findWorkspaceLabelByName(db, identity, missing, "missing"),
    ],
  ])("%s returns an awaited optional row", async (_name, call) => {
    const pending = call();
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBeUndefined();
  });
});
