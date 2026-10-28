import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({ apiFetch: mocks.apiFetch }));

import {
  getRequestTypeGroupOrder,
  replaceRequestTypeGroupOrder,
} from "./intake-group-order";

beforeEach(() => mocks.apiFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("request type group-order fetchers", () => {
  it("loads the persisted ordered groups and version", async () => {
    const groupOrder = { groups: ["Accounts", "Support"], version: 4 };
    mocks.apiFetch.mockResolvedValue(Response.json({ groupOrder }));

    await expect(getRequestTypeGroupOrder("workspace/1")).resolves.toEqual(
      groupOrder,
    );
    const [url, options] = mocks.apiFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(new URL(url).pathname).toBe("/api/request-type-groups/order");
    expect(new URL(url).searchParams.get("workspaceId")).toBe("workspace/1");
    expect(options).toMatchObject({
      credentials: "include",
      cache: "no-store",
    });
  });

  it("sends the full group permutation with the expected version", async () => {
    const groupOrder = { groups: ["Support", "Accounts"], version: 5 };
    mocks.apiFetch.mockResolvedValue(Response.json({ groupOrder }));

    await expect(
      replaceRequestTypeGroupOrder({
        workspaceId: "workspace-1",
        groups: ["Support", "Accounts"],
        version: 4,
      }),
    ).resolves.toEqual(groupOrder);
    const [url, options] = mocks.apiFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(new URL(url).searchParams.get("workspaceId")).toBe("workspace-1");
    expect(options).toMatchObject({ method: "PUT", credentials: "include" });
    expect(options.body).toBe(
      JSON.stringify({ groups: ["Support", "Accounts"], version: 4 }),
    );
  });

  it("preserves stale-version conflicts and rejects malformed responses", async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      Response.json({ message: "stale" }, { status: 409 }),
    );
    await expect(
      replaceRequestTypeGroupOrder({
        workspaceId: "workspace-1",
        groups: ["Support"],
        version: 2,
      }),
    ).rejects.toMatchObject({ status: 409 });

    mocks.apiFetch.mockResolvedValueOnce(
      Response.json({ groupOrder: { groups: [], version: 0 } }),
    );
    await expect(getRequestTypeGroupOrder("workspace-1")).rejects.toMatchObject(
      { status: 502 },
    );
  });
});
