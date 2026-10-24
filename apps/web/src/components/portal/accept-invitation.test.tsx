import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  accept: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: {
    getSession: () => mocks.getSession(),
    $fetch: (...args: unknown[]) => mocks.signUp(...args),
  },
}));
vi.mock("@/fetchers/customer-invitation", () => ({
  acceptCustomerInvitation: (...args: unknown[]) => mocks.accept(...args),
}));

import { AcceptInvitation, readInviteCredential } from "./accept-invitation";

const CREDENTIAL = "A".repeat(43);

function renderPage(hash: string) {
  window.history.replaceState(null, "", `/invite/inv1${hash}`);
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AcceptInvitation invitationId="inv1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("readInviteCredential", () => {
  it("reads only a well-formed credential from the fragment", () => {
    expect(readInviteCredential(`#t=${CREDENTIAL}`)).toBe(CREDENTIAL);
    expect(readInviteCredential("")).toBeNull();
    expect(readInviteCredential("#t=short")).toBeNull();
    expect(readInviteCredential(`#x=${CREDENTIAL}`)).toBeNull();
    expect(readInviteCredential(`#t=${CREDENTIAL}&u=1`)).toBeNull();
  });
});

describe("accept invitation page", () => {
  it("shows the one generic notice when the link carries no credential", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: {} } });
    renderPage("");
    expect(await screen.findByText("accept.invalidTitle")).toBeTruthy();
    expect(screen.queryByText("accept.action")).toBeNull();
  });

  it("removes the credential from the address bar and history", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    renderPage(`#t=${CREDENTIAL}`);
    await screen.findByText("accept.createAccount");
    expect(window.location.hash).toBe("");
  });

  it("offers a signed-out visitor account creation or sign-in and never calls accept", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    renderPage(`#t=${CREDENTIAL}`);
    expect(await screen.findByText("accept.createAccount")).toBeTruthy();
    expect(screen.getByText("accept.haveAccount")).toBeTruthy();
    expect(screen.queryByText("accept.action")).toBeNull();
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  function fillAndSubmit() {
    fireEvent.change(screen.getByLabelText("accept.nameLabel"), {
      target: { value: "New Person" },
    });
    fireEvent.change(screen.getByLabelText("accept.emailLabel"), {
      target: { value: "new@example.test" },
    });
    fireEvent.change(screen.getByLabelText("accept.passwordLabel"), {
      target: { value: "a-long-password" },
    });
    fireEvent.click(screen.getByText("accept.createAccount"));
  }

  it("creates the account with the credential from the link and needs no second accept", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    mocks.signUp.mockResolvedValue({ data: { token: "t" }, error: null });
    renderPage(`#t=${CREDENTIAL}`);
    await screen.findByText("accept.createAccount");
    fillAndSubmit();
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledTimes(1));
    expect(mocks.signUp).toHaveBeenCalledWith("/sign-up/email", {
      method: "POST",
      body: {
        name: "New Person",
        email: "new@example.test",
        password: "a-long-password",
        invitationId: "inv1",
        invitationCredential: CREDENTIAL,
      },
    });
    expect(await screen.findByText("accept.acceptedTitle")).toBeTruthy();
    expect(screen.getByText("accept.continue")).toBeTruthy();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("shows the one generic notice when the server refuses the sign-up", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    mocks.signUp.mockResolvedValue({ data: null, error: { status: 403 } });
    renderPage(`#t=${CREDENTIAL}`);
    await screen.findByText("accept.createAccount");
    fillAndSubmit();
    expect(await screen.findByText("accept.invalidTitle")).toBeTruthy();
    expect(screen.queryByText("accept.acceptedTitle")).toBeNull();
  });

  it("points an address that already has an account to sign-in", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    mocks.signUp.mockResolvedValue({ data: null, error: { status: 422 } });
    renderPage(`#t=${CREDENTIAL}`);
    await screen.findByText("accept.createAccount");
    fillAndSubmit();
    expect(await screen.findByText("accept.accountExistsTitle")).toBeTruthy();
    expect(screen.getByText("accept.signIn")).toBeTruthy();
  });

  it("shows the generic notice when the sign-up request itself fails", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    mocks.signUp.mockRejectedValue(new Error("network"));
    renderPage(`#t=${CREDENTIAL}`);
    await screen.findByText("accept.createAccount");
    fillAndSubmit();
    expect(await screen.findByText("accept.invalidTitle")).toBeTruthy();
  });

  it("accepts with the credential from the link when signed in", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { id: "s" } } });
    mocks.accept.mockResolvedValue(undefined);
    renderPage(`#t=${CREDENTIAL}`);
    fireEvent.click(await screen.findByText("accept.action"));
    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith("inv1", CREDENTIAL),
    );
    expect(await screen.findByText("accept.acceptedTitle")).toBeTruthy();
  });

  it("shows the same generic notice for any refusal", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { id: "s" } } });
    mocks.accept.mockRejectedValue(new Error("anything"));
    renderPage(`#t=${CREDENTIAL}`);
    fireEvent.click(await screen.findByText("accept.action"));
    expect(await screen.findByText("accept.invalidTitle")).toBeTruthy();
    expect(screen.queryByText("anything")).toBeNull();
  });
});
