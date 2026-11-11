import type { Page, Route } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { installPerformanceApiFixture } from "../../e2e/helpers/g11-performance-fixture";

async function fixture(boardProject: boolean) {
  let handler: ((route: Route) => Promise<unknown>) | undefined;
  const page = {
    routeWebSocket: async () => {},
    route: async (_pattern: string, callback: typeof handler) => {
      handler = callback;
    },
    addInitScript: async () => {},
  } as unknown as Page;
  await installPerformanceApiFixture(page, { boardProject });
  if (!handler) throw new Error("Fixture API handler was not installed");
  const apiHandler = handler;
  return async (path: string, method = "GET") => {
    let response: { status: number; body: string } | undefined;
    const request = {
      url: () => `http://127.0.0.1:4178${path}`,
      method: () => method,
    };
    await apiHandler({
      request: () => request,
      fulfill: async (value: { status: number; body: string }) => {
        response = value;
      },
    } as unknown as Route);
    if (!response) throw new Error(`No response for ${method} ${path}`);
    return { status: response.status, body: JSON.parse(response.body) };
  };
}

describe("G11 canonical board detail fixture", () => {
  it("serves the requested board item and its empty detail sections", async () => {
    const request = await fixture(true);
    const item = await request("/api/work-items/BRD-1");
    const children = await request("/api/work-items/BRD-1/children");
    expect(item.status).toBe(200);
    expect(children.status).toBe(200);
    expect(children.body.parent).toEqual(item.body);
    for (const section of [
      "labels",
      "attachments",
      "comments/mention-candidates",
    ]) {
      expect(await request(`/api/work-items/BRD-1/${section}`)).toEqual({
        status: 200,
        body: [],
      });
    }
    expect((await request("/api/work-items/BRD-1/relations")).body).toEqual({
      data: [],
      hiddenCount: 0,
    });
    expect((await request("/api/work-items/BRD-1/activity")).status).toBe(200);
    expect((await request("/api/work-items/BRD-1/approvals")).status).toBe(200);
    expect(
      (await request("/api/work-items/BRD-1/approval-request-context")).status,
    ).toBe(200);
    expect(
      (await request("/api/work-items/WLP-1/children")).body.parent.key,
    ).toBe("WLP-1");
  });

  it("rejects missing, disabled, deleted, and unsupported board detail reads", async () => {
    const disabled = await fixture(false);
    expect((await disabled("/api/work-items/BRD-1/children")).status).toBe(404);
    const request = await fixture(true);
    expect((await request("/api/work-items/BRD-201/children")).status).toBe(
      404,
    );
    expect(
      (await request("/api/work-items/BRD-1/unknown-section")).status,
    ).toBe(404);
    const deletion = await request("/api/work-items/BRD-1", "DELETE");
    expect(deletion.status).toBe(202);
    expect((await request(deletion.body.approveUrl, "POST")).status).toBe(200);
    expect((await request("/api/work-items/BRD-1/children")).status).toBe(404);
    expect((await request("/api/work-items/BRD-1/labels")).status).toBe(404);
  });
});
