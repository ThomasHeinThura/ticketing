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
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  revoke: vi.fn(),
  requestDeletion: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) =>
      translate(
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey,
        options,
      ),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/fetchers/service-keys", () => ({
  listServiceKeys: (...args: unknown[]) => mocks.list(...args),
  revokeServiceKey: (...args: unknown[]) => mocks.revoke(...args),
  requestServiceKeyDeletion: (...args: unknown[]) =>
    mocks.requestDeletion(...args),
}));
vi.mock("@/components/settings/create-service-key-dialog", () => ({
  CreateServiceKeyDialog: () => null,
  serviceKeysKey: (id: string) => ["service-keys", id],
}));

import { ServiceKeysCard } from "./service-keys-card";

const key = (over: Record<string, unknown> = {}) => ({
  id: "k1",
  name: "Pipeline",
  kind: "service",
  prefix: "tdk_",
  start: "tdk_abcdefgh",
  enabled: true,
  isMcp: false,
  capabilities: ["workspace:read"],
  writesEnabled: false,
  ipAllowlist: null,
  rateLimitPerMinute: null,
  expiresAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  lastUsedAt: null,
  lastUsedIp: null,
  disabledAt: null,
  disabledReason: null,
  workspaceId: "ws-1",
  createdByFormerMember: false,
  ...over,
});

function renderCard() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ServiceKeysCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.revoke.mockReset().mockResolvedValue(key({ enabled: false }));
  mocks.requestDeletion
    .mockReset()
    .mockResolvedValue({ pendingActionId: "pa-1" });
  mocks.navigate.mockReset();
});
afterEach(cleanup);

describe("ServiceKeysCard", () => {
  it("renders nothing for a caller without api_key:manage (the list answers 403)", async () => {
    mocks.list.mockRejectedValue(new HttpError(403, "forbidden"));
    const { container } = renderCard();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("flags a key created by a former member as owned by the workspace administrators", async () => {
    mocks.list.mockResolvedValue([key({ createdByFormerMember: true })]);
    renderCard();
    expect(
      await screen.findByText(
        "Created by a former member, owned by workspace administrators",
      ),
    ).toBeInTheDocument();
  });

  it("revokes only after confirmation", async () => {
    mocks.list.mockResolvedValue([key()]);
    renderCard();
    fireEvent.click(await screen.findByLabelText("Revoke Pipeline"));
    expect(mocks.revoke).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(mocks.revoke).toHaveBeenCalledWith("ws-1", "k1"),
    );
  });

  it("deleting opens a pending action instead of deleting", async () => {
    mocks.list.mockResolvedValue([key()]);
    renderCard();
    fireEvent.click(
      await screen.findByLabelText("Request deletion of Pipeline"),
    );
    await waitFor(() =>
      expect(mocks.requestDeletion).toHaveBeenCalledWith("ws-1", "k1"),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  });
});
