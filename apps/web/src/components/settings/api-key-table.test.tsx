import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKey } from "@/types/api-key";
import { ApiKeyTable } from "./api-key-table";

const mocks = vi.hoisted(() => ({
  revoke: vi.fn(),
  requestDelete: vi.fn(),
  openPendingAction: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/api-key/use-revoke-api-key", () => ({
  default: () => ({ mutateAsync: mocks.revoke }),
}));
vi.mock("@/hooks/mutations/api-key/use-request-api-key-deletion", () => ({
  default: () => ({ mutateAsync: mocks.requestDelete }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    error: (message: string) => mocks.toastError(message),
    success: (message: string) => mocks.toastSuccess(message),
  },
}));

const apiKey: ApiKey = {
  id: "key-1",
  name: "Personal key",
  kind: "personal",
  prefix: "tdk_",
  start: "tdk_12345678",
  enabled: true,
  isMcp: false,
  capabilities: [],
  writesEnabled: false,
  ipAllowlist: null,
  rateLimitPerMinute: null,
  expiresAt: null,
  createdAt: "2026-10-25T00:00:00.000Z",
  lastUsedAt: null,
  lastUsedIp: null,
  disabledAt: null,
  disabledReason: null,
  workspaceId: null,
  createdByFormerMember: false,
  ownedByWorkspaceAdmins: false,
  requiresReattestation: false,
  accountabilityVersion: 1,
};

describe("personal API-key row actions", () => {
  beforeEach(() => {
    mocks.revoke.mockReset().mockResolvedValue(apiKey);
    mocks.requestDelete
      .mockReset()
      .mockResolvedValue({ pendingActionId: "pa-1" });
    mocks.openPendingAction.mockReset().mockResolvedValue(undefined);
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });
  afterEach(cleanup);

  it("keeps immediate revoke separate and opens the approval dialog for delete", async () => {
    render(<ApiKeyTable apiKeys={[apiKey]} isLoading={false} />);
    expect(
      screen.getByRole("button", { name: "settings:apiKey.table.revokeAria" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "settings:apiKey.table.deleteAria" }),
    );
    await waitFor(() =>
      expect(mocks.requestDelete).toHaveBeenCalledWith("key-1"),
    );
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa-1",
      }),
    );
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
