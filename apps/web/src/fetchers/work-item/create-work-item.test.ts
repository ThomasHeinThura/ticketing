import { beforeEach, describe, expect, it, vi } from "vitest";
import createWorkItem from "./create-work-item";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    projects: {
      ":projectId": {
        "work-items": {
          $post: mocks.post,
        },
      },
    },
  },
}));

describe("createWorkItem", () => {
  beforeEach(() => {
    mocks.post.mockReset();
  });

  it("posts the body to the project's work-items route and returns the created row", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "wi-1", key: "PROJ-1" }),
    });

    const result = await createWorkItem({
      projectId: "proj-1",
      typeId: "type-1",
      title: "Fix it",
      priority: "high",
    });

    expect(mocks.post).toHaveBeenCalledWith({
      param: { projectId: "proj-1" },
      json: { typeId: "type-1", title: "Fix it", priority: "high" },
    });
    expect(result).toEqual({ id: "wi-1", key: "PROJ-1" });
  });

  it("omits absent optional fields from the body rather than sending nulls", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "wi-1" }),
    });

    await createWorkItem({
      projectId: "proj-1",
      typeId: "type-1",
      title: "Fix it",
      description: undefined,
      priority: undefined,
    });

    expect(mocks.post).toHaveBeenCalledWith({
      param: { projectId: "proj-1" },
      json: { typeId: "type-1", title: "Fix it" },
    });
  });

  it("throws an HttpError carrying the real status for a non-ok response (the dialog splits 403 and 400)", async () => {
    mocks.post.mockResolvedValue({ ok: false, status: 403 });

    await expect(
      createWorkItem({ projectId: "proj-1", typeId: "t", title: "x" }),
    ).rejects.toMatchObject({ name: "HttpError", status: 403 });
  });
});

it("sends all initial fields in one request and preserves atomic rejection status", async () => {
  mocks.post.mockReset();
  mocks.post.mockResolvedValue({ ok: true, json: async () => ({ id: "new" }) });
  const input = {
    projectId: "project",
    typeId: "type",
    title: "Atomic create",
    startDate: "2026-10-22T00:00:00.000Z",
    dueDate: "2026-10-23T00:00:00.000Z",
    labelIds: ["label"],
    assigneeId: "person",
  };
  await createWorkItem(input);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  const { projectId, ...body } = input;
  expect(mocks.post).toHaveBeenCalledWith({ param: { projectId }, json: body });
  mocks.post.mockResolvedValue({ ok: false, status: 422 });
  await expect(createWorkItem(input)).rejects.toMatchObject({ status: 422 });
});
