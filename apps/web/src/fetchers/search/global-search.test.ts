import { afterEach, describe, expect, it, vi } from "vitest";
import globalSearch from "./global-search";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: { search: { $get: mocks.get } },
}));

afterEach(() => vi.clearAllMocks());

describe("global search fetcher", () => {
  it("forwards the query abort signal through Hono client init", async () => {
    mocks.get.mockResolvedValue(
      new Response(
        JSON.stringify({ results: [], totalCount: 0, searchQuery: "Alp" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const controller = new AbortController();

    await globalSearch(
      { q: "Alp", workspaceId: "workspace-1" },
      controller.signal,
    );

    expect(mocks.get).toHaveBeenCalledWith(
      {
        query: {
          q: "Alp",
          workspaceId: "workspace-1",
          limit: undefined,
        },
      },
      { init: { signal: controller.signal } },
    );
  });
});
