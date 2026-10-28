import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  project: vi.fn(),
  search: vi.fn(),
}));
vi.mock("@taskdesk/libs", () => ({
  client: { projects: { ":projectId": { "work-items": { $get: mock.get } } } },
}));
vi.mock("@/fetchers/project/get-project", () => ({ default: mock.project }));
vi.mock("@/fetchers/work-item/search-work-items", () => ({
  default: mock.search,
}));

import { getScheduleProject } from "./get-schedule-project";

const item = (number: number) => ({
  key: `service-team-${number}`,
  id: `row-${number}`,
  title: `Task ${number}`,
  number,
  projectId: "p1",
  workspaceId: "w1",
  stateId: "state1",
  stateName: "Working",
  priority: "high",
  startDate: "2026-10-21T11:00:00Z",
  dueDate: "2026-10-24T16:30:00Z",
  position: String(number),
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
  version: 7,
  assigneeId: null,
  assigneeName: null,
  labels: [{ id: "label-1", name: "Customer", color: "blue" }],
});
const response = (data: ReturnType<typeof item>[], next: string | null) =>
  new Response(
    JSON.stringify({
      data,
      page: { hasMore: next !== null, nextCursor: next },
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mock.project.mockResolvedValue({
    slug: "service-team",
    name: "Service team",
  });
});
describe("canonical Kaneo schedule adapter", () => {
  it("includes canonical items past 200 with their dates, versions and addressable keys", async () => {
    mock.get
      .mockResolvedValueOnce(
        response(
          Array.from({ length: 200 }, (_, i) => item(i + 1)),
          "next-200",
        ),
      )
      .mockResolvedValueOnce(response([item(201)], null));
    const data = await getScheduleProject("p1", "w1");
    expect(data.columns[0].tasks).toHaveLength(201);
    expect(data.columns[0].tasks[200]).toMatchObject({
      id: "service-team-201",
      startDate: "2026-10-21T11:00:00Z",
      version: 7,
    });
    expect(mock.get.mock.calls[1][0].query.cursor).toBe("next-200");
    expect(mock.project).toHaveBeenCalledWith({ id: "p1", workspaceId: "w1" });
  });
  it("applies the canonical filter to every schedule page and retains real labels", async () => {
    mock.search
      .mockResolvedValueOnce({
        items: [{ key: "service-team-2" }],
        hasMore: true,
        nextCursor: "search-page-2",
      })
      .mockResolvedValueOnce({
        items: [{ key: "service-team-3" }],
        hasMore: false,
      });
    mock.get.mockResolvedValue(response([item(1), item(2), item(3)], null));
    const data = await getScheduleProject(
      "p1",
      "w1",
      undefined,
      "label:Customer",
    );
    expect(data.columns[0].tasks.map((task) => task.id)).toEqual([
      "service-team-2",
      "service-team-3",
    ]);
    expect(data.columns[0].tasks[0].labels).toEqual([
      { id: "label-1", name: "Customer", color: "blue" },
    ]);
    expect(mock.search.mock.calls[1][0]).toMatchObject({
      filter: "label:Customer",
      projectSlug: "service-team",
      workspaceId: "w1",
      cursor: "search-page-2",
    });
  });
  it("fails closed when pagination repeats instead of silently truncating", async () => {
    mock.get.mockImplementation(async () => response([item(1)], "same"));
    await expect(getScheduleProject("p1", "w1")).rejects.toThrow(
      "cursor did not advance",
    );
  });
  it("keeps a project permission refusal as an error", async () => {
    mock.get.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(getScheduleProject("p1", "w1")).rejects.toMatchObject({
      status: 403,
    });
  });
});
