import { describe, expect, it } from "vitest";
import {
  SAVED_VIEW_COUNT_TTL_SECONDS,
  savedViewCountCacheKey,
} from "../../apps/api/src/view/count-cache";

const base = {
  viewId: "view-1",
  workspaceId: "workspace-1",
  scope: "project",
  scopeId: "project-1",
  definitionVersion: "2026-10-07T00:00:00.000Z",
  query: {
    entity: "work_item",
    filter: { field: "assignee", op: "eq", value: "@me" },
  },
  viewerId: "viewer-1",
  identity: { authority: [{ roleKey: "member", scopeId: "workspace-1" }] },
  reachableProjectIds: ["project-2", "project-1"],
};

describe("saved-view count cache partition", () => {
  it("expires within the documented Valkey window", () => {
    expect(SAVED_VIEW_COUNT_TTL_SECONDS).toBe(30);
  });

  it("keys counts by view definition, scope, viewer authority, and sorted reach", () => {
    const key = savedViewCountCacheKey(base);
    expect(key).toMatch(/^taskdesk:saved-view-count:v1:[a-f0-9]{64}$/u);
    expect(savedViewCountCacheKey({ ...base, viewerId: "viewer-2" })).not.toBe(
      key,
    );
    expect(
      savedViewCountCacheKey({
        ...base,
        identity: {
          authority: [{ roleKey: "viewer", scopeId: "workspace-1" }],
        },
      }),
    ).not.toBe(key);
    expect(
      savedViewCountCacheKey({
        ...base,
        definitionVersion: "newer-definition",
      }),
    ).not.toBe(key);
    expect(
      savedViewCountCacheKey({ ...base, reachableProjectIds: ["project-3"] }),
    ).not.toBe(key);
    expect(
      savedViewCountCacheKey({
        ...base,
        reachableProjectIds: [...base.reachableProjectIds].reverse(),
      }),
    ).toBe(key);
    expect(key).not.toContain("viewer-1");
    expect(key).not.toContain("project-1");
  });
});
