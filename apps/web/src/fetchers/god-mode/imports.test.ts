import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.example.test/api/${path}`,
}));

import {
  createEngineImportRun,
  createImportRun,
  createImportSource,
  discoverImportRun,
  executeImportRun,
  getImportDryRun,
  getImportLosses,
  getImportReport,
  getImportRun,
  listImportRuns,
  listImportSources,
  pauseImportRun,
  resumeImportRun,
  runImportDryRun,
  saveImportMapping,
} from "./imports";

type Init = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cache?: RequestCache;
};
const lastCall = () => {
  const [url, init] = mocks.apiFetch.mock.calls.at(-1) as [string, Init];
  return { url, init };
};
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  mocks.apiFetch.mockReset().mockResolvedValue(ok({}));
});

describe("God Mode imports fetchers", () => {
  it("lists persisted run history with workspace and opaque page cursor", async () => {
    const page = { runs: [], nextCursor: "run-2" };
    mocks.apiFetch.mockResolvedValue(ok(page));
    await expect(
      listImportRuns({
        workspaceId: "workspace-1",
        projectId: "project-2",
        state: "running",
        cursor: "run-1",
        limit: 20,
      }),
    ).resolves.toEqual(page);
    const request = lastCall();
    expect(request.url).toBe(
      "https://api.example.test/api/imports?workspaceId=workspace-1&limit=20&projectId=project-2&state=running&cursor=run-1",
    );
    expect(request.init.cache).toBe("no-store");
  });

  it("creates only an import run with the submitted idempotency key", async () => {
    const run = { id: "run-1", sourceRef: "mcp:source-1" };
    mocks.apiFetch.mockResolvedValue(ok(run));
    await expect(
      createImportRun(
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          pluginId: "import.mcp",
          sourceRef: "mcp:source-1",
        },
        "stable-retry-key",
      ),
    ).resolves.toEqual(run);
    const request = lastCall();
    expect(request.url).toBe("https://api.example.test/api/imports");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers?.["Idempotency-Key"]).toBe("stable-retry-key");
    expect(JSON.parse(request.init.body ?? "null")).toEqual({
      workspaceId: "workspace-1",
      projectId: "project-1",
      pluginId: "import.mcp",
      sourceRef: "mcp:source-1",
    });
    expect(request.init.body).not.toContain("records");
    expect(request.init.body).not.toContain("credentials");
  });

  it("loads only safe run detail and report routes with URL-encoded IDs", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(ok({ id: "run/with/slash" }))
      .mockResolvedValueOnce(ok({ runId: "run/with/slash", chunks: [] }));
    await getImportRun("run/with/slash");
    expect(lastCall().url).toBe(
      "https://api.example.test/api/imports/run%2Fwith%2Fslash",
    );
    expect(lastCall().init.cache).toBe("no-store");
    await getImportReport("run/with/slash");
    expect(lastCall().url).toBe(
      "https://api.example.test/api/imports/run%2Fwith%2Fslash/report",
    );
    expect(lastCall().init.cache).toBe("no-store");
  });

  it("does not expose raw server error bodies", async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response("source secret must not surface", { status: 400 }),
    );
    const error = await createImportRun(
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        pluginId: "import.mcp",
        sourceRef: "mcp:source-1",
      },
      "stable-retry-key",
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 400 });
    expect(JSON.stringify(error)).not.toContain("source secret");
  });

  describe("import engine", () => {
    beforeEach(() => {
      mocks.apiFetch.mockReset().mockImplementation(async () => ok({}));
    });

    it("sends an Idempotency-Key on every write and bodies only where one is needed", async () => {
      await discoverImportRun("run/1", "k-discover");
      expect(lastCall().url).toBe(
        "https://api.example.test/api/imports/run%2F1/discover",
      );
      expect(lastCall().init.method).toBe("POST");
      expect(lastCall().init.headers).toEqual({
        "Idempotency-Key": "k-discover",
      });
      expect(lastCall().init.body).toBeUndefined();

      await runImportDryRun("run-1", "k-dry");
      expect(lastCall().url).toMatch(/imports\/run-1\/dry-run-all$/u);
      await pauseImportRun("run-1", "k-pause");
      expect(lastCall().url).toMatch(/imports\/run-1\/pause$/u);
      await resumeImportRun("run-1", "k-resume");
      expect(lastCall().url).toMatch(/imports\/run-1\/resume$/u);
      expect(lastCall().init.headers?.["Idempotency-Key"]).toBe("k-resume");

      await executeImportRun(
        "run-1",
        { dryRunDigest: "a".repeat(64), mappingVersion: 3, totalCount: 10 },
        "k-exec",
      );
      expect(lastCall().init.headers).toEqual({
        "Idempotency-Key": "k-exec",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(lastCall().init.body ?? "{}")).toEqual({
        dryRunDigest: "a".repeat(64),
        mappingVersion: 3,
        totalCount: 10,
      });

      await saveImportMapping(
        "run-1",
        {
          expectedMappingVersion: 3,
          entries: [{ domain: "type", value: "Bug", target: null }],
        },
        "k-map",
      );
      expect(lastCall().url).toMatch(/imports\/run-1\/mapping$/u);
      expect(lastCall().init.headers?.["Idempotency-Key"]).toBe("k-map");
    });

    it("creates sources and runs, unwrapping the source list", async () => {
      mocks.apiFetch.mockImplementation(async () =>
        ok({ sources: [{ id: "s1" }] }),
      );
      await expect(listImportSources("workspace-1")).resolves.toEqual([
        { id: "s1" },
      ]);
      expect(lastCall().url).toBe(
        "https://api.example.test/api/import-sources?workspaceId=workspace-1",
      );
      await createImportSource(
        {
          workspaceId: "workspace-1",
          pluginId: "import.jira",
          name: "Jira",
          config: { baseUrl: "https://x.example" },
          credential: "token-value",
        },
        "k-source",
      );
      expect(lastCall().url).toMatch(/api\/import-sources$/u);
      expect(JSON.parse(lastCall().init.body ?? "{}").credential).toBe(
        "token-value",
      );
      await createEngineImportRun(
        "source/1",
        { projectId: "p1", sourceRef: "ref" },
        "k-run",
      );
      expect(lastCall().url).toMatch(/import-sources\/source%2F1\/runs$/u);
    });

    it("treats a missing dry run as empty and reads losses with a cursor", async () => {
      mocks.apiFetch.mockImplementation(
        async () => new Response("{}", { status: 404 }),
      );
      await expect(getImportDryRun("run-1")).resolves.toBeNull();
      mocks.apiFetch.mockImplementation(
        async () => new Response("{}", { status: 500 }),
      );
      await expect(getImportDryRun("run-1")).rejects.toMatchObject({
        status: 500,
      });
      mocks.apiFetch.mockImplementation(async () => ok({ losses: [] }));
      await getImportLosses("run-1", { cursor: "c1", code: "rich_text_lossy" });
      expect(lastCall().url).toBe(
        "https://api.example.test/api/imports/run-1/losses?limit=100&code=rich_text_lossy&cursor=c1",
      );
    });
  });
});
