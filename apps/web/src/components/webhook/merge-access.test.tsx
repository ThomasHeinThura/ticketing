import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const state = vi.hoisted(() => ({ list: vi.fn(), deliveries: vi.fn() }));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useNavigate: () => vi.fn(),
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws" }, isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWebhooks: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/fetchers/webhook/webhooks", () => ({
  listWebhooks: (...args: unknown[]) => state.list(...args),
  listWebhookDeliveries: (...args: unknown[]) => state.deliveries(...args),
  redeliverWebhookDelivery: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  requestWebhookDeletion: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  sendWebhookTestEvent: vi.fn(),
}));

import { DeliveryHistory } from "./delivery-history";
import { WebhookEditor } from "./webhook-editor";

beforeEach(() => {
  state.list.mockReset();
  state.deliveries.mockReset();
});
afterEach(cleanup);

describe.each([
  ["editor", () => <WebhookEditor id="hook" />, state.list],
  [
    "delivery history",
    () => <DeliveryHistory webhookId="hook" />,
    state.deliveries,
  ],
] as const)("%s read failures", (_name, page, fetch) => {
  const show = () =>
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {page()}
      </QueryClientProvider>,
    );
  it("shows the shared no-access page for a 403", async () => {
    fetch.mockRejectedValue(new HttpError(403, "forbidden"));
    show();
    expect(
      await screen.findByTestId("settings-access-denied"),
    ).toBeInTheDocument();
  });
  it("retains the translated error and copyable server reference for a 500", async () => {
    fetch.mockRejectedValue(
      new HttpError(500, "private server message", "a".repeat(32)),
    );
    show();
    expect(
      await screen.findByText("common:error.reference"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "common:error.copyReference" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
    expect(screen.queryByText("private server message")).toBeNull();
  });
});
