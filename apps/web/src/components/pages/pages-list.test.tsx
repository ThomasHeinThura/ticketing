import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageList } from "@/fetchers/pages";

const mocks = vi.hoisted(() => ({ getPages: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/fetchers/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/pages")>()),
  getPages: (...args: unknown[]) => mocks.getPages(...args),
}));

import { HttpError } from "@/lib/http-error";
import { PagesList } from "./pages-list";

function page(id: string, parentId: string | null, title: string) {
  return {
    id,
    projectId: "p1",
    parentId,
    title,
    snippet: `${title} snippet`,
    version: 1,
    updatedBy: { id: "u1", name: "Ada" },
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
  };
}

function renderList() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PagesList projectKey="HELP" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.getPages.mockReset();
});

describe("PagesList", () => {
  it("shows the tree in order and the create action for an editor", async () => {
    mocks.getPages.mockResolvedValue({
      canEdit: true,
      pages: [
        page("b", null, "Beta"),
        page("a1", "a", "Child"),
        page("a", null, "Alpha"),
      ],
    } satisfies PageList);
    renderList();
    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Child"),
      expect.stringContaining("Beta"),
    ]);
    expect(screen.getByText("list.create")).toBeTruthy();
  });

  it("hides the create action from a reader", async () => {
    mocks.getPages.mockResolvedValue({
      canEdit: false,
      pages: [page("a", null, "Alpha")],
    } satisfies PageList);
    renderList();
    await screen.findByText("Alpha");
    expect(screen.queryByText("list.create")).toBeNull();
  });

  it("shows the empty state", async () => {
    mocks.getPages.mockResolvedValue({ canEdit: true, pages: [] });
    renderList();
    expect(await screen.findByTestId("pages-empty")).toBeTruthy();
  });

  it("shows one not-found message for a project the caller cannot reach", async () => {
    mocks.getPages.mockRejectedValue(new HttpError(404, "Not found"));
    renderList();
    expect(await screen.findByText("list.notFound")).toBeTruthy();
  });
});
