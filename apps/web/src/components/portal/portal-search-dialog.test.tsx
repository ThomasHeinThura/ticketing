import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalSearchDialog from "./portal-search-dialog";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  kb: vi.fn(),
  catalogue: vi.fn(),
  cases: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/fetchers/kb/portal", () => ({ getPortalKb: mocks.kb }));
vi.mock("@/fetchers/intake", () => ({ getPortalCatalogue: mocks.catalogue }));
vi.mock("@/fetchers/portal/cases", () => ({ getPortalCases: mocks.cases }));
vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({
    t: (key: string, options?: { q?: string }) =>
      options?.q ? `${key}(${options.q})` : key,
  }),
}));

function renderDialog(initialQuery = "VPN") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <PortalSearchDialog
        open
        onOpenChange={onOpenChange}
        initialQuery={initialQuery}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.kb.mockReset().mockResolvedValue({
    articles: [
      {
        id: "kb-1",
        title: "How to reset your VPN client",
        snippet: "Restart the client",
        categoryId: null,
        publishedAt: null,
      },
    ],
    total: 1,
  });
  mocks.catalogue.mockReset().mockResolvedValue({
    requestTypes: [{ key: "vpn", name: "VPN access", description: null }],
  });
  mocks.cases.mockReset().mockResolvedValue({
    cases: [
      {
        ref: "HELP-7",
        source: "direct",
        title: "VPN drops every 10 minutes",
        requestTypeName: "Incident",
      },
      {
        ref: "SUB-3",
        source: "submission",
        title: "",
        requestTypeName: "VPN access",
      },
    ],
    page: { nextCursor: null, hasMore: false },
    meta: { total: 2 },
  });
});
afterEach(() => cleanup());

describe("portal help search", () => {
  it("finds knowledge-base articles, request types and the customer's own requests", async () => {
    renderDialog();
    expect(
      await screen.findByText("How to reset your VPN client"),
    ).toBeVisible();
    expect(screen.getByText("VPN drops every 10 minutes")).toBeVisible();
    expect(screen.getByText("shell.search.groups.articles")).toBeVisible();
    expect(screen.getByText("shell.search.groups.requestTypes")).toBeVisible();
    expect(screen.getByText("shell.search.groups.cases")).toBeVisible();
    expect(mocks.kb).toHaveBeenCalledWith({ q: "VPN", limit: 5 });
    expect(mocks.catalogue).toHaveBeenCalledWith("VPN");
    // Only the customer's own requests, through the existing list API and its reach.
    expect(mocks.cases).toHaveBeenCalledWith({
      scope: "mine",
      q: "VPN",
      limit: 5,
    });
  });

  it("opens the chosen result", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(
      await screen.findByRole("option", {
        name: /How to reset your VPN client/u,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/kb/$id",
      params: { id: "kb-1" },
    });
    fireEvent.click(screen.getByRole("option", { name: /VPN drops/u }));
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/requests/$ref",
      params: { ref: "HELP-7" },
    });
    fireEvent.click(screen.getByRole("option", { name: /SUB-3/u }));
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/submissions/$ref",
      params: { ref: "SUB-3" },
    });
    fireEvent.click(screen.getByRole("option", { name: /^VPN access$/u }));
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/catalogue",
      search: { key: "vpn" },
    });
    fireEvent.click(
      screen.getByRole("option", { name: "shell.search.allArticles(VPN)" }),
    );
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/kb",
      search: { q: "VPN" },
    });
  });

  it("keeps the other groups when the knowledge base is unavailable", async () => {
    mocks.kb.mockReset().mockRejectedValue(new Error("feature off"));
    renderDialog();
    expect(await screen.findByText("VPN drops every 10 minutes")).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole("option", {
          name: "shell.search.allArticles(VPN)",
        }),
      ).toBeNull(),
    );
    expect(screen.queryByText("shell.search.groups.articles")).toBeNull();
    expect(
      screen.getByRole("option", { name: "shell.search.allRequestTypes(VPN)" }),
    ).toBeVisible();
  });

  it("says when nothing matches", async () => {
    mocks.kb.mockReset().mockResolvedValue({ articles: [], total: 0 });
    mocks.catalogue.mockReset().mockResolvedValue({ requestTypes: [] });
    mocks.cases.mockReset().mockResolvedValue({
      cases: [],
      page: { nextCursor: null, hasMore: false },
      meta: { total: 0 },
    });
    renderDialog("zzz");
    expect(await screen.findByText("shell.search.empty(zzz)")).toBeVisible();
  });
});
