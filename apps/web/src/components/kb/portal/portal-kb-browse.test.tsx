import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  categories: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/kb/portal", () => ({
  getPortalKb: (...args: unknown[]) => mocks.list(...args),
  getPortalKbCategories: (...args: unknown[]) => mocks.categories(...args),
}));

import { PortalKbBrowse } from "./portal-kb-browse";

beforeEach(() => {
  mocks.list.mockResolvedValue({ articles: [], total: 0 });
  mocks.categories.mockResolvedValue({
    categories: [
      {
        id: "c1",
        name: "Network and VPN",
        parentId: null,
        position: 0,
        articleCount: 1,
      },
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortalKbBrowse layout", () => {
  it("shows an empty result immediately after a slow load", async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (value: { articles: never[]; total: number }) => void;
      mocks.list.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      render(
        <QueryClientProvider client={new QueryClient()}>
          <PortalKbBrowse search={{}} scope="customer-1" />
        </QueryClientProvider>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByRole("status")).toBeVisible();
      await act(async () => {
        resolve({ articles: [], total: 0 });
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText("kb:portal.emptyTitle")).toBeVisible();
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
  // A-22: the portal sidebar takes ~240px of the viewport, so a viewport breakpoint put the
  // categories beside the articles in a ~220px column at 768px. The two columns now follow the
  // page's own width (a container query), and stack below it. jsdom has no layout, so the
  // classes are the contract; the e2e spec checks the real boxes.
  it("places categories beside the articles only when the page itself is wide", async () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PortalKbBrowse search={{}} scope="customer-1" />
      </QueryClientProvider>,
    );

    // The portal shell's inset is the page's one `main`; the page root is a plain container.
    expect(screen.queryByRole("main")).toBeNull();
    const pageRoot = container.firstElementChild;
    if (!pageRoot) throw new Error("page rendered nothing");
    expect(pageRoot.className.split(/\s+/)).toContain("@container");
    const nav = await screen.findByRole("navigation", {
      name: "kb:portal.categories",
    });
    const grid = nav.parentElement;
    if (!grid) throw new Error("category list has no grid");
    const classes = grid.className.split(/\s+/);
    expect(classes).toContain("@2xl:grid-cols-[14rem_1fr]");
    expect(
      classes.filter((name) => /^(sm|md|lg):grid-cols/.test(name)),
    ).toEqual([]);
    expect(await screen.findByText("Network and VPN")).toBeTruthy();
  });
});
