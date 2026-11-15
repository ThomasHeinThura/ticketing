import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => {
  return {
    executeMock: vi.fn(),
  };
});

vi.mock("./database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./database")>();
  return {
    ...actual,
    getDatabase: () => ({
      execute: executeMock,
    }),
  };
});

import app, { setServerShuttingDownForTest } from "./index";

describe("GET /api/public/health/ready shutdown gate (DO-11)", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    setServerShuttingDownForTest(false);
  });

  afterEach(() => {
    setServerShuttingDownForTest(false);
  });

  it("returns 200 ok when server is healthy and not shutting down", async () => {
    const response = await app.request("/api/public/health/ready", {
      headers: { host: "localhost:5173" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 immediately without querying Postgres when serverShuttingDown is true", async () => {
    setServerShuttingDownForTest(true);

    const response = await app.request("/api/public/health/ready", {
      headers: { host: "localhost:5173" },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error" });
    expect(executeMock).not.toHaveBeenCalled();
  });
});
