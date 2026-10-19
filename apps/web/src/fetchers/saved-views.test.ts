import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpError } from "@/lib/http-error";
import { savedViewKeys } from "@/lib/saved-view-keys";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  run: vi.fn(),
  count: vi.fn(),
  pin: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    "work-items": { search: { $post: mocks.search } },
    views: {
      $get: mocks.list,
      $post: mocks.post,
      "team-audiences": { $get: vi.fn() },
      ":id": {
        $get: mocks.get,
        $patch: mocks.patch,
        $delete: mocks.del,
        run: { $post: mocks.run },
        count: { $get: mocks.count },
        pin: { $post: mocks.pin },
      },
    },
  },
}));

import {
  countSavedView,
  createSavedView,
  requestSavedViewDeletion,
  runSavedView,
  runSavedViewUrlQuery,
  toggleSavedViewPin,
  updateSavedView,
} from "./saved-views";

afterEach(() => vi.clearAllMocks());

const searchPage = {
  ok: true,
  json: async () => ({
    data: [],
    page: { hasMore: true, nextCursor: "next-1" },
    meta: { total: 9 },
  }),
};

describe("runSavedViewUrlQuery (SV-19: a URL's definition, run as the viewer)", () => {
  it("sends only what the URL carries: no sort, columns or project unless given", async () => {
    mocks.search.mockResolvedValue(searchPage);
    const result = await runSavedViewUrlQuery({ workspaceId: "ws_1" });
    expect(mocks.search).toHaveBeenCalledWith({
      json: { workspaceId: "ws_1", query: { entity: "work_item" } },
    });
    expect(result).toMatchObject({
      hasMore: true,
      nextCursor: "next-1",
      total: 9,
    });
  });

  it("maps the stored direction to the endpoint's order and narrows a project view by slug", async () => {
    mocks.search.mockResolvedValue(searchPage);
    await runSavedViewUrlQuery({
      workspaceId: "ws_1",
      projectSlug: "OPS",
      filter: "priority:high",
      sort: "title",
      dir: "desc",
      columns: ["key", "title"],
      cursor: "c-1",
    });
    expect(mocks.search).toHaveBeenCalledWith({
      json: {
        workspaceId: "ws_1",
        cursor: "c-1",
        query: {
          entity: "work_item",
          filter: {
            op: "and",
            clauses: [
              { field: "project", op: "eq", value: "OPS" },
              { field: "priority", op: "eq", value: "high" },
            ],
          },
          sort: [{ field: "title", order: "desc" }],
          columns: ["key", "title"],
        },
      },
    });
  });

  it("scopes a project view with no other filter to its project alone", async () => {
    mocks.search.mockResolvedValue(searchPage);
    await runSavedViewUrlQuery({ workspaceId: "ws_1", projectSlug: "OPS" });
    expect(mocks.search).toHaveBeenCalledWith({
      json: {
        workspaceId: "ws_1",
        query: {
          entity: "work_item",
          filter: { field: "project", op: "eq", value: "OPS" },
        },
      },
    });
  });

  it("fails a malformed filter as a 400 without sending it", async () => {
    await expect(
      runSavedViewUrlQuery({ workspaceId: "ws_1", filter: "priority:bad" }),
    ).rejects.toMatchObject({ status: 400 } satisfies Partial<HttpError>);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("keeps the endpoint's refusal detail for the viewer (field permission or unavailable field)", async () => {
    mocks.search.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Filter field unavailable: label",
    });
    await expect(
      runSavedViewUrlQuery({ workspaceId: "ws_1", filter: "label:urgent" }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Filter field unavailable: label",
    });
  });
});

describe("saved-view API calls", () => {
  it("runs the stored view for the current viewer and reads its page and total", async () => {
    mocks.run.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 4 },
      }),
    });
    expect(await runSavedView({ id: "v1", cursor: "c" })).toMatchObject({
      total: 4,
      hasMore: false,
    });
    expect(mocks.run).toHaveBeenCalledWith({
      param: { id: "v1" },
      query: { cursor: "c" },
    });
  });

  it("keeps the HTTP status of a view that cannot be run, counted or pinned", async () => {
    for (const [mock, call] of [
      [mocks.run, () => runSavedView({ id: "v1" })],
      [mocks.count, () => countSavedView("v1")],
      [mocks.pin, () => toggleSavedViewPin("v1")],
    ] as const) {
      mock.mockResolvedValue({ ok: false, status: 404 });
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }
  });

  it("requests deletion as a pending action and never deletes directly", async () => {
    mocks.del.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ pendingActionId: "pa-1" }),
    });
    expect(await requestSavedViewDeletion("v1")).toEqual({
      pendingActionId: "pa-1",
    });
    expect(mocks.del).toHaveBeenCalledWith({ param: { id: "v1" } });
  });

  it("surfaces a refused deletion request with its status, for the permission message", async () => {
    mocks.del.mockResolvedValue({ ok: false, status: 403 });
    await expect(requestSavedViewDeletion("v1")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("sends only the changed fields on update, so a rename never rewrites the stored query", async () => {
    mocks.patch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await updateSavedView({
      id: "v1",
      name: "Renamed",
      visibility: "private",
      sharedWithTeamId: null,
    });
    expect(mocks.patch).toHaveBeenCalledWith({
      param: { id: "v1" },
      json: { name: "Renamed", visibility: "private", sharedWithTeamId: null },
    });
  });

  it("creates a view with the audience it was given and only that", async () => {
    mocks.post.mockResolvedValue({ ok: true, json: async () => ({}) });
    await createSavedView({
      workspaceId: "ws_1",
      name: "Mine",
      scope: "workspace",
      scopeId: "ws_1",
      visibility: "team",
      sharedWithTeamId: "team-1",
      layout: "list",
      query: { entity: "work_item" },
    });
    expect(mocks.post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        visibility: "team",
        sharedWithTeamId: "team-1",
      }),
    });
  });
});

describe("saved-view cache keys (counts and pins are keyed by viewer identity)", () => {
  it("separates every viewer-specific answer by user id", () => {
    expect(savedViewKeys.list("ws", "u1")).not.toEqual(
      savedViewKeys.list("ws", "u2"),
    );
    expect(savedViewKeys.detail("u1", "v")).not.toEqual(
      savedViewKeys.detail("u2", "v"),
    );
    expect(savedViewKeys.count("u1", "v", "t")).not.toEqual(
      savedViewKeys.count("u2", "v", "t"),
    );
    expect(savedViewKeys.teamAudiences("ws", "u1")).not.toEqual(
      savedViewKeys.teamAudiences("ws", "u2"),
    );
  });

  it("refreshes a count when the view is edited, and is reached by one prefix invalidation", () => {
    expect(savedViewKeys.count("u1", "v", "t1")).not.toEqual(
      savedViewKeys.count("u1", "v", "t2"),
    );
    // The list, and nothing viewer-less, sits under the shared prefix.
    expect(savedViewKeys.list("ws", "u1")[0]).toBe(savedViewKeys.all[0]);
  });
});
