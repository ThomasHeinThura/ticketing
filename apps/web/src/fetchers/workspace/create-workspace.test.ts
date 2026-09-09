import { beforeEach, describe, expect, it, vi } from "vitest";
import createWorkspace from "./create-workspace";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      $post: mocks.post,
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: {
      list: mocks.list,
    },
  },
}));

describe("createWorkspace", () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.list.mockReset();
    mocks.list.mockResolvedValue({ data: [] });
  });

  it("posts to the native workspace route and returns the created workspace", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-1", name: "Acme", slug: "acme" }),
    });

    const result = await createWorkspace({ name: "Acme", slug: "acme" });

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledWith({
      json: {
        name: "Acme",
        slug: "acme",
        logo: undefined,
        description: undefined,
      },
    });
    expect(result).toEqual({ id: "workspace-1", name: "Acme", slug: "acme" });
  });

  it("omits an empty description rather than sending an empty string", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-1" }),
    });

    await createWorkspace({ name: "Acme", slug: "acme", description: "" });

    expect(mocks.post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ description: undefined }),
      }),
    );
  });

  it("preserves a non-empty description", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-1" }),
    });

    await createWorkspace({
      name: "Acme",
      slug: "acme",
      description: "Our team",
    });

    expect(mocks.post).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ description: "Our team" }),
      }),
    );
  });

  it("derives a slug from existing workspaces when none is supplied", async () => {
    mocks.list.mockResolvedValue({
      data: [{ slug: "acme" }, { slug: "other" }],
    });
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-2" }),
    });

    await createWorkspace({ name: "Acme" });

    expect(mocks.list).toHaveBeenCalledTimes(1);
    const sentSlug = mocks.post.mock.calls[0]?.[0]?.json?.slug;
    expect(sentSlug).toMatch(/^acme-[0-9a-f]{12}$/);
  });

  it("retries with a new slug on a 409 slug collision when no slug was supplied by the caller", async () => {
    mocks.post
      .mockResolvedValueOnce({
        ok: false,
        text: async () => "That workspace slug is already taken",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "workspace-3" }),
      });

    const result = await createWorkspace({ name: "Acme" });

    expect(mocks.post).toHaveBeenCalledTimes(2);
    const firstSlug = mocks.post.mock.calls[0]?.[0]?.json?.slug;
    const secondSlug = mocks.post.mock.calls[1]?.[0]?.json?.slug;
    expect(secondSlug).not.toEqual(firstSlug);
    expect(result).toEqual({ id: "workspace-3" });
  });

  it("does not retry a 409 when the caller supplied the slug explicitly", async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      text: async () => "That workspace slug is already taken",
    });

    await expect(
      createWorkspace({ name: "Acme", slug: "acme" }),
    ).rejects.toThrow("already taken");

    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-collision error immediately without retrying", async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      text: async () => "Workspace creation is disabled on this instance",
    });

    await expect(createWorkspace({ name: "Acme" })).rejects.toThrow(
      "disabled on this instance",
    );

    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
