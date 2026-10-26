import { afterEach, describe, expect, it, vi } from "vitest";
import globalSearch from "../../../apps/api/src/search/controllers/global-search";

const mocks = vi.hoisted(() => ({
  searchCanonicalWorkItems: vi.fn(),
  searchCanonicalWorkItemsFuzzy: vi.fn(),
  searchWorkspacePeople: vi.fn(),
  searchSavedViews: vi.fn(),
  listUserWorkspaceIds: vi.fn(),
  searchProjects: vi.fn(),
  searchWorkspaces: vi.fn(),
  searchActivities: vi.fn(),
  isCustomerPrincipal: vi.fn(),
  projectsWithFeature: vi.fn(),
  searchArticles: vi.fn(),
  kbEnabledWorkspaceIds: vi.fn(),
  searchProjectPages: vi.fn(),
}));

vi.mock("../../../apps/api/src/search/canonical-repository", () => ({
  searchCanonicalWorkItems: mocks.searchCanonicalWorkItems,
  searchCanonicalWorkItemsFuzzy: mocks.searchCanonicalWorkItemsFuzzy,
  searchWorkspacePeople: mocks.searchWorkspacePeople,
  searchSavedViews: mocks.searchSavedViews,
}));

vi.mock("../../../apps/api/src/search/repository", () => ({
  listUserWorkspaceIds: mocks.listUserWorkspaceIds,
  findTasksByShortId: vi.fn(),
  searchActivities: mocks.searchActivities,
  searchProjects: mocks.searchProjects,
  searchTasks: vi.fn(),
  searchWorkspaces: mocks.searchWorkspaces,
}));

vi.mock("../../../apps/api/src/utils/is-customer-principal", () => ({
  isCustomerPrincipal: mocks.isCustomerPrincipal,
}));

vi.mock("../../../apps/api/src/feature-flag/repository", () => ({
  projectsWithFeature: mocks.projectsWithFeature,
}));

vi.mock("../../../apps/api/src/kb/repository", () => ({
  searchArticles: mocks.searchArticles,
}));

vi.mock("../../../apps/api/src/kb/visibility", () => ({
  kbEnabledWorkspaceIds: mocks.kbEnabledWorkspaceIds,
}));

vi.mock("../../../apps/api/src/pages/search", () => ({
  searchProjectPages: mocks.searchProjectPages,
}));

afterEach(() => vi.resetAllMocks());

const identity = { userId: "user-1" } as never;
const workspaceId = "workspace-1";
const projectId = "project-1";
const timestamp = new Date("2026-01-01T00:00:00.000Z");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function configureSharedAccess() {
  mocks.listUserWorkspaceIds.mockResolvedValue([{ workspaceId }]);
  mocks.isCustomerPrincipal.mockResolvedValue(false);
  mocks.projectsWithFeature.mockResolvedValue([projectId]);
  mocks.kbEnabledWorkspaceIds.mockResolvedValue([workspaceId]);
  mocks.searchCanonicalWorkItemsFuzzy.mockResolvedValue([]);
}

function searchParams(signal?: AbortSignal) {
  return {
    query: "concurrent title",
    identity,
    type: "all" as const,
    workspaceId,
    signal,
    reachableProjectIds: async () => [projectId],
    workItemAccess: async () => ({
      personId: "person-1",
      projectIds: [projectId],
    }),
    kbArticleAccess: async () => true,
  };
}

