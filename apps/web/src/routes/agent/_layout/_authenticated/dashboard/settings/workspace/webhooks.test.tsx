import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: false, checking: false }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  useLocation: () => ({ pathname: "/dashboard/settings/workspace/webhooks" }),
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
  Outlet: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWebhooks: () => state.allowed,
    isCheckingPermissions: state.checking,
  }),
}));
vi.mock("@/components/webhook/webhook-list", () => ({
  WebhookList: () => <p>Webhook list</p>,
}));

import { Route } from "./webhooks";

const Page = (Route as unknown as { component: ComponentType }).component;
function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.allowed = false;
  state.checking = false;
});
describe("webhooks access", () => {
  it.each(["viewer", "member", "lead"])(
    "denies a %s without mounting the list",
    () => {
      show();
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "states.noAccess.title",
        }),
      ).toHaveFocus();
      expect(screen.queryByText("Webhook list")).toBeNull();
    },
  );
  it("waits for the permission check", async () => {
    state.checking = true;
    show();
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
  });
  it("opens the list for a webhook manager", () => {
    state.allowed = true;
    show();
    expect(screen.getByText("Webhook list")).toBeInTheDocument();
  });
});
