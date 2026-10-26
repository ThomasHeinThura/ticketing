import { describe, expect, it } from "vitest";
import {
  queuePairBody,
  queuePairPatchBody,
  queueRunQuery,
  submissionSavedViewQuerySchema,
} from "../../../apps/api/src/intake/queues/schema";

describe("paired intake queue schemas", () => {
  const base = {
    workspaceId: "ws-example",
    name: "Support backlog",
    visibility: "private" as const,
    submissionQuery: {
      entity: "submission" as const,
      filter: { state: "accepted" as const },
    },
    workItemQuery: {
      entity: "work_item" as const,
      filter: { state: { op: "eq", value: "backlog" } },
    },
  };

  it("keeps submission saved-view filters on the registered whitelist", () => {
    expect(
      submissionSavedViewQuerySchema.safeParse(base.submissionQuery).success,
    ).toBe(true);
    expect(
      submissionSavedViewQuerySchema.safeParse({
        entity: "submission",
        filter: { state: "accepted", projectId: "foreign-project" },
      }).success,
    ).toBe(false);
  });

  it("requires one entity-specific query for each saved-view document", () => {
    expect(queuePairBody.safeParse(base).success).toBe(true);
    expect(
      queuePairBody.safeParse({
        ...base,
        submissionQuery: { entity: "work_item" },
      }).success,
    ).toBe(false);
    expect(
      queuePairBody.safeParse({
        ...base,
        workItemQuery: { entity: "work_item", unrestricted: true },
      }).success,
    ).toBe(false);
  });

  it("requires both current versions when editing a pair", () => {
    expect(
      queuePairPatchBody.safeParse({
        workspaceId: base.workspaceId,
        expectedVersions: { submission: 1, workItem: 2 },
        name: "Updated support backlog",
      }).success,
    ).toBe(true);
    expect(
      queuePairPatchBody.safeParse({
        workspaceId: base.workspaceId,
        expectedVersions: { submission: 1 },
        name: "Updated support backlog",
      }).success,
    ).toBe(false);
    expect(
      queuePairPatchBody.safeParse({
        workspaceId: base.workspaceId,
        expectedVersions: { submission: 1, workItem: 2 },
      }).success,
    ).toBe(false);
  });

  it("keeps URL overrides bounded and rejects unregistered parameters", () => {
    expect(
      queueRunQuery.safeParse({
        workspaceId: "ws-example",
        state: "accepted",
        requestTypeKey: "access",
        assignee: "claimed",
        olderThanDays: "30",
        limit: "50",
        workItemFilter: "state = backlog",
      }).success,
    ).toBe(true);
    expect(
      queueRunQuery.safeParse({
        workspaceId: "ws-example",
        requesterId: "someone-else",
      }).success,
    ).toBe(false);
    expect(
      queueRunQuery.safeParse({
        workspaceId: "ws-example",
        workItemFilter: "x".repeat(8192),
        workItemSorts: JSON.stringify([{ field: "priority", order: "desc" }]),
        workItemColumns: "key,title,cf.business_impact",
      }).success,
    ).toBe(true);
    expect(
      queueRunQuery.safeParse({
        workspaceId: "ws-example",
        workItemFilter: "x".repeat(8193),
      }).success,
    ).toBe(false);
    expect(
      queueRunQuery.safeParse({
        workspaceId: "ws-example",
        workItemSorts: "x".repeat(2049),
      }).success,
    ).toBe(false);
  });
});
