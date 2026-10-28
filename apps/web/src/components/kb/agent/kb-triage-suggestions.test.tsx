import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ suggestions: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/kb", () => ({
  getKbSuggestions: (...args: unknown[]) => mocks.suggestions(...args),
}));

import { KbTriageSuggestions } from "./kb-triage-suggestions";

const summary = (id: string, title: string, customerVisible: boolean) => ({
  id,
  title,
  customerVisible,
});

function renderPanel(onInsert = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <KbTriageSuggestions
        workspaceId="w1"
        text="reset my vpn"
        onInsert={onInsert}
      />
    </QueryClientProvider>,
  );
  return onInsert;
}

beforeEach(() => {
  mocks.suggestions.mockResolvedValue({
    articles: [
      summary("a1", "Reset your VPN password", true),
      summary("a2", "Internal VPN runbook", false),
    ],
    portalBaseUrl: "https://portal.example.com",
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KbTriageSuggestions (KB-12)", () => {
  it("offers a link only for an article the customer can read", async () => {
    const onInsert = renderPanel();
    expect(await screen.findByText("Reset your VPN password")).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "kb:triage.insert" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onInsert).toHaveBeenCalledWith(
      "Reset your VPN password: https://portal.example.com/kb/a1",
    );
  });

  it("offers no link when the portal address is not configured", async () => {
    mocks.suggestions.mockResolvedValue({
      articles: [summary("a1", "Reset your VPN password", true)],
      portalBaseUrl: null,
    });
    renderPanel();
    expect(await screen.findByText("Reset your VPN password")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when no article matches", async () => {
    mocks.suggestions.mockResolvedValue({ articles: [], portalBaseUrl: null });
    renderPanel();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(screen.queryByText("kb:triage.title")).toBeNull();
  });
});
