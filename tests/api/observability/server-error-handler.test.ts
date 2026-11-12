import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { ImportConnectError } from "../../../apps/api/src/imports/engine/connect-error";
import { handleServerError } from "../../../apps/api/src/observability/server-error-handler";

describe("server error handler", () => {
  it.each(["error", "exception"])(
    "handles %s once with a matching reference",
    async (kind) => {
      const log = vi.fn();
      const app = new Hono();
      app.get("/test/:id", () => {
        if (kind === "exception")
          throw new HTTPException(500, {
            message: "person@example.com token-secret",
          });
        throw new Error("person@example.com token-secret");
      });
      app.onError((error, context) => handleServerError(error, context, log));
      const response = await app.request("/test/123?token=secret");
      const body = (await response.json()) as {
        message: string;
        requestId: string;
      };
      expect(response.status).toBe(500);
      expect(body).toEqual({
        message: "Internal Server Error",
        requestId: response.headers.get("x-taskdesk-request-id"),
      });
      expect(body.requestId).toMatch(/^[0-9a-f]{32}$/);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: body.requestId,
          method: "GET",
          route: "/test/:id",
          status: 500,
        }),
      );
      expect(Object.keys(log.mock.calls[0]?.[0] ?? {})).toEqual([
        "requestId",
        "method",
        "route",
        "status",
        "errorClass",
        "stack",
      ]);
    },
  );
  it("does not log a 4xx", async () => {
    const log = vi.fn();
    const app = new Hono();
    app.get("/test", () => {
      throw new HTTPException(403, { message: "Forbidden" });
    });
    app.onError((error, context) => handleServerError(error, context, log));
    expect((await app.request("/test")).status).toBe(403);
    expect(log).not.toHaveBeenCalled();
  });
});

it("preserves the established 503 factor policy code and returns the reference", async () => {
  const app = new Hono();
  app.get("/factor", () => {
    throw new HTTPException(503, { message: "factor_policy_unavailable" });
  });
  app.onError((error, context) => handleServerError(error, context, vi.fn()));
  const response = await app.request("/factor");
  const body = (await response.json()) as {
    message: string;
    requestId: string;
  };
  expect(response.status).toBe(503);
  expect(body.message).toBe("factor_policy_unavailable");
  expect(body.requestId).toBe(response.headers.get("x-taskdesk-request-id"));
});

it("does not surface untrusted 502 response reasons", async () => {
  const app = new Hono();
  app.get("/test", () => {
    throw new HTTPException(502, {
      message: "Source connection failed",
      res: Response.json(
        { reason: "private_secret", detail: "internal" },
        { status: 502 },
      ),
    });
  });
  app.onError((error, context) => handleServerError(error, context, vi.fn()));
  const response = await app.request("/test");
  const body = await response.json();
  expect(body).toMatchObject({ message: "Internal Server Error" });
  expect(JSON.stringify(body)).not.toContain("private_secret");
  expect(JSON.stringify(body)).not.toContain("internal");
});

// The web import fetcher (apps/web/src/fetchers/god-mode/imports.test.ts) reads exactly this
// body; the two tests together pin the contract without one app importing the other.
it("keeps an allowlisted import reason next to the reference", async () => {
  const app = new Hono();
  app.get("/test", () => {
    throw new ImportConnectError("auth_failed");
  });
  app.onError((error, context) => handleServerError(error, context, vi.fn()));
  const response = await app.request("/test");
  const body = (await response.json()) as Record<string, unknown>;
  expect(response.status).toBe(502);
  expect(body).toEqual({
    message: "Source connection failed",
    reason: "auth_failed",
    requestId: response.headers.get("x-taskdesk-request-id"),
  });
  expect(body.requestId).toMatch(/^[0-9a-f]{32}$/);
});

it("preserves the fixed pending-action failure code while redacting its cause", async () => {
  const app = new Hono();
  app.get("/pending", () => {
    throw new HTTPException(500, {
      message: "pending_action_failed",
      cause: new Error("private failure detail"),
    });
  });
  app.onError((error, context) => handleServerError(error, context, vi.fn()));
  const response = await app.request("/pending");
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.message).toBe("pending_action_failed");
  expect(body.requestId).toBe(response.headers.get("x-taskdesk-request-id"));
  expect(JSON.stringify(body)).not.toContain("private failure detail");
});
