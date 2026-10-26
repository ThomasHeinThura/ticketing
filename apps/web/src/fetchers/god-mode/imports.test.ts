import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.example.test/api/${path}`,
}));

import {
  createImportRun,
  getImportReport,
  getImportRun,
  listImportRuns,
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
});
