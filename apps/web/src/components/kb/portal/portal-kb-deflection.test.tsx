import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suggest: vi.fn(),
  record: vi.fn(),
  abandon: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/kb/portal", () => ({
  getPortalKbSuggestions: (...args: unknown[]) => mocks.suggest(...args),
  recordPortalKbCandidate: (...args: unknown[]) => mocks.record(...args),
  abandonPortalKbCandidate: (...args: unknown[]) => mocks.abandon(...args),
}));

import {
  PortalKbSuggestions,
  usePortalKbDeflection,
} from "./portal-kb-deflection";

function wrap(children: React.ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.suggest.mockResolvedValue({
    articles: [
      {
        id: "a1",
        title: "Reset your VPN password",
        snippet: "Open the portal",
        categoryId: null,
        publishedAt: null,
      },
    ],
  });
  mocks.record.mockResolvedValue({ id: "cand-1" });
  mocks.abandon.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortalKbSuggestions (KB-8, KB-11)", () => {
  it("offers nothing for a summary that is too short", async () => {
    render(
      wrap(<PortalKbSuggestions query="vp" scope="c1" onOpen={vi.fn()} />),
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(mocks.suggest).not.toHaveBeenCalled();
    expect(screen.queryByText("kb:portal.suggestionsTitle")).toBeNull();
  });

  it("offers matching articles inline in a new tab, without asking anything", async () => {
    const onOpen = vi.fn();
    render(
      wrap(
        <PortalKbSuggestions query="reset my vpn" scope="c1" onOpen={onOpen} />,
      ),
    );
    const link = await screen.findByRole("link", {
      name: "Reset your VPN password",
    });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("href")).toBe("/kb/a1");
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith("a1", "reset my vpn");
    // Never a confirmation or a question: no dialog, no extra buttons.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing when nothing matches or the lookup fails", async () => {
    mocks.suggest.mockResolvedValue({ articles: [] });
    const { container } = render(
      wrap(
        <PortalKbSuggestions
          query="something else"
          scope="c1"
          onOpen={vi.fn()}
        />,
      ),
    );
    await waitFor(() => expect(mocks.suggest).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("usePortalKbDeflection (KB-10)", () => {
  it("reports every opened article as abandoned when the form is left without submitting", async () => {
    const { result, unmount } = renderHook(() =>
      usePortalKbDeflection("access"),
    );
    act(() => result.current.recordOpened("a1", "vpn"));
    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith({
        articleId: "a1",
        requestTypeKey: "access",
        query: "vpn",
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(mocks.abandon).toHaveBeenCalledWith("cand-1");
  });

  it("does not report an abandonment once the request was submitted", async () => {
    const { result, unmount } = renderHook(() =>
      usePortalKbDeflection("access"),
    );
    act(() => result.current.recordOpened("a1", "vpn"));
    await waitFor(() => expect(mocks.record).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.markSubmitted());
    unmount();
    expect(mocks.abandon).not.toHaveBeenCalled();
  });

  it("reports an abandonment when the page is hidden (tab closed)", async () => {
    const { result } = renderHook(() => usePortalKbDeflection("access"));
    act(() => result.current.recordOpened("a1", "vpn"));
    await waitFor(() => expect(mocks.record).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.abandon).toHaveBeenCalledWith("cand-1");
  });
});
