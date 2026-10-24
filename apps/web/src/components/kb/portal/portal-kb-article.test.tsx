import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/kb/portal", () => ({
  getPortalKbArticle: (...args: unknown[]) => mocks.get(...args),
  sendPortalKbFeedback: (...args: unknown[]) => mocks.send(...args),
}));

import { PortalKbArticleView } from "./portal-kb-article";

const article = {
  id: "a1",
  title: "Reset your VPN password",
  snippet: "",
  categoryId: "c1",
  publishedAt: null,
  categoryName: "VPN",
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Open the portal." }],
      },
    ],
  },
  related: [
    {
      id: "a2",
      title: "Rotate a certificate",
      snippet: "",
      categoryId: null,
      publishedAt: null,
    },
  ],
  myFeedback: null,
};

function renderView() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PortalKbArticleView id="a1" scope="customer-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.get.mockResolvedValue(article);
  mocks.send.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortalKbArticleView", () => {
  it("shows the published article and related articles", async () => {
    renderView();
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Open the portal.")).toBeTruthy();
    expect(screen.getByText("Rotate a certificate")).toBeTruthy();
    expect(screen.getByText("VPN")).toBeTruthy();
  });

  it("records a yes or no on one click and takes an optional comment afterwards", async () => {
    renderView();
    fireEvent.click(
      await screen.findByRole("button", { name: "kb:portal.no" }),
    );
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith("a1", { helpful: false }),
    );
    fireEvent.change(screen.getByLabelText("kb:portal.commentLabel"), {
      target: { value: "Missing the refund steps" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "kb:portal.sendComment" }),
    );
    await waitFor(() =>
      expect(mocks.send).toHaveBeenLastCalledWith("a1", {
        helpful: false,
        comment: "Missing the refund steps",
      }),
    );
  });

  it("answers an unavailable article with one neutral message, whatever the reason", async () => {
    mocks.get.mockRejectedValue(new HttpError(404, "Article not found"));
    renderView();
    expect(await screen.findByText("kb:portal.notFoundTitle")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
