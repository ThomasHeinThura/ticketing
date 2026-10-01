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

describe("TaskDesk Hono transport", () => {
  it("preserves Hono client headers on the actual Request sent to fetch", async () => {
    let request: Request | undefined;
    const apiClient = hc<AppType>("http://taskdesk.test/api", {
      fetch: createApiFetch(async (input, init) => {
        request = new Request(input, init);
        return Response.json({ version: 2 });
      }),
    });

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
    expect(request).toBeDefined();
    expect(request?.url).toBe("http://taskdesk.test/api/v2/task/task-1");
    expect(request?.headers.get("if-match")).toBe('"1"');
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(request?.headers.get("x-taskdesk-window-id")).toBe(windowId);
  });
});
