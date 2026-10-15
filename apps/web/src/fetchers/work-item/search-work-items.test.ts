import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: { "work-items": { search: { $post: mocks.post } } },
}));

import searchWorkItems, { toSearchSort } from "./search-work-items";

afterEach(() => vi.clearAllMocks());

const emptyPage = {
  ok: true,
  json: async () => ({ data: [], page: { hasMore: false } }),
};

describe("structured work-item search fetcher", () => {
  it("scopes the filter to the project and sends the list's sort and chosen columns", async () => {
    mocks.post.mockResolvedValue(emptyPage);

    await searchWorkItems({
      workspaceId: "ws_1",
      projectSlug: "OPS",
      filter: "assignee:@me",
      sort: "priority",
      dir: "desc",
      columns: ["key", "priority"],
    });

    expect(mocks.post).toHaveBeenCalledWith({
      json: {
        workspaceId: "ws_1",
        query: {
          entity: "work_item",
          filter: {
            op: "and",
            clauses: [
              { field: "project", op: "eq", value: "OPS" },
              { field: "assignee", op: "eq", value: "@me" },
            ],
          },
          sort: [{ field: "priority", order: "desc" }],
          columns: ["key", "priority"],
        },
      },
    });
  });

  it("does not synthesize absent columns and sends no filter clause beyond the project", async () => {
    mocks.post.mockResolvedValue(emptyPage);

    await searchWorkItems({
      workspaceId: "ws_1",
      projectSlug: "OPS",
      filter: "",
      sort: "key",
      dir: "asc",
    });

    expect(mocks.post).toHaveBeenCalledWith({
      json: {
        workspaceId: "ws_1",
        query: {
          entity: "work_item",
          filter: { field: "project", op: "eq", value: "OPS" },
          sort: [{ field: "key", order: "asc" }],
        },
      },
    });
  });

  it("does not forward the list route's rank order, which search cannot sort by", async () => {
    mocks.post.mockResolvedValue(emptyPage);
    expect(toSearchSort("position", "asc")).toEqual([]);

    await searchWorkItems({
      workspaceId: "ws_1",
      projectSlug: "OPS",
      filter: "assignee:@me",
      sort: "position",
      dir: "asc",
    });

    const body = mocks.post.mock.calls[0]?.[0] as {
      json: { query: Record<string, unknown> };
    };
    expect(body.json.query).not.toHaveProperty("sort");
  });

  it("never sends a malformed filter: it fails as a 400 naming the problem", async () => {
    await expect(
      searchWorkItems({
        workspaceId: "ws_1",
        projectSlug: "OPS",
        filter: "priority:bad",
        sort: "key",
        dir: "asc",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("priority"),
    } satisfies Partial<HttpError>);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("retains the field-specific 422 and permission 403 detail, plain text or JSON", async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Filter field unavailable: label",
    });
    await expect(
      searchWorkItems({
        workspaceId: "ws_1",
        projectSlug: "OPS",
        filter: "label:urgent",
        sort: "key",
        dir: "asc",
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Filter field unavailable: label",
    } satisfies Partial<HttpError>);

    mocks.post.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: "Insufficient capability" }),
    });
    await expect(
      searchWorkItems({
        workspaceId: "ws_1",
        projectSlug: "OPS",
        filter: "assignee:@me",
        sort: "key",
        dir: "asc",
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Insufficient capability",
    });
  });

  it("falls back to a generic message for an unreadable or oversized error body", async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "x".repeat(600),
    });
    await expect(
      searchWorkItems({
        workspaceId: "ws_1",
        projectSlug: "OPS",
        filter: "assignee:@me",
        sort: "key",
        dir: "asc",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Failed to search work items",
    });
  });
});
