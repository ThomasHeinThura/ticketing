import { afterEach, describe, expect, it, vi } from "vitest";
import { importWithRetry, isChunkLoadError } from "@/lib/lazy-retry";

vi.mock("@/lib/lazy-retry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lazy-retry")>()),
  importWithRetry: vi.fn(),
}));

const importDetail = vi.mocked(importWithRetry);

afterEach(() => {
  vi.resetModules();
  importDetail.mockReset();
});

describe("loadWorkItemDetail", () => {
  it("loads the detail module", async () => {
    importDetail.mockResolvedValue({ default: () => null });
    const { default: loadWorkItemDetail } = await import(
      "./load-work-item-detail"
    );
    await expect(loadWorkItemDetail()).resolves.toHaveProperty("default");
  });

  it("reports a stylesheet that failed during a hover prefetch when the detail is opened", async () => {
    const cssError = new Error(
      "Unable to preload CSS for /assets/editor-styles.css",
    );
    // Vite records the stylesheet as requested, so the second import resolves without it.
    importDetail
      .mockRejectedValueOnce(cssError)
      .mockResolvedValue({ default: () => null });
    const { default: loadWorkItemDetail } = await import(
      "./load-work-item-detail"
    );
    // The list's hover prefetch swallows its own failure.
    await loadWorkItemDetail().catch(() => {});
    // The real open reaches the error screen instead of rendering unstyled.
    await expect(loadWorkItemDetail()).rejects.toBe(cssError);
    expect(isChunkLoadError(cssError)).toBe(true);
    expect(importDetail).toHaveBeenCalledTimes(1);
  });
});
