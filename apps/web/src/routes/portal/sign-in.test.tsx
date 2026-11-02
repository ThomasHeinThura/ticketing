import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./sign-in";

const mocks = vi.hoisted(() => ({
  search: {
    stage: "email",
    factor: "totp" as "totp" | "backup",
    invitationId: undefined as string | undefined,
  },
  navigate: vi.fn(),
  signIn: vi.fn(),
  emailOtpSend: vi.fn(),
  emailOtpSignIn: vi.fn(),
  magicLink: vi.fn(),
  authMethods: vi.fn(),
  getSession: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    fullPath: "/sign-in",
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: {
    signIn: {
      email: mocks.signIn,
    },
    getSession: mocks.getSession,
  },
}));

vi.mock("@/lib/portal-auth-providers", () => ({
  portalProviderAuthClient: {
    signIn: {
      emailOtp: mocks.emailOtpSignIn,
      magicLink: mocks.magicLink,
    },
    emailOtp: { sendVerificationOtp: mocks.emailOtpSend },
    twoFactor: {
      verifyTotp: mocks.verifyTotp,
      verifyBackupCode: mocks.verifyBackupCode,
    },
  },
}));

vi.mock("@/fetchers/customer-invitation", () => ({
  getPortalAuthMethods: () => mocks.authMethods(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PortalSignIn = (Route as unknown as { component: ComponentType })
  .component;

function renderSignIn(client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <PortalSignIn />
    </QueryClientProvider>,
  );
}

describe("portal sign-in", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/sign-in");
    mocks.search = {
      stage: "email",
      factor: "totp",
      invitationId: undefined,
    };
    mocks.navigate.mockReset();
    mocks.signIn.mockReset();
    mocks.emailOtpSend.mockReset();
    mocks.emailOtpSignIn.mockReset();
    mocks.magicLink.mockReset();
    mocks.authMethods.mockResolvedValue({
      password: true,
      magicLink: false,
      emailOtp: false,
    });
    mocks.getSession.mockReset();
    mocks.verifyTotp.mockReset();
    mocks.verifyBackupCode.mockReset();
    window.sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ next: "local" }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the email-first step local and moves the open stage into the URL", async () => {
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "auth:signInForm.signIn" })
        .closest("form") as HTMLFormElement,
    );

    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "/api/portal/sign-in/home-realm",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "customer@example.test" }),
      }),
    );
    await waitFor(() => {
      expect(
        window.sessionStorage.getItem("taskdesk:portal-sign-in-email"),
      ).toBe("customer@example.test");
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/sign-in",
        search: { stage: "password", factor: "totp" },
        replace: true,
      });
    });
    expect(window.location.search).toBe("");
  });

  it("sends only the public invitation id through home-realm discovery", async () => {
    mocks.search = {
      stage: "email",
      factor: "totp",
      invitationId: "invite-1",
    };
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "auth:signInForm.signIn" })
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/portal/sign-in/home-realm",
        expect.objectContaining({
          body: JSON.stringify({
            email: "customer@example.test",
            invitationId: "invite-1",
          }),
        }),
      ),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: {
        stage: "password",
        factor: "totp",
        invitationId: "invite-1",
      },
      replace: true,
    });
  });

  it("shows the same localized failure after a failed SSO return", () => {
    window.history.replaceState(
      {},
      "",
      "/sign-in?identity_error=sign_in_failed",
    );
    renderSignIn();

    expect(screen.getByText("auth:signInForm.failedSignIn")).toBeTruthy();
    expect(screen.getByLabelText("auth:forms.email")).toBeTruthy();
  });

  it("uses one generic failure for password denial", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = {
      stage: "password",
      factor: "totp",
      invitationId: undefined,
    };
    mocks.signIn.mockResolvedValue({ error: { message: "provider disabled" } });
    renderSignIn();
    fireEvent.change(await screen.findByLabelText("auth:forms.password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.submit(
      screen
        .getByLabelText("auth:forms.password")
        .closest("form") as HTMLFormElement,
    );

    expect(
      await screen.findByText("auth:signInForm.failedSignIn"),
    ).toBeTruthy();
    expect(screen.queryByText("provider disabled")).toBeNull();
  });

  it("restores the password stage after reload without putting the email in the URL", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = {
      stage: "password",
      factor: "totp",
      invitationId: undefined,
    };
    renderSignIn();

    // The confirmed address is wrapping text (never a clipped input) with the label.
    const confirmed = await screen.findByLabelText("auth:forms.email");
    expect(confirmed.tagName).toBe("OUTPUT");
    expect(confirmed).toHaveTextContent("customer@example.test");
    expect(confirmed.className).toContain("break-all");
    expect(window.location.search).toBe("");
  });

  it("moves focus to the password field when the stage changes, and back on Change email", async () => {
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "auth:signInForm.signIn" })
        .closest("form") as HTMLFormElement,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.getElementById("portal-password"),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "auth:verifyOtp.changeEmail" }),
    );
    expect(document.activeElement).toBe(
      document.getElementById("portal-email"),
    );
  });

  it("sends an admitted password session to the catalogue", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = {
      stage: "password",
      factor: "totp",
      invitationId: undefined,
    };
    mocks.signIn.mockResolvedValue({ data: { token: "opaque" } });
    mocks.getSession.mockResolvedValue({
      data: { session: { id: "session" } },
    });
    renderSignIn();
    fireEvent.change(await screen.findByLabelText("auth:forms.password"), {
      target: { value: "valid-password" },
    });
    fireEvent.submit(
      screen
        .getByLabelText("auth:forms.password")
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/catalogue" }),
    );
    expect(
      window.sessionStorage.getItem("taskdesk:portal-sign-in-email"),
    ).toBeNull();
  });

  it("keeps the stored email until the post-sign-in navigation finishes (no sign-in loop)", async () => {
    // The portal root remounts this page as soon as the location changes, before the
    // navigation commits. The remount reads the email from storage; clearing it early makes
    // it reset to the email stage and cancel the navigation.
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = {
      stage: "password",
      factor: "totp",
      invitationId: undefined,
    };
    mocks.signIn.mockResolvedValue({ data: { token: "opaque" } });
    mocks.getSession.mockResolvedValue({
      data: { session: { id: "session" } },
    });
    let finishNavigation: () => void = () => undefined;
    mocks.navigate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishNavigation = resolve;
        }),
    );
    renderSignIn();
    fireEvent.change(await screen.findByLabelText("auth:forms.password"), {
      target: { value: "valid-password" },
    });
    fireEvent.submit(
      screen
        .getByLabelText("auth:forms.password")
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/catalogue" }),
    );
    expect(window.sessionStorage.getItem("taskdesk:portal-sign-in-email")).toBe(
      "customer@example.test",
    );
    finishNavigation();
    await waitFor(() =>
      expect(
        window.sessionStorage.getItem("taskdesk:portal-sign-in-email"),
      ).toBeNull(),
    );
  });

  it("returns an invited password session to its invitation without exposing a credential", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = {
      stage: "password",
      factor: "totp",
      invitationId: "invite-1",
    };
    mocks.signIn.mockResolvedValue({ data: { token: "opaque" } });
    mocks.getSession.mockResolvedValue({
      data: { session: { id: "session" } },
    });
    renderSignIn();
    fireEvent.change(await screen.findByLabelText("auth:forms.password"), {
      target: { value: "valid-password" },
    });
    fireEvent.submit(
      screen
        .getByLabelText("auth:forms.password")
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/invite/$id",
        params: { id: "invite-1" },
      }),
    );
  });

  it("offers email code and magic link only while the portal reports them enabled", async () => {
    mocks.authMethods.mockResolvedValue({
      password: true,
      magicLink: true,
      emailOtp: true,
    });
    const view = renderSignIn();
    expect(
      await screen.findByRole("button", {
        name: "auth:signInForm.sendEmailCode",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "auth:signInForm.sendMagicLink" }),
    ).toBeInTheDocument();
    view.unmount();

    // An administrator switched both off: the next read hides them.
    mocks.authMethods.mockResolvedValue({
      password: true,
      magicLink: false,
      emailOtp: false,
    });
    const nextClient = new QueryClient();
    renderSignIn(nextClient);
    await waitFor(() =>
      expect(nextClient.getQueryData(["portal", "auth-methods"])).toEqual({
        password: true,
        magicLink: false,
        emailOtp: false,
      }),
    );
    expect(
      await screen.findByRole("button", { name: "auth:signInForm.signIn" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "auth:signInForm.sendEmailCode" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "auth:signInForm.sendMagicLink" }),
    ).toBeNull();
  });

  it("supports enabled customer email OTP and returns to the invite after verification", async () => {
    mocks.authMethods.mockResolvedValue({
      password: false,
      magicLink: false,
      emailOtp: true,
    });
    mocks.search = {
      stage: "email",
      factor: "totp",
      invitationId: "invite-1",
    };
    mocks.emailOtpSend.mockResolvedValue({ error: null });
    mocks.emailOtpSignIn.mockResolvedValue({ data: { token: "opaque" } });
    mocks.getSession.mockResolvedValue({
      data: { session: { id: "session" } },
    });
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "auth:signInForm.sendEmailCode",
      }),
    );
    await waitFor(() =>
      expect(mocks.emailOtpSend).toHaveBeenCalledWith({
        email: "customer@example.test",
        type: "sign-in",
        fetchOptions: {
          headers: { "x-taskdesk-invitation-id": "invite-1" },
        },
      }),
    );
    fireEvent.change(screen.getByLabelText("auth:forms.verificationCode"), {
      target: { value: "123456" },
    });
    fireEvent.submit(
      screen
        .getByLabelText("auth:forms.verificationCode")
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(mocks.emailOtpSignIn).toHaveBeenCalledWith({
        email: "customer@example.test",
        otp: "123456",
        fetchOptions: {
          headers: { "x-taskdesk-invitation-id": "invite-1" },
        },
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/invite/$id",
      params: { id: "invite-1" },
    });
  });

  it("sends an enabled magic link with a fixed invitation callback path", async () => {
    mocks.authMethods.mockResolvedValue({
      password: false,
      magicLink: true,
      emailOtp: false,
    });
    mocks.search = {
      stage: "email",
      factor: "totp",
      invitationId: "invite-1",
    };
    mocks.magicLink.mockResolvedValue({ data: { status: true } });
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "auth:signInForm.sendMagicLink",
      }),
    );

    await waitFor(() =>
      expect(mocks.magicLink).toHaveBeenCalledWith({
        email: "customer@example.test",
        callbackURL: "/invite/invite-1",
        fetchOptions: {
          headers: { "x-taskdesk-invitation-id": "invite-1" },
        },
      }),
    );
  });

  it("opens the factor stage only when the existing password endpoint requests it", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = {
      stage: "password",
      factor: "totp",
      invitationId: undefined,
    };
    mocks.signIn.mockResolvedValue({ data: { twoFactorRedirect: true } });
    renderSignIn();
    fireEvent.change(await screen.findByLabelText("auth:forms.password"), {
      target: { value: "correct-password" },
    });
    fireEvent.submit(
      screen
        .getByLabelText("auth:forms.password")
        .closest("form") as HTMLFormElement,
    );

    expect(
      await screen.findByLabelText("auth:twoFactor.authenticatorCode"),
    ).toBeTruthy();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { stage: "factor", factor: "totp" },
      replace: true,
    });
    expect(mocks.verifyTotp).not.toHaveBeenCalled();
  });

  it("keeps a successful response without an admitted portal session generic", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = {
      stage: "password",
      factor: "totp",
      invitationId: undefined,
    };
    mocks.signIn.mockResolvedValue({ data: { token: "opaque" } });
    mocks.getSession.mockResolvedValue({ data: null });
    renderSignIn();
    fireEvent.change(await screen.findByLabelText("auth:forms.password"), {
      target: { value: "some-password" },
    });
    fireEvent.submit(
      screen
        .getByLabelText("auth:forms.password")
        .closest("form") as HTMLFormElement,
    );

    expect(
      await screen.findByText("auth:signInForm.failedSignIn"),
    ).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalledWith({ to: "/catalogue" });
  });

  it("completes a TOTP challenge to the catalogue using the existing portal client", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = { stage: "factor", factor: "totp", invitationId: undefined };
    mocks.verifyTotp.mockResolvedValue({ data: { success: true } });
    mocks.getSession.mockResolvedValue({
      data: { session: { id: "session" } },
    });
    renderSignIn();
    fireEvent.change(
      screen.getByLabelText("auth:twoFactor.authenticatorCode"),
      {
        target: { value: "123456" },
      },
    );
    fireEvent.submit(
      screen
        .getByLabelText("auth:twoFactor.authenticatorCode")
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: "123456" }),
    );
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("auth:twoFactor.title")).toBeTruthy();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/catalogue" });
  });

  it("completes a backup-code challenge through the existing portal verifier", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = {
      stage: "factor",
      factor: "backup",
      invitationId: undefined,
    };
    mocks.verifyBackupCode.mockResolvedValue({ data: { success: true } });
    mocks.getSession.mockResolvedValue({
      data: { session: { id: "session" } },
    });
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:twoFactor.backupCode"), {
      target: { value: "backup-code" },
    });
    fireEvent.submit(
      screen
        .getByLabelText("auth:twoFactor.backupCode")
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(mocks.verifyBackupCode).toHaveBeenCalledWith({
        code: "backup-code",
      }),
    );
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("auth:twoFactor.title")).toBeTruthy();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/catalogue" });
  });
  it.each(["password", "totp", "backup"] as const)(
    "clears customer A's queries and pending results before customer B enters via %s",
    async (method) => {
      const client = new QueryClient();
      client.setQueryData(["portal", "customer-a", "submissions"], {
        privateTitle: "A private request",
      });
      client.setQueryData(["portal", "submission", "SUB-7"], {
        privateTitle: "Old unscoped cache",
      });
      window.sessionStorage.setItem(
        "taskdesk:portal-sign-in-email",
        "customer-b@example.test",
      );
      mocks.search = {
        stage: method === "password" ? "password" : "factor",
        factor: method === "backup" ? "backup" : "totp",
        invitationId: undefined,
      };
      mocks.signIn.mockResolvedValue({ data: { token: "customer-b-token" } });
      mocks.verifyTotp.mockResolvedValue({ data: { success: true } });
      mocks.verifyBackupCode.mockResolvedValue({ data: { success: true } });
      mocks.getSession.mockResolvedValue({
        data: {
          session: { id: "customer-b-session" },
          user: { id: "customer-b" },
        },
      });
      mocks.navigate.mockImplementation(async ({ to }) => {
        if (to === "/catalogue")
          expect(client.getQueryCache().getAll()).toEqual([]);
      });
      renderSignIn(client);
      const field = await screen.findByLabelText(
        method === "password"
          ? "auth:forms.password"
          : method === "backup"
            ? "auth:twoFactor.backupCode"
            : "auth:twoFactor.authenticatorCode",
      );
      fireEvent.change(field, {
        target: { value: method === "password" ? "valid-password" : "123456" },
      });
      fireEvent.submit(field.closest("form") as HTMLFormElement);
      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith({ to: "/catalogue" }),
      );
      expect(
        client.getQueryCache().findAll({ queryKey: ["portal", "customer-a"] }),
      ).toEqual([]);
      expect(
        client.getQueryCache().findAll({ queryKey: ["portal", "submission"] }),
      ).toEqual([]);
    },
  );
});
