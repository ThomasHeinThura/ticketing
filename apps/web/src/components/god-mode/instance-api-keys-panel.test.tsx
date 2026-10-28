import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

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
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => value,
}));
vi.mock("@/fetchers/god-mode/instance-api-keys", () => ({
  listInstanceApiKeys: (...args: unknown[]) => mocks.list(...args),
}));

import { InstanceApiKeysPanel } from "./instance-api-keys-panel";

const base = {
  prefix: "tdk_",
  start: "tdk_abcdefgh",
  enabled: true,
  isMcp: false,
  capabilities: [],
  writesEnabled: false,
  ipAllowlist: null,
  rateLimitPerMinute: null,
  expiresAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  lastUsedAt: null,
  lastUsedIp: null,
  disabledAt: null,
  disabledReason: null,
  ownedByWorkspaceAdmins: false,
  requiresReattestation: false,
  accountabilityVersion: 1,
};

beforeEach(() => {
  mocks.list.mockReset();
});
afterEach(cleanup);

function renderPanel() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InstanceApiKeysPanel />
    </QueryClientProvider>,
  );
}

describe("InstanceApiKeysPanel", () => {
  it("shows owner, workspace and the former-member ownership note", async () => {
    mocks.list.mockResolvedValue({
      hasMore: false,
      apiKeys: [
        {
          ...base,
          id: "p1",
          name: "Personal one",
          kind: "personal",
          ownerName: "Alex Doe",
          workspaceName: null,
          workspaceId: null,
          createdByFormerMember: false,
        },
        {
          ...base,
          id: "s1",
          name: "Pipeline",
          kind: "service",
          ownerName: null,
          workspaceName: "Acme",
          workspaceId: "ws-1",
          createdByFormerMember: true,
          ownedByWorkspaceAdmins: true,
          requiresReattestation: true,
        },
      ],
    });
    renderPanel();
    expect(await screen.findByText("Alex Doe")).toBeInTheDocument();
    expect(screen.getByText("Service key of Acme")).toBeInTheDocument();
    expect(screen.getByText("Created by a former member")).toBeInTheDocument();
    expect(
      screen.getByText("Owned by workspace administrators"),
    ).toBeInTheDocument();
    expect(screen.getByText("Re-attestation required")).toBeInTheDocument();
  });

  it("says so when the caller is not an instance administrator", async () => {
    mocks.list.mockImplementation(async () => {
      throw new HttpError(403, "Forbidden");
    });
    renderPanel();
    expect(
      await screen.findByText("Instance administrators only"),
    ).toBeInTheDocument();
  });
});
