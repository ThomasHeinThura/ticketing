import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: { "work-items": { search: { $post: mocks.post } } },
}));

import searchWorkItems from "./search-work-items";

afterEach(() => vi.clearAllMocks());

describe("structured work-item search fetcher", () => {
  it("preserves an explicit sort and columns in the existing query document", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], page: { hasMore: false } }),
    });

    await searchWorkItems({
      workspaceId: "ws_1",
      projectSlug: "OPS",
      filter: "assignee:@me",
      sort: "priority",
      dir: "desc",
      querySort: [{ field: "priority", order: "desc" }],
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

  it("does not synthesize absent sort or columns metadata", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], page: { hasMore: false } }),
    });

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
        },
      },
    });
  });

  it("retains field-specific 422 and permission 403 details from the API", async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "Filter field unavailable: label" }),
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
      json: async () => ({ message: "Insufficient capability" }),
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
});
