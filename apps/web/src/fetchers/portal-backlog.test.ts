import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `/api${path}`,
}));

import { getPortalBacklog, rankPortalBacklogItem } from "./portal-backlog";

describe("portal backlog fetchers", () => {
  afterEach(() => mocks.apiFetch.mockReset());

  it("loads the customer backlog with its opaque cursor", async () => {
    const payload = { items: [], page: { nextCursor: null, hasMore: false } };
    mocks.apiFetch.mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    await expect(getPortalBacklog("cursor+1")).resolves.toEqual(payload);
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/portal/requests/backlog?cursor=cursor%2B1",
      {
        method: "GET",
        credentials: "include",
      },
    );
  });

  it("posts only the item key and same-partition neighbor ids", async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ key: "CCY-1", position: "2", version: 3 }),
        { status: 200 },
      ),
    );
    await rankPortalBacklogItem({
      key: "CCY-1",
      beforeId: "item-b",
      afterId: "item-c",
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/portal/requests/rank", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        key: "CCY-1",
        beforeId: "item-b",
        afterId: "item-c",
      }),
    });
  });
});