describe("global search independent entity reads", () => {
  it("runs post-primary reads concurrently and preserves the existing merge order", async () => {
    configureSharedAccess();
    const primary = deferred<unknown[]>();
    const primaryStarted = deferred<void>();
    const people = deferred<unknown[]>();
    const pages = deferred<unknown[]>();
    const views = deferred<unknown[]>();
    const articles = deferred<unknown[]>();
    const projects = deferred<unknown[]>();
    const workspaces = deferred<unknown[]>();
    const allReadsStarted = deferred<void>();
    let startedReads = 0;
    const markReadStarted = () => {
      startedReads += 1;
      if (startedReads === 6) allReadsStarted.resolve();
    };

    mocks.searchCanonicalWorkItems.mockImplementation(() => {
      primaryStarted.resolve();
      return primary.promise;
    });
    mocks.searchWorkspacePeople.mockImplementation(() => {
      markReadStarted();
      return people.promise;
    });
    mocks.searchProjectPages.mockImplementation(() => {
      markReadStarted();
      return pages.promise;
    });
    mocks.searchSavedViews.mockImplementation(() => {
      markReadStarted();
      return views.promise;
    });
    mocks.searchArticles.mockImplementation(() => {
      markReadStarted();
      return articles.promise;
    });
    mocks.searchProjects.mockImplementation(() => {
      markReadStarted();
      return projects.promise;
    });
    mocks.searchWorkspaces.mockImplementation(() => {
      markReadStarted();
      return workspaces.promise;
    });

    const resultPromise = globalSearch(searchParams());
    await primaryStarted.promise;
    expect(mocks.searchWorkspacePeople).not.toHaveBeenCalled();
    expect(mocks.searchProjectPages).not.toHaveBeenCalled();
    expect(mocks.searchSavedViews).not.toHaveBeenCalled();
    expect(mocks.searchArticles).not.toHaveBeenCalled();
    expect(mocks.searchProjects).not.toHaveBeenCalled();
    expect(mocks.searchWorkspaces).not.toHaveBeenCalled();

    primary.resolve([
      {
        id: "work-item-1",
        key: "ALPHA-1",
        title: "Shared title",
        stateName: "Open",
        projectId,
        projectName: "Alpha",
        projectSlug: "alpha",
        workspaceId,
        workspaceName: "Workspace",
        createdAt: timestamp,
        relevanceScore: 5,
        number: 1,
        priority: "medium",
      },
    ]);
    await allReadsStarted.promise;

    expect(mocks.projectsWithFeature).toHaveBeenCalledWith(
      "feature.pages",
      workspaceId,
      [projectId],
    );

    workspaces.resolve([
      {
        id: workspaceId,
        name: "Workspace",
        description: null,
        createdAt: timestamp,
        relevanceScore: 5,
      },
    ]);
    articles.resolve([
      {
        id: "article-1",
        title: "Shared title",
        snippet: null,
        projectId,
        workspaceId,
        createdAt: timestamp,
        relevanceScore: 5,
      },
    ]);
    projects.resolve([
      {
        id: projectId,
        name: "Alpha",
        description: null,
        slug: "alpha",
        workspaceId,
        workspaceName: "Workspace",
        createdAt: timestamp,
        relevanceScore: 5,
      },
    ]);
    pages.resolve([
      {
        id: "page-1",
        title: "Shared title",
        snippet: null,
        projectId,
        projectName: "Alpha",
        projectSlug: "alpha",
        workspaceId,
        createdAt: timestamp,
        relevanceScore: 5,
      },
    ]);
    views.resolve([
      {
        id: "view-1",
        name: "Shared title",
        layout: "list",
        workspaceId,
        createdAt: timestamp,
        relevanceScore: 5,
      },
    ]);
    people.resolve([
      {
        id: "person-1",
        name: "Shared title",
        jobTitle: null,
        userId: "user-2",
        createdAt: timestamp,
        relevanceScore: 5,
      },
    ]);

    const result = await resultPromise;
    expect(result.totalCount).toBe(7);
    expect(result.results.map((item) => item.type)).toEqual([
      "work_item",
      "person",
      "page",
      "saved_view",
      "kb_article",
      "project",
      "workspace",
    ]);
  });

  it("keeps KB search behind its capability and feature gates", async () => {
    configureSharedAccess();
    mocks.searchCanonicalWorkItems.mockResolvedValue([]);
    mocks.searchWorkspacePeople.mockResolvedValue([]);
    mocks.searchProjectPages.mockResolvedValue([]);
    mocks.searchSavedViews.mockResolvedValue([]);
    mocks.searchProjects.mockResolvedValue([]);
    mocks.searchWorkspaces.mockResolvedValue([]);

    const result = await globalSearch({
      ...searchParams(),
      kbArticleAccess: async () => false,
    });

    expect(result.results).toEqual([]);
    expect(mocks.kbEnabledWorkspaceIds).not.toHaveBeenCalled();
    expect(mocks.searchArticles).not.toHaveBeenCalled();
  });

  it("does not start entity reads after the primary work-item query aborts", async () => {
    configureSharedAccess();
    const controller = new AbortController();
    mocks.searchCanonicalWorkItems.mockImplementation(async () => {
      controller.abort();
      return [];
    });

    const result = await globalSearch(searchParams(controller.signal));

    expect(result.results).toEqual([]);
    expect(mocks.searchWorkspacePeople).not.toHaveBeenCalled();
    expect(mocks.searchProjectPages).not.toHaveBeenCalled();
    expect(mocks.searchSavedViews).not.toHaveBeenCalled();
    expect(mocks.searchArticles).not.toHaveBeenCalled();
    expect(mocks.searchProjects).not.toHaveBeenCalled();
    expect(mocks.searchWorkspaces).not.toHaveBeenCalled();
  });
});
