import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerInvitation } from "@/fetchers/customer-invitation";

const mocks = vi.hoisted(() => ({
  listOrganisations: vi.fn(),
  listInvitations: vi.fn(),
  create: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  openPendingAction: vi.fn(),
  navigate: vi.fn(),
  canInvite: true,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" }, isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canInviteUsers: () => mocks.canInvite,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/fetchers/customer-invitation", () => ({
  listInvitableOrganisations: (...args: unknown[]) =>
    mocks.listOrganisations(...args),
  listCustomerInvitations: (...args: unknown[]) =>
    mocks.listInvitations(...args),
  createCustomerInvitation: (...args: unknown[]) => mocks.create(...args),
  resendCustomerInvitation: (...args: unknown[]) => mocks.resend(...args),
  requestCustomerInvitationRevoke: (...args: unknown[]) =>
    mocks.revoke(...args),
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => `at ${value}`,
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CustomerInvitations } from "./customer-invitations";

const invitation = (
  id: string,
  status: CustomerInvitation["status"],
  email = `${id}@example.test`,
): CustomerInvitation => ({
  id,
  organisationId: "o1",
  email,
  status,
  expiresAt: "2026-10-26T10:00:00.000Z",
  createdAt: "2026-10-24T10:00:00.000Z",
  lastSentAt: "2026-10-24T10:00:00.000Z",
  acceptedAt: null,
  inviterId: "u1",
});

function renderScreen(organisationId = "o1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CustomerInvitations organisationId={organisationId} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.canInvite = true;
});

describe("customer invitations screen", () => {
  it("lists every status for the chosen organisation and offers resend and revoke only while open", async () => {
    mocks.listOrganisations.mockResolvedValue([
      { id: "o1", key: "acme", name: "Acme" },
    ]);
    mocks.listInvitations.mockResolvedValue([
      invitation("a", "pending"),
      invitation("b", "accepted"),
      invitation("c", "revoked"),
      invitation("d", "expired"),
    ]);
    renderScreen();
    expect(await screen.findByText("a@example.test")).toBeTruthy();
    expect(screen.getByText("customerInvitations:status.pending")).toBeTruthy();
    expect(
      screen.getByText("customerInvitations:status.accepted"),
    ).toBeTruthy();
    expect(screen.getByText("customerInvitations:status.revoked")).toBeTruthy();
    expect(screen.getByText("customerInvitations:status.expired")).toBeTruthy();
    // pending and expired are the two open ones.
    expect(
      screen.getAllByText("customerInvitations:actions.resend"),
    ).toHaveLength(2);
    expect(
      screen.getAllByText("customerInvitations:actions.revoke"),
    ).toHaveLength(2);
    expect(mocks.listInvitations).toHaveBeenCalledWith("w1", "o1");
  });

  it("revoke only requests the pending action; nothing is removed here", async () => {
    mocks.listOrganisations.mockResolvedValue([
      { id: "o1", key: "acme", name: "Acme" },
    ]);
    mocks.listInvitations.mockResolvedValue([invitation("a", "pending")]);
    mocks.revoke.mockResolvedValue({ pendingActionId: "pa1" });
    renderScreen();
    fireEvent.click(
      await screen.findByText("customerInvitations:actions.revoke"),
    );
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith("a"));
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa1",
      }),
    );
  });

  it("resends a pending invitation", async () => {
    mocks.listOrganisations.mockResolvedValue([
      { id: "o1", key: "acme", name: "Acme" },
    ]);
    mocks.listInvitations.mockResolvedValue([invitation("a", "pending")]);
    mocks.resend.mockResolvedValue({
      ...invitation("a", "pending"),
      delivered: true,
    });
    renderScreen();
    fireEvent.click(
      await screen.findByText("customerInvitations:actions.resend"),
    );
    await waitFor(() =>
      expect(mocks.resend).toHaveBeenCalledWith("w1", "o1", "a"),
    );
  });

  it("sends an invitation with the address only; the role is not a field", async () => {
    mocks.listOrganisations.mockResolvedValue([
      { id: "o1", key: "acme", name: "Acme" },
    ]);
    mocks.listInvitations.mockResolvedValue([]);
    mocks.create.mockResolvedValue({
      ...invitation("n", "pending"),
      delivered: true,
    });
    renderScreen();
    fireEvent.click(await screen.findByText("customerInvitations:invite"));
    const input = await screen.findByLabelText(
      "customerInvitations:create.email",
    );
    fireEvent.change(input, { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByText("customerInvitations:create.submit"));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith("w1", "o1", "new@example.test"),
    );
    expect(screen.queryByLabelText(/role/i)).toBeNull();
  });

  it("asks for an organisation first when none is chosen", async () => {
    mocks.listOrganisations.mockResolvedValue([
      { id: "o1", key: "acme", name: "Acme" },
    ]);
    renderScreen("");
    expect(
      await screen.findByText("customerInvitations:organisation.emptyTitle"),
    ).toBeTruthy();
    expect(mocks.listInvitations).not.toHaveBeenCalled();
    expect(screen.queryByText("customerInvitations:invite")).toBeNull();
  });

  it("shows an explanation, loads nothing and offers no invite without member:invite", async () => {
    mocks.canInvite = false;
    renderScreen();
    expect(
      await screen.findByText("customerInvitations:denied.title"),
    ).toBeTruthy();
    expect(mocks.listOrganisations).not.toHaveBeenCalled();
    expect(screen.queryByText("customerInvitations:invite")).toBeNull();
  });
});
