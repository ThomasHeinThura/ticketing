import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadCsvBlob, downloadWorkItemsCsv } from "./export-work-items";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  client: { "work-items": { export: { $post: mocks.post } } },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.post.mockReset();
});

describe("work item CSV downloads", () => {
  it("downloads the CSV with its filename and revokes the object URL", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:work-items");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.href).toBe("blob:work-items");
        expect(this.download).toBe("help-work-items.csv");
        expect(this.isConnected).toBe(true);
      });
    mocks.post.mockResolvedValue({
      ok: true,
      text: async () => "key\r\nHELP-1\r\n",
    });

    await downloadWorkItemsCsv({
      workspaceId: "ws",
      projectSlug: "HELP",
      sort: "key",
      dir: "asc",
    });

    const blob = createObjectURL.mock.calls[0]?.[0] as unknown as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toBe("key\r\nHELP-1\r\n");
    expect(click).toHaveBeenCalledOnce();
    expect(
      document.querySelector('a[download="help-work-items.csv"]'),
    ).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:work-items");
  });

  it("cleans up the anchor and URL when clicking fails", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:work-items"),
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("click failed");
    });

    expect(() => downloadCsvBlob("csv", "test.csv")).toThrow("click failed");
    expect(document.querySelector('a[download="test.csv"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:work-items");
  });

  it("propagates export errors without starting a download", async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    mocks.post.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "limit" }),
    });

    await expect(
      downloadWorkItemsCsv({
        workspaceId: "ws",
        projectSlug: "HELP",
        sort: "key",
        dir: "asc",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
