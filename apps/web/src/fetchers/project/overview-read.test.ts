import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectOverview, projectOverviewKeys } from "./overview-read";

const get = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({
  client: { project: { ":id": { overview: { $get: get } } } },
}));

beforeEach(() => get.mockReset());

describe("project overview read", () => {
  it("returns the response and uses the existing query key", async () => {
    get.mockResolvedValue(new Response('{"count":1}', { status: 200 }));
    await expect(getProjectOverview("p1")).resolves.toEqual({ count: 1 });
    expect(get).toHaveBeenCalledWith({ param: { id: "p1" } });
    expect(projectOverviewKeys.overview("p1")).toEqual([
      "project-overview",
      "p1",
      "overview",
    ]);
  });

  it("retains response errors and the fallback when the body cannot be read", async () => {
    get.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    await expect(getProjectOverview("p1")).rejects.toMatchObject({
      status: 403,
      message: "denied",
    });
    get.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error()),
    });
    await expect(getProjectOverview("p1")).rejects.toMatchObject({
      status: 500,
      message: "Failed to load the overview",
    });
  });
});
