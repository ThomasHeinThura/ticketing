import { describe, expect, it } from "vitest";
import {
  evaluateHardPurgeTarget,
  type HardPurgeFacts,
  removePurgedObjects,
} from "../../../apps/api/src/instance/purge-target";

const target = { targetType: "work_item" as const, targetId: "wi-1" };
const eligible: HardPurgeFacts = {
  exists: true,
  softDeleted: true,
  underLegalHold: false,
  childWorkItems: 0,
  submissions: 0,
  requestTypeDefaults: 0,
  workItems: 1,
  comments: 2,
  attachments: 1,
  label: "HELP-1",
};

const organisationTarget = {
  targetType: "organisation" as const,
  targetId: "org-1",
};

describe("PA-13 hard purge checks", () => {
  it("reports a missing target as not found", () => {
    expect(
      evaluateHardPurgeTarget(target, { ...eligible, exists: false }),
    ).toEqual({ status: "not_found" });
  });

  it("refuses while a legal hold stands, before any other check", () => {
    expect(
      evaluateHardPurgeTarget(target, {
        ...eligible,
        underLegalHold: true,
        softDeleted: false,
        childWorkItems: 3,
      }),
    ).toEqual({ status: "refused", reason: "legal_hold" });
  });

  it("refuses live data: only an already soft-deleted target may be purged", () => {
    expect(
      evaluateHardPurgeTarget(target, { ...eligible, softDeleted: false }),
    ).toEqual({ status: "refused", reason: "not_soft_deleted" });
  });

  it("blocks on child work items and portal submissions instead of cascading through them", () => {
    expect(
      evaluateHardPurgeTarget(target, { ...eligible, childWorkItems: 1 }),
    ).toEqual({ status: "blocked", reason: "has_child_work_items" });
    expect(
      evaluateHardPurgeTarget(target, { ...eligible, submissions: 1 }),
    ).toEqual({ status: "blocked", reason: "has_submissions" });
    expect(
      evaluateHardPurgeTarget(
        { targetType: "project", targetId: "p-1" },
        { ...eligible, requestTypeDefaults: 1 },
      ),
    ).toEqual({ status: "blocked", reason: "is_request_type_default" });
  });

  it("removes stored objects after commit on a best-effort basis and counts failures", async () => {
    const removed: string[] = [];
    const failed = await removePurgedObjects(["a", "b", "c"], async (key) => {
      if (key === "b") throw new Error("storage down");
      removed.push(key);
    });
    expect(failed).toBe(1);
    expect(removed).toEqual(["a", "c"]);
  });

  it("returns the hold and retention result in the summary the confirmation shows", () => {
    expect(evaluateHardPurgeTarget(target, eligible)).toEqual({
      status: "eligible",
      summary: {
        targetType: "work_item",
        targetId: "wi-1",
        label: "HELP-1",
        workItems: 1,
        comments: 2,
        attachments: 1,
        legalHold: "none",
        retention: "soft_deleted",
      },
    });
  });

  it("includes the organisation graph impact in the exact-name confirmation summary", () => {
    expect(
      evaluateHardPurgeTarget(organisationTarget, {
        ...eligible,
        workItems: 3,
        comments: 2,
        attachments: 2,
        label: "QA organisation",
        organisationVersion: { operationId: "delete-1", generation: 2 },
        organisationImpact: {
          organisations: 1,
          projects: 2,
          people: 1,
          workItems: 3,
          comments: 2,
          submissions: 1,
          attachments: 2,
          storageObjectsQueued: 2,
        },
      }),
    ).toMatchObject({
      status: "eligible",
      summary: {
        legalHold: "none",
        retention: "soft_deleted",
        impact: {
          organisations: 1,
          projects: 2,
          people: 1,
          workItems: 3,
          comments: 2,
          submissions: 1,
          attachments: 2,
          storageObjectsQueued: 2,
        },
      },
    });
  });
});
