import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suggestions: vi.fn(),
  knowledgeBaseOn: true,
  isOn: vi.fn<(key: string) => boolean>(),
}));
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

vi.mock("@/hooks/queries/feature-flag/use-workspace-features", () => ({
  default: () => ({ isOn: mocks.isOn }),
}));

import { KbTriageSuggestions } from "./kb-triage-suggestions";

const summary = (id: string, title: string, customerVisible: boolean) => ({
  id,
  title,
  customerVisible,
});

function renderPanel(onInsert = vi.fn()) {
  const client = new QueryClient();
  const view = render(
    <KbTriageSuggestions
      workspaceId="w1"
      text="reset my vpn"
      onInsert={onInsert}
    />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  return { ...view, onInsert };
}

beforeEach(() => {
  mocks.knowledgeBaseOn = true;
  mocks.isOn.mockImplementation(
    (key) => key === "feature.knowledge_base" && mocks.knowledgeBaseOn,
  );
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
  it("does not fetch or render suggestions while knowledge base is off", async () => {
    mocks.knowledgeBaseOn = false;
    renderPanel();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(mocks.suggestions).not.toHaveBeenCalled();
    expect(mocks.isOn).toHaveBeenCalledWith("feature.knowledge_base");
    expect(screen.queryByText("kb:triage.title")).toBeNull();
  });
  it("immediately hides cached articles when knowledge base is switched off", async () => {
    const { rerender } = renderPanel();
    await screen.findByText("Reset your VPN password");
    mocks.knowledgeBaseOn = false;
    rerender(
      <KbTriageSuggestions
        workspaceId="w1"
        text="reset my vpn"
        onInsert={vi.fn()}
      />,
    );
    expect(screen.queryByText("Reset your VPN password")).toBeNull();
    expect(mocks.isOn).toHaveBeenCalledWith("feature.knowledge_base");
    expect(mocks.suggestions).toHaveBeenCalledTimes(1);
  });

  it("offers a link only for an article the customer can read", async () => {
    const { onInsert } = renderPanel();
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
