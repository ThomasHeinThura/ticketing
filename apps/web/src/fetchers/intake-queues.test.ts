import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({ apiFetch: mocks.apiFetch }));

import {
  createIntakeQueue,
  getIntakeQueue,
  listIntakeQueues,
  runIntakeQueue,
  updateIntakeQueue,
} from "./intake-queues";

beforeEach(() => mocks.apiFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("paired intake queue fetchers", () => {
  it("loads queue lists and details with encoded workspace and pair ids", async () => {
    mocks.apiFetch.mockResolvedValueOnce(Response.json([]));
    await expect(listIntakeQueues("workspace/1")).resolves.toEqual([]);
    const [listUrl] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(listUrl).toContain("/api/intake/queues?");
    expect(
      new URL(listUrl, "https://taskdesk.test").searchParams.get("workspaceId"),
    ).toBe("workspace/1");

    const queue = {
      id: "pair / one",
      workspaceId: "workspace/1",
      name: "Support",
      visibility: "private",
      sharedWithTeamId: null,
      versions: { submission: 1, workItem: 2 },
      createdBy: "person-1",
      submissionView: {
        id: "view-a",
        query: { entity: "submission" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      workItemView: {
        id: "view-b",
        query: { entity: "work_item" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    mocks.apiFetch.mockResolvedValueOnce(Response.json(queue));
    await expect(
      getIntakeQueue({ id: queue.id, workspaceId: queue.workspaceId }),
    ).resolves.toEqual(queue);
    const [detailUrl] = mocks.apiFetch.mock.calls[1] as [string, RequestInit];
    expect(detailUrl).toContain("pair%20%2F%20one");
  });

  it("creates and updates both documents with the pair CAS versions", async () => {
    const result = { id: "pair-1", versions: { submission: 1, workItem: 1 } };
    mocks.apiFetch.mockResolvedValueOnce(Response.json(result));
    await createIntakeQueue({
      workspaceId: "workspace-1",
      name: "Support",
      visibility: "private",
      submissionQuery: { entity: "submission" },
      workItemQuery: { entity: "work_item" },
    });
    const [, createInit] = mocks.apiFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(createInit.method).toBe("POST");
    expect(JSON.parse(String(createInit.body))).toMatchObject({
      submissionQuery: { entity: "submission" },
      workItemQuery: { entity: "work_item" },
    });

    mocks.apiFetch.mockResolvedValueOnce(Response.json(result));
    await updateIntakeQueue({
      id: "pair-1",
      workspaceId: "workspace-1",
      expectedVersions: { submission: 1, workItem: 1 },
      name: "Support team",
    });
    const [, updateInit] = mocks.apiFetch.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(updateInit.method).toBe("PATCH");
    expect(JSON.parse(String(updateInit.body))).toMatchObject({
      expectedVersions: { submission: 1, workItem: 1 },
      name: "Support team",
    });
  });

  it("runs both pages with independent cursors and URL filters", async () => {
    const result = { queue: { id: "pair-1" }, submissions: {}, workItems: {} };
    mocks.apiFetch.mockResolvedValueOnce(Response.json(result));
    await runIntakeQueue({
      id: "pair-1",
      workspaceId: "workspace-1",
      limit: 25,
      submissionCursor: "submission-next",
      workItemCursor: "item-next",
      state: "accepted",
      requestTypeKey: "account-access",
      assignee: "claimed",
      olderThanDays: 7,
      workItemFilter: "state = backlog",
    });
    const [url, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    const query = new URL(url, "https://taskdesk.test").searchParams;
    expect(new URL(url, "https://taskdesk.test").pathname).toBe(
      "/api/intake/queues/pair-1/run",
    );
    expect(query.get("submissionCursor")).toBe("submission-next");
    expect(query.get("workItemCursor")).toBe("item-next");
    expect(query.get("workItemFilter")).toBe("state = backlog");
    expect(init).toMatchObject({ credentials: "include", cache: "no-store" });
  });

  it("encodes work-item URL overrides with the canonical sort and column codecs", async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      Response.json({ queue: {}, submissions: {}, workItems: {} }),
    );
    await runIntakeQueue({
      id: "pair-1",
      workspaceId: "workspace-1",
      workItemSorts: [
        { field: "priority", order: "desc" },
        { field: "key", order: "asc" },
      ],
      workItemColumns: ["key", "title", "cf.business_impact"],
    });
    const [url] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    const query = new URL(url, "https://taskdesk.test").searchParams;
    expect(JSON.parse(query.get("workItemSorts") ?? "null")).toEqual([
      { field: "priority", order: "desc" },
      { field: "key", order: "asc" },
    ]);
    expect(query.get("workItemColumns")).toBe("key,title,cf.business_impact");
  });

  it("preserves stale-version conflicts from the server", async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      Response.json({ message: "The intake queue changed" }, { status: 409 }),
    );
    await expect(
      updateIntakeQueue({
        id: "pair-1",
        workspaceId: "workspace-1",
        expectedVersions: { submission: 1, workItem: 1 },
        name: "Support team",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
