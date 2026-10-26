import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import globalSearch from "../../../apps/api/src/search/controllers/global-search";

const mocks = vi.hoisted(() => ({
  searchCanonicalWorkItems: vi.fn(),
  searchCanonicalWorkItemsFuzzy: vi.fn(),
  searchWorkspacePeople: vi.fn(),
  listUserWorkspaceIds: vi.fn(),
  isCustomerPrincipal: vi.fn(),
}));

vi.mock("../../../apps/api/src/search/canonical-repository", () => ({
  searchCanonicalWorkItems: mocks.searchCanonicalWorkItems,
  searchCanonicalWorkItemsFuzzy: mocks.searchCanonicalWorkItemsFuzzy,
  searchWorkspacePeople: mocks.searchWorkspacePeople,
  searchSavedViews: vi.fn(),
}));

vi.mock("../../../apps/api/src/search/repository", () => ({
  listUserWorkspaceIds: mocks.listUserWorkspaceIds,
  findTasksByShortId: vi.fn(),
  searchActivities: vi.fn(),
  searchProjects: vi.fn(),
  searchTasks: vi.fn(),
  searchWorkspaces: vi.fn(),
}));

vi.mock("../../../apps/api/src/utils/is-customer-principal", () => ({
  isCustomerPrincipal: mocks.isCustomerPrincipal,
}));

vi.mock("../../../apps/api/src/feature-flag/repository", () => ({
  projectsWithFeature: vi.fn(),
}));
vi.mock("../../../apps/api/src/kb/repository", () => ({
  searchArticles: vi.fn(),
}));
vi.mock("../../../apps/api/src/kb/visibility", () => ({
  kbEnabledWorkspaceIds: vi.fn(),
}));
vi.mock("../../../apps/api/src/pages/search", () => ({
  searchProjectPages: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

const identity = { userId: "user-1" } as never;

function searchParams(signal: AbortSignal) {
  return {
    query: "TaskDeskPerf10k-20261025",
    identity,
    type: "all" as const,
    workspaceId: "workspace-1",
    signal,
    reachableProjectIds: async () => ["project-1"],
    workItemAccess: async () => ({
      personId: "person-1",
      projectIds: ["project-1"],
    }),
    kbArticleAccess: async () => true,
  };
}

describe("global search cancellation", () => {
  it("skips fuzzy and remaining entity lookups when the primary lookup finishes after abort", async () => {
    const controller = new AbortController();
    mocks.listUserWorkspaceIds.mockResolvedValue([
      { workspaceId: "workspace-1" },
    ]);
    mocks.isCustomerPrincipal.mockResolvedValue(false);
    mocks.searchCanonicalWorkItems.mockImplementation(async () => {
      controller.abort();
      return [];
    });

    const result = await globalSearch(searchParams(controller.signal));

    expect(result).toEqual({
      results: [],
      totalCount: 0,
      searchQuery: "TaskDeskPerf10k-20261025",
    });
    expect(mocks.searchCanonicalWorkItemsFuzzy).not.toHaveBeenCalled();
    expect(mocks.searchWorkspacePeople).not.toHaveBeenCalled();
  });

  it("receives a real Node HTTP disconnect and stops the obsolete entity chain", async () => {
    let requestSignal: AbortSignal | undefined;
    let markPrimaryStarted!: () => void;
    let markSearchFinished!: () => void;
    const primaryStarted = new Promise<void>((resolve) => {
      markPrimaryStarted = resolve;
    });
    const searchFinished = new Promise<void>((resolve) => {
      markSearchFinished = resolve;
    });

    mocks.listUserWorkspaceIds.mockResolvedValue([
      { workspaceId: "workspace-1" },
    ]);
    mocks.isCustomerPrincipal.mockResolvedValue(false);
    mocks.searchCanonicalWorkItems.mockImplementation(async () => {
      markPrimaryStarted();
      const signal = requestSignal;
      if (signal && !signal.aborted) {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
      return [];
    });

    const app = new Hono();
    app.get("/api/search", async (c) => {
      requestSignal = c.req.raw.signal;
      const result = await globalSearch(searchParams(requestSignal));
      markSearchFinished();
      return c.json(result);
    });

    const { server, port } = await new Promise<{
      server: ReturnType<typeof serve>;
      port: number;
    }>((resolve) => {
      const listeningServer = serve({ fetch: app.fetch, port: 0 }, (info) =>
        resolve({ server: listeningServer, port: info.port }),
      );
    });
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/api/search",
        method: "GET",
      },
      () => undefined,
    );
    req.on("error", () => undefined);

    try {
      req.end();
      await primaryStarted;
      req.destroy();
      await searchFinished;
      expect(requestSignal?.aborted).toBe(true);
      expect(mocks.searchCanonicalWorkItemsFuzzy).not.toHaveBeenCalled();
      expect(mocks.searchWorkspacePeople).not.toHaveBeenCalled();
    } finally {
      req.destroy();
      server.close();
      await once(server, "close");
    }
  });
});
