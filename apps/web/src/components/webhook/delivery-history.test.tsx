import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({ list: vi.fn(), redeliver: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(`webhooks:${key}`, options),
  }),
}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/format", () => ({ formatDateTime: () => "date" }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
  listWebhookDeliveries: (...args: unknown[]) => mocks.list(...args),
  redeliverWebhookDelivery: (...args: unknown[]) => mocks.redeliver(...args),
}));

import { DeliveryHistory } from "./delivery-history";

function setup() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DeliveryHistory webhookId="hook" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  mocks.list.mockReset();
  mocks.redeliver.mockReset();
});
afterEach(cleanup);

describe("delivery failures", () => {
  it("shows the translated history failure instead of a raw response", async () => {
    mocks.list.mockRejectedValue(new Error("raw server refusal"));
    setup();
    expect(
      await screen.findByText(
        translate("webhooks:deliveries.loadErrorDescription"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw server refusal")).not.toBeInTheDocument();
  });

  it("shows the translated redelivery failure instead of a raw response", async () => {
    mocks.list.mockResolvedValue({
      data: [
        {
          id: "delivery",
          eventKind: "ticket.updated",
          state: "dead",
          source: "event",
          requestBody: {},
          responseBody: null,
          bodyRedacted: false,
          attemptedAt: null,
          createdAt: "2026-01-01",
          statusCode: null,
          durationMs: null,
          attempt: 1,
          error: null,
        },
      ],
      page: { hasMore: false, nextBefore: null },
    });
    mocks.redeliver.mockRejectedValue(new Error("raw server refusal"));
    setup();
    fireEvent.click(
      await screen.findByRole("button", {
        name: translate("webhooks:deliveries.redeliver"),
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        translate("webhooks:deliveries.redeliveryFailed"),
        { error: expect.any(Error) },
      ),
    );
  });
});
