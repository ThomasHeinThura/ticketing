import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  revoke: vi.fn(),
  reattest: vi.fn(),
  requestDeletion: vi.fn(),
  navigate: vi.fn(),
  stepRun: vi.fn(),
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
  reattestServiceKey: (...args: unknown[]) => mocks.reattest(...args),
  requestServiceKeyDeletion: (...args: unknown[]) =>
    mocks.requestDeletion(...args),
}));
vi.mock("@/hooks/use-step-up-action", () => ({
  useStepUpAction: () => ({
    run: (...args: unknown[]) => mocks.stepRun(...args),
    clearFailure: vi.fn(),
    busy: false,
    canRun: true,
    failure: null,
    method: "password",
    setMethod: vi.fn(),
    secret: "verification secret",
    setSecret: vi.fn(),
    availableMethods: ["password"],
  }),
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
  ownedByWorkspaceAdmins: false,
  requiresReattestation: false,
  accountabilityVersion: 1,
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
  mocks.reattest.mockReset().mockResolvedValue(
    key({
      ownedByWorkspaceAdmins: true,
      requiresReattestation: false,
      accountabilityVersion: 2,
    }),
  );
  mocks.stepRun
    .mockReset()
    .mockImplementation(
      async (
        _binding: unknown,
        execute: (token: string) => Promise<unknown>,
      ) => ({ ok: true, value: await execute("step-up-token") }),
    );
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
    mocks.list.mockResolvedValue([
      key({
        createdByFormerMember: true,
        ownedByWorkspaceAdmins: true,
        requiresReattestation: true,
      }),
    ]);
    renderCard();
    expect(
      await screen.findByText("Created by a former member"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Owned by workspace administrators"),
    ).toBeInTheDocument();
    expect(screen.getByText("Re-attestation required")).toBeInTheDocument();
  });

  it("re-attests with a fresh proof bound to the key and accountability version", async () => {
    mocks.list.mockResolvedValue([
      key({
        createdByFormerMember: true,
        ownedByWorkspaceAdmins: true,
        requiresReattestation: true,
        accountabilityVersion: 4,
      }),
    ]);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Re-attest" }));
    expect(
      await screen.findByText(
        "Confirm that workspace administrators accept responsibility for this service key. Its secret and capability subset will not change.",
      ),
    ).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Re-attest" }));
    await waitFor(() =>
      expect(mocks.stepRun).toHaveBeenCalledWith(
        {
          operation: "service_key_reattest",
          workspaceId: "ws-1",
          keyId: "k1",
          expectedVersion: 4,
        },
        expect.any(Function),
      ),
    );
    await waitFor(() =>
      expect(mocks.reattest).toHaveBeenCalledWith(
        "ws-1",
        "k1",
        4,
        "step-up-token",
      ),
    );
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
