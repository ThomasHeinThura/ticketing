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
  copyLink: vi.fn(),
  copyToClipboard: vi.fn(),
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
  copyCustomerInvitationLink: (...args: unknown[]) => mocks.copyLink(...args),
  requestCustomerInvitationRevoke: (...args: unknown[]) =>
    mocks.revoke(...args),
}));
vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => mocks.copyToClipboard(text),
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
  it("lists every status with expiry, offers Copy link only while pending, and offers Resend/Revoke while open", async () => {
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
    // Only the single pending row offers Copy link; expired, accepted and revoked do not.
    expect(
      screen.getAllByText("customerInvitations:actions.copyLink"),
    ).toHaveLength(1);
    // pending and expired are the two open ones.
    expect(
      screen.getAllByText("customerInvitations:actions.resend"),
    ).toHaveLength(2);
    expect(
      screen.getAllByText("customerInvitations:actions.revoke"),
    ).toHaveLength(2);
    expect(
      screen.getAllByText("at 2026-10-26T10:00:00.000Z").length,
    ).toBeGreaterThanOrEqual(4);
    expect(mocks.listInvitations).toHaveBeenCalledWith("w1", "o1");
  });

  it("copies a pending customer invitation link from the table row", async () => {
    mocks.listOrganisations.mockResolvedValue([
      { id: "o1", key: "acme", name: "Acme" },
    ]);
    mocks.listInvitations.mockResolvedValue([invitation("a", "pending")]);
    mocks.copyLink.mockResolvedValue({
      link: "https://portal.example.test/invite/a#t=tok123",
      expiresAt: "2026-10-26T10:00:00.000Z",
    });
    mocks.copyToClipboard.mockResolvedValue(true);

    renderScreen();
    fireEvent.click(
      await screen.findByText("customerInvitations:actions.copyLink"),
    );

    await waitFor(() =>
      expect(mocks.copyLink).toHaveBeenCalledWith("w1", "o1", "a"),
    );
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(
        "https://portal.example.test/invite/a#t=tok123",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText("customerInvitations:actions.copied"),
      ).toBeTruthy(),
    );
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

  it("shows a translated error toast and copies nothing when row copy is refused or rate-limited", async () => {
    mocks.listOrganisations.mockResolvedValue([
      { id: "o1", key: "acme", name: "Acme" },
    ]);
    mocks.listInvitations.mockResolvedValue([invitation("a", "pending")]);
    mocks.copyLink.mockRejectedValue(
      Object.assign(new Error("Too many requests"), { status: 429 }),
    );

    renderScreen();
    fireEvent.click(
      await screen.findByText("customerInvitations:actions.copyLink"),
    );

    await waitFor(() =>
      expect(mocks.copyLink).toHaveBeenCalledWith("w1", "o1", "a"),
    );
    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
  });

  it("resends a pending invitation and shows the result card when no email provider is set up", async () => {
    mocks.listOrganisations.mockResolvedValue([
      { id: "o1", key: "acme", name: "Acme" },
    ]);
    mocks.listInvitations.mockResolvedValue([invitation("a", "pending")]);
    mocks.resend.mockResolvedValue({
      ...invitation("a", "pending"),
      delivered: false,
    });
    renderScreen();
    fireEvent.click(
      await screen.findByText("customerInvitations:actions.resend"),
    );
    await waitFor(() =>
      expect(mocks.resend).toHaveBeenCalledWith("w1", "o1", "a"),
    );
    expect(
      await screen.findByText("customerInvitations:resultCard.resentTitle"),
    ).toBeTruthy();
    expect(
      screen.getByText("customerInvitations:resultCard.noEmailProvider"),
    ).toBeTruthy();
  });

  it("sends an invitation with the address only and presents the truthful 'Email queued' result card on success", async () => {
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
    expect(screen.queryByLabelText(/role/i)).toBeNull();
    fireEvent.change(input, { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByText("customerInvitations:create.submit"));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith("w1", "o1", "new@example.test"),
    );
    expect(
      await screen.findByText("customerInvitations:resultCard.createdTitle"),
    ).toBeTruthy();
    expect(
      screen.getByText("customerInvitations:resultCard.emailQueued"),
    ).toBeTruthy();
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
