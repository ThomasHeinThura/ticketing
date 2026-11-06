import { describe, expect, it, vi } from "vitest";
import { loadSidebarModule } from "./layout";

const importWithRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/lazy-retry", () => ({ importWithRetry }));
vi.mock("@/components/nav-projects", () => ({}));

describe("loadSidebarModule", () => {
  it("does not keep a failed sidebar import, so the next call imports again", async () => {
    const sidebar = { AppSidebar: () => null };
    importWithRetry
      .mockRejectedValueOnce(
        new TypeError(
          "Failed to fetch dynamically imported module: /assets/app-sidebar.js",
        ),
      )
      .mockResolvedValueOnce(sidebar);

    await expect(loadSidebarModule()).rejects.toThrow(
      "Failed to fetch dynamically imported module",
    );
    await expect(loadSidebarModule()).resolves.toBe(sidebar);
    // A loaded sidebar is kept: later pages do not import it again.
    await expect(loadSidebarModule()).resolves.toBe(sidebar);
    expect(importWithRetry).toHaveBeenCalledTimes(2);
  });
});
