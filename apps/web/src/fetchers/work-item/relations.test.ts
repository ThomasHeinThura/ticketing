import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch }));

import {
  createWorkItemRelation,
  getRelationCandidates,
  getWorkItemRelations,
  requestWorkItemRelationRemoval,
} from "./relations";

beforeEach(() => apiFetch.mockReset());
describe("canonical relation fetchers", () => {
  it.each([
    ["blocked_by", "blocks"],
    ["duplicated_by", "duplicates"],
    ["follows", "precedes"],
    ["required_by", "requires"],
  ] as const)(
    "normalises inverse %s by swapping actual addressed endpoints",
    async (type, canonical) => {
      apiFetch.mockResolvedValue(Response.json({ id: "relation" }));
      await createWorkItemRelation({
        sourceKey: "OPS-1",
        targetKey: "PLAT-2",
        type,
      });
      const [url, request] = apiFetch.mock.calls[0];
      expect(url).toContain("/api/work-items/PLAT-2/relations");
      expect(JSON.parse(request.body)).toEqual({
        targetKey: "OPS-1",
        type: canonical,
      });
    },
  );
  it("keeps the canonical direction for a forward relation", async () => {
    apiFetch.mockResolvedValue(Response.json({ id: "relation" }));
    await createWorkItemRelation({
      sourceKey: "OPS-1",
      targetKey: "PLAT-2",
      type: "blocks",
    });
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/OPS-1/relations"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ targetKey: "PLAT-2", type: "blocks" }),
      }),
    );
  });
  it("reopens the requester's own pending relation removal on a 409", async () => {
    apiFetch.mockResolvedValue(
      Response.json({ message: "pending_approval: pa-5" }, { status: 409 }),
    );
    expect(
      await requestWorkItemRelationRemoval({ key: "OPS-1", id: "relation-1" }),
    ).toEqual({ pendingActionId: "pa-5" });
  });
  it("requests removal and requires a real 202 pending action", async () => {
    apiFetch.mockResolvedValue(
      Response.json({ pendingActionId: "pa-1" }, { status: 202 }),
    );
    expect(
      await requestWorkItemRelationRemoval({ key: "OPS-1", id: "relation/1" }),
    ).toEqual({ pendingActionId: "pa-1" });
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/OPS-1/relations/relation%2F1"),
      { method: "DELETE" },
    );
    apiFetch.mockResolvedValue(Response.json({ deleted: true }));
    await expect(
      requestWorkItemRelationRemoval({ key: "OPS-1", id: "relation" }),
    ).rejects.toThrow();
  });
  it("uses the scoped real candidate endpoint with bounded query and continuation", async () => {
    const result = { data: [], page: { hasMore: false, nextCursor: null } };
    apiFetch.mockResolvedValue(Response.json(result));
    expect(
      await getRelationCandidates({
        key: "OPS-1",
        q: "100% & support",
        cursor: "next+page",
      }),
    ).toEqual(result);
    const url = new URL(apiFetch.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/work-items/OPS-1/relation-candidates");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "100% & support",
      limit: "25",
      cursor: "next+page",
    });
  });
  it.each([403, 404, 422])(
    "retains denial %i without fabricated results",
    async (status) => {
      apiFetch.mockResolvedValue(new Response("Refused", { status }));
      await expect(getWorkItemRelations("OPS-1")).rejects.toMatchObject({
        status,
      });
    },
  );
});
