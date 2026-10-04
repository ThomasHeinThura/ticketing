import type { AppType } from "@taskdesk/api";
import { hc } from "hono/client";
import { describe, expect, it } from "vitest";
import { createApiFetch, windowId, withTaskDeskRequestHeaders } from "./hono";

describe("withTaskDeskRequestHeaders", () => {
  it("preserves Hono Headers objects and adds TaskDesk headers", () => {
    const init = withTaskDeskRequestHeaders(
      { headers: new Headers({ "If-Match": '"4"', "X-Custom": "kept" }) },
      "window-1",
    );
    const headers = new Headers(init.headers);

    expect(headers.get("if-match")).toBe('"4"');
    expect(headers.get("x-custom")).toBe("kept");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-taskdesk-window-id")).toBe("window-1");
    expect(init.credentials).toBe("include");
  });
});

const apiBaseUrl = "http://taskdesk.test/api";
const expiresAt = () => new Date(Date.now() + 5 * 60_000).toISOString();

function tokenResponse(token = "signed-csrf-token") {
  return Response.json({ token, expiresAt: expiresAt() });
}

describe("TaskDesk Hono transport", () => {
  it("preserves Hono headers and attaches a fresh session token to unsafe requests", async () => {
    const requests: Request[] = [];
    const issuerRequests: Request[] = [];
    const apiFetch = createApiFetch(
      async (input, init) => {
        const request = new Request(input, init);
        if (request.url === `${apiBaseUrl}/me/csrf-token`) {
          issuerRequests.push(request);
          return tokenResponse();
        }
        requests.push(request);
        return Response.json({ version: 2 });
      },
      { apiBaseUrl },
    );
    const apiClient = hc<AppType>(apiBaseUrl, { fetch: apiFetch });

    const response = await apiClient.v2.task[":id"].$put({
      param: { id: "task-1" },
      header: { "if-match": '"1"' },
      json: {
        userId: "",
        title: "Task",
        description: "",
        status: "to-do",
        priority: "medium",
        projectId: "project-1",
        position: 1,
      },
    });

    expect(response.status).toBe(200);
    expect(issuerRequests).toHaveLength(1);
    expect(issuerRequests[0]?.method).toBe("GET");
    expect(issuerRequests[0]?.credentials).toBe("include");
    expect(issuerRequests[0]?.cache).toBe("no-store");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://taskdesk.test/api/v2/task/task-1");
    expect(requests[0]?.headers.get("if-match")).toBe('"1"');
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(requests[0]?.headers.get("x-taskdesk-window-id")).toBe(windowId);
    expect(requests[0]?.headers.get("x-taskdesk-csrf")).toBe(
      "signed-csrf-token",
    );
    expect(requests[0]?.credentials).toBe("include");
  });

  it("does not fetch a token for safe API reads and preserves caller headers", async () => {
    let request: Request | undefined;
    const apiFetch = createApiFetch(
      async (input, init) => {
        request = new Request(input, init);
        return Response.json({ value: true });
      },
      { apiBaseUrl },
    );
    const response = await apiFetch(`${apiBaseUrl}/projects`, {
      headers: { "x-caller-context": "kept" },
    });

    expect(response.status).toBe(200);
    expect(request?.method).toBe("GET");
    expect(request?.headers.get("x-caller-context")).toBe("kept");
    expect(request?.credentials).toBe("include");
    expect(request?.headers.has("x-taskdesk-csrf")).toBe(false);
  });

  it("retries exactly once for a recognized pre-handler CSRF failure", async () => {
    let tokenCount = 0;
    const mutationRequests: Request[] = [];
    const apiFetch = createApiFetch(
      async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/me/csrf-token")) {
          tokenCount += 1;
          return tokenResponse(`token-${tokenCount}`);
        }
        mutationRequests.push(request);
        if (mutationRequests.length === 1) {
          return Response.json(
            { message: "csrf_token_mismatch" },
            { status: 403 },
          );
        }
        return Response.json({ saved: true });
      },
      { apiBaseUrl },
    );

    const response = await apiFetch(`${apiBaseUrl}/notification-preferences`, {
      method: "PUT",
      redirect: "follow",
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(200);
    expect(tokenCount).toBe(2);
    expect(mutationRequests).toHaveLength(2);
    expect(mutationRequests[0]?.headers.get("x-taskdesk-csrf")).toBe("token-1");
    expect(mutationRequests[1]?.headers.get("x-taskdesk-csrf")).toBe("token-2");
    expect(mutationRequests.map((request) => request.redirect)).toEqual([
      "error",
      "error",
    ]);
    expect(await mutationRequests[1]?.text()).toBe(
      JSON.stringify({ enabled: true }),
    );
  });

  it("does not retry a generic 403 or send a mutation when token acquisition fails", async () => {
    let mutationCount = 0;
    let tokenCount = 0;
    const genericForbiddenFetch = createApiFetch(
      async (input) => {
        if (
          new URL(
            input instanceof Request ? input.url : String(input),
          ).pathname.endsWith("/me/csrf-token")
        ) {
          tokenCount += 1;
          return tokenResponse();
        }
        mutationCount += 1;
        return Response.json({ message: "forbidden" }, { status: 403 });
      },
      { apiBaseUrl },
    );
    const forbidden = await genericForbiddenFetch(`${apiBaseUrl}/projects`, {
      method: "POST",
      body: "{}",
    });
    expect(forbidden.status).toBe(403);
    expect(tokenCount).toBe(1);
    expect(mutationCount).toBe(1);

    mutationCount = 0;
    const failedIssuerFetch = createApiFetch(
      async (input) => {
        if (
          new URL(
            input instanceof Request ? input.url : String(input),
          ).pathname.endsWith("/me/csrf-token")
        ) {
          return Response.json({ message: "unauthenticated" }, { status: 401 });
        }
        mutationCount += 1;
        return Response.json({ saved: true });
      },
      { apiBaseUrl },
    );
    await expect(
      failedIssuerFetch(`${apiBaseUrl}/projects`, {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("Unable to obtain CSRF token");
    expect(mutationCount).toBe(0);
  });

  it("rejects an expired issuer token before sending the unsafe request", async () => {
    let mutationCount = 0;
    const apiFetch = createApiFetch(
      async (input) => {
        if (
          new URL(
            input instanceof Request ? input.url : String(input),
          ).pathname.endsWith("/me/csrf-token")
        ) {
          return Response.json({
            token: "stale-token",
            expiresAt: "2000-01-01T00:00:00.000Z",
          });
        }
        mutationCount += 1;
        return Response.json({ saved: true });
      },
      { apiBaseUrl },
    );
    await expect(
      apiFetch(`${apiBaseUrl}/projects`, { method: "POST", body: "{}" }),
    ).rejects.toThrow("Unable to obtain CSRF token");
    expect(mutationCount).toBe(0);
  });

  it("obtains a new token for every unsafe request and leaves Better Auth bootstrap alone", async () => {
    let tokenCount = 0;
    const mutationTokens: string[] = [];
    const apiFetch = createApiFetch(
      async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/me/csrf-token")) {
          tokenCount += 1;
          return tokenResponse(`token-${tokenCount}`);
        }
        mutationTokens.push(request.headers.get("x-taskdesk-csrf") ?? "none");
        return Response.json({ ok: true });
      },
      { apiBaseUrl },
    );

    await apiFetch(`${apiBaseUrl}/projects`, { method: "POST", body: "{}" });
    await apiFetch(`${apiBaseUrl}/projects/project-1`, {
      method: "DELETE",
    });
    await apiFetch(`${apiBaseUrl}/auth/sign-in/email`, {
      method: "POST",
      body: "{}",
    });

    expect(tokenCount).toBe(2);
    expect(mutationTokens).toEqual(["token-1", "token-2", "none"]);
  });

  it("does not treat an Authorization header as resolved nonambient auth", async () => {
    let tokenCount = 0;
    let mutationRequest: Request | undefined;
    const apiFetch = createApiFetch(
      async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/me/csrf-token")) {
          tokenCount += 1;
          return tokenResponse();
        }
        mutationRequest = request;
        return Response.json({ ok: true });
      },
      { apiBaseUrl },
    );

    await apiFetch(`${apiBaseUrl}/instance/users/user-1/reset-mfa`, {
      method: "POST",
      headers: { Authorization: "Bearer explicitly-provided" },
      body: "{}",
    });

    expect(tokenCount).toBe(1);
    expect(mutationRequest?.headers.get("authorization")).toBe(
      "Bearer explicitly-provided",
    );
    expect(mutationRequest?.headers.has("x-taskdesk-csrf")).toBe(true);
  });

  it("preserves Request-object methods and headers while refreshing stale CSRF", async () => {
    let issuerCount = 0;
    let mutationRequest: Request | undefined;
    const apiFetch = createApiFetch(
      async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/me/csrf-token")) {
          issuerCount += 1;
          return tokenResponse();
        }
        mutationRequest = request;
        return Response.json({ updated: true });
      },
      { apiBaseUrl },
    );
    const request = new Request(`${apiBaseUrl}/projects/project-1`, {
      method: "PATCH",
      redirect: "follow",
      headers: {
        "x-request-context": "preserved",
        "x-taskdesk-csrf": "stale-token",
      },
      body: JSON.stringify({ name: "Updated" }),
    });

    const response = await apiFetch(request, {
      headers: { "x-init-context": "also-preserved" },
    });

    expect(response.status).toBe(200);
    expect(issuerCount).toBe(1);
    expect(mutationRequest?.method).toBe("PATCH");
    expect(mutationRequest?.redirect).toBe("error");
    expect(mutationRequest?.headers.get("x-request-context")).toBe("preserved");
    expect(mutationRequest?.headers.get("x-init-context")).toBe(
      "also-preserved",
    );
    expect(mutationRequest?.headers.get("x-taskdesk-csrf")).toBe(
      "signed-csrf-token",
    );
  });

  it("treats same-origin paths outside the configured API prefix as foreign", async () => {
    let request: Request | undefined;
    let issuerCount = 0;
    const apiFetch = createApiFetch(
      async (input, init) => {
        request = new Request(input, init);
        if (request.url.endsWith("/me/csrf-token")) issuerCount += 1;
        return Response.json({ ok: true });
      },
      { apiBaseUrl },
    );

    await apiFetch("http://taskdesk.test/apiary/upload", {
      method: "PUT",
      headers: { "x-taskdesk-csrf": "do-not-forward" },
      credentials: "include",
      body: "opaque",
    });

    expect(issuerCount).toBe(0);
    expect(request?.credentials).toBe("omit");
    expect(request?.headers.has("x-taskdesk-csrf")).toBe(false);
  });

  it("sends no TaskDesk headers or credentials to a foreign URL", async () => {
    let request: Request | undefined;
    const apiFetch = createApiFetch(
      async (input, init) => {
        request = new Request(input, init);
        return Response.json({ stored: true });
      },
      { apiBaseUrl },
    );

    await apiFetch("https://uploads.example.test/object?signature=opaque", {
      method: "PUT",
      headers: {
        authorization: "Bearer private-session-credential",
        "content-type": "image/png",
        "x-api-key": "private-api-key",
        "x-taskdesk-csrf": "private-csrf-token",
        "x-taskdesk-step-up-token": "private-step-up-token",
        "x-taskdesk-window-id": "private-window-id",
      },
      credentials: "include",
      body: new Blob(["bytes"], { type: "image/png" }),
    });

    expect(request?.credentials).toBe("omit");
    expect(request?.headers.get("content-type")).toBe("image/png");
    expect(request?.headers.has("x-taskdesk-csrf")).toBe(false);
    expect(request?.headers.has("x-taskdesk-step-up-token")).toBe(false);
    expect(request?.headers.has("x-taskdesk-window-id")).toBe(false);
    expect(request?.headers.has("authorization")).toBe(false);
    expect(request?.headers.has("x-api-key")).toBe(false);
  });
});
