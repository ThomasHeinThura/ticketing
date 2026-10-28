import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDeskApiError, TaskDeskClient } from "./client.js";

describe("TaskDeskClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("adds auth and json headers for requests with a body", async () => {
    const auth = {
      usingApiKey: true,
      getAccessToken: vi.fn().mockResolvedValue("token-123"),
      clearToken: vi.fn().mockResolvedValue(undefined),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new TaskDeskClient({
      baseUrl: "https://api.example.com",
      auth: auth as never,
    });

    await expect(
      client.json("/api/project", {
        method: "POST",
        body: JSON.stringify({ name: "Inbox" }),
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("clears the cached token and retries once after a 401", async () => {
    const auth = {
      getAccessToken: vi
        .fn()
        .mockResolvedValueOnce("expired-token")
        .mockResolvedValueOnce("fresh-token"),
      clearToken: vi.fn().mockResolvedValue(undefined),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task-1" }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new TaskDeskClient({
      baseUrl: "https://api.example.com",
      auth: auth as never,
    });

    await expect(client.json("/api/task/task-1")).resolves.toEqual({
      id: "task-1",
    });
    expect(auth.clearToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces api error messages when a request fails", async () => {
    const auth = {
      getAccessToken: vi.fn().mockResolvedValue("token-123"),
      clearToken: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Task not found" }), {
        status: 404,
      }),
    ) as typeof fetch;

    const client = new TaskDeskClient({
      baseUrl: "https://api.example.com",
      auth: auth as never,
    });

    const error = await client.json("/api/task/missing").catch((e) => e);
    expect(error).toBeInstanceOf(TaskDeskApiError);
    // The trusted message carries no server text; the detail is kept separately so it
    // can be wrapped as untrusted content.
    expect(error.message).toBe("/api/task/missing: HTTP 404");
    expect(error.detail).toBe("Task not found");
  });

  it("sends only bounded tool telemetry and ignores the response body", async () => {
    const auth = {
      usingApiKey: true,
      getAccessToken: vi.fn().mockResolvedValue("token-123"),
      clearToken: vi.fn().mockResolvedValue(undefined),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const client = new TaskDeskClient({
      baseUrl: "https://api.example.com",
      auth: auth as never,
    });

    await client.reportToolInvocation({
      invocationId: "0b0f6d72-4f0f-4a43-9a1c-7f2a6f3d1e55",
      toolName: "whoami",
      durationMs: 14,
      outcome: "error",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/mcp/tool-reports");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer token-123",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      invocationId: "0b0f6d72-4f0f-4a43-9a1c-7f2a6f3d1e55",
      toolName: "whoami",
      durationMs: 14,
      outcome: "error",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps reporting best-effort, bounded in duration and in flight", async () => {
    vi.useFakeTimers();
    const auth = {
      usingApiKey: true,
      getAccessToken: vi.fn(() => new Promise<string>(() => undefined)),
      clearToken: vi.fn().mockResolvedValue(undefined),
    };
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const client = new TaskDeskClient({
      baseUrl: "https://api.example.com",
      auth: auth as never,
    });
    const report = {
      invocationId: "0b0f6d72-4f0f-4a43-9a1c-7f2a6f3d1e55",
      toolName: "whoami",
      durationMs: 14,
      outcome: "success" as const,
    };

    const pending = Array.from({ length: 9 }, () =>
      client.reportToolInvocation(report),
    );
    expect(auth.getAccessToken).toHaveBeenCalledTimes(8);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);
    await Promise.all(pending);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.getAccessToken).toHaveBeenCalledTimes(8);
  });

  it("swallows telemetry transport failures", async () => {
    const auth = {
      usingApiKey: true,
      getAccessToken: vi.fn().mockResolvedValue("token-123"),
      clearToken: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("private network error")) as typeof fetch;
    const client = new TaskDeskClient({
      baseUrl: "https://api.example.com",
      auth: auth as never,
    });
    await expect(
      client.reportToolInvocation({
        invocationId: "0b0f6d72-4f0f-4a43-9a1c-7f2a6f3d1e55",
        toolName: "whoami",
        durationMs: 14,
        outcome: "success",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not initiate telemetry authorization outside personal API-key mode", async () => {
    const auth = {
      usingApiKey: false,
      getAccessToken: vi.fn().mockResolvedValue("oauth-token"),
      clearToken: vi.fn().mockResolvedValue(undefined),
    };
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const client = new TaskDeskClient({
      baseUrl: "https://api.example.com",
      auth: auth as never,
    });

    await client.reportToolInvocation({
      invocationId: "0b0f6d72-4f0f-4a43-9a1c-7f2a6f3d1e55",
      toolName: "whoami",
      durationMs: 14,
      outcome: "success",
    });

    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
