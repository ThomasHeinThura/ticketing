import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  accept: vi.fn(),
  beginContinuation: vi.fn(),
  continuationResult: vi.fn(),
  getAuthMethods: vi.fn(),
  navigate: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
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
  acceptCustomerInvitationContinuation: (...args: unknown[]) =>
    mocks.accept(...args),
  beginCustomerInvitationContinuation: (...args: unknown[]) =>
    mocks.beginContinuation(...args),
  getCustomerInvitationContinuationResult: (...args: unknown[]) =>
    mocks.continuationResult(...args),
  getPortalAuthMethods: () => mocks.getAuthMethods(),
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
  beforeEach(() => {
    mocks.navigate.mockResolvedValue(undefined);
    mocks.beginContinuation.mockResolvedValue(undefined);
    mocks.continuationResult.mockResolvedValue({ accepted: false });
    mocks.getAuthMethods.mockResolvedValue({
      password: true,
      magicLink: false,
      emailOtp: false,
    });
  });

  it("shows the one generic notice when the link carries no credential", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: {} } });
    mocks.accept.mockRejectedValue(new Error("invalid continuation"));
    renderPage("");
    expect(await screen.findByText("accept.invalidTitle")).toBeTruthy();
    expect(screen.queryByText("accept.action")).toBeNull();
  });

  it("acknowledges a provider flow that already accepted without posting again", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: {} } });
    mocks.continuationResult.mockResolvedValue({ accepted: true });
    renderPage("");
    expect(await screen.findByText("accept.acceptedTitle")).toBeTruthy();
    expect(mocks.continuationResult).toHaveBeenCalledWith("inv1");
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.beginContinuation).not.toHaveBeenCalled();
  });

  it("posts acceptance once when the continuation is still pending", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: {} } });
    mocks.accept.mockResolvedValue(undefined);
    renderPage("");
    expect(await screen.findByText("accept.acceptedTitle")).toBeTruthy();
    expect(mocks.continuationResult).toHaveBeenCalledWith("inv1");
    expect(mocks.accept).toHaveBeenCalledTimes(1);
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
    expect(mocks.beginContinuation).toHaveBeenCalledWith("inv1", CREDENTIAL);
    expect(mocks.signUp).toHaveBeenCalledWith("/sign-up/email", {
      method: "POST",
      body: {
        invitationId: "inv1",
        name: "New Person",
        email: "new@example.test",
        password: "a-long-password",
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
      expect(mocks.beginContinuation).toHaveBeenCalledWith("inv1", CREDENTIAL),
    );
    expect(mocks.accept).toHaveBeenCalledWith("inv1");
    expect(await screen.findByText("accept.acceptedTitle")).toBeTruthy();
  });

  it("does not offer password signup when the customer provider is disabled", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    mocks.getAuthMethods.mockResolvedValue({
      password: false,
      magicLink: true,
      emailOtp: false,
    });
    renderPage(`#t=${CREDENTIAL}`);
    expect(await screen.findByText("accept.haveAccount")).toBeTruthy();
    expect(screen.queryByText("accept.createAccount")).toBeNull();
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
