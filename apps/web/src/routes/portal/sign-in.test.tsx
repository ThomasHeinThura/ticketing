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
  search: { stage: "email", factor: "totp" as "totp" | "backup" },
  navigate: vi.fn(),
  signIn: vi.fn(),
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
    signIn: { email: mocks.signIn },
    getSession: mocks.getSession,
    twoFactor: {
      verifyTotp: mocks.verifyTotp,
      verifyBackupCode: mocks.verifyBackupCode,
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PortalSignIn = (Route as unknown as { component: ComponentType })
  .component;

function renderSignIn() {
  return render(<PortalSignIn />);
}

describe("portal sign-in", () => {
  beforeEach(() => {
    mocks.search = { stage: "email", factor: "totp" };
    mocks.navigate.mockReset();
    mocks.signIn.mockReset();
    mocks.getSession.mockReset();
    mocks.verifyTotp.mockReset();
    mocks.verifyBackupCode.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(cleanup);

  it("keeps the email-first step local and moves the open stage into the URL", () => {
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
    expect(window.sessionStorage.getItem("taskdesk:portal-sign-in-email")).toBe(
      "customer@example.test",
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { stage: "password", factor: "totp" },
      replace: true,
    });
    expect(window.location.search).toBe("");
  });

  it("uses one generic failure for password denial", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = { stage: "password", factor: "totp" };
    mocks.signIn.mockResolvedValue({ error: { message: "provider disabled" } });
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.password"), {
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

  it("restores the password stage after reload without putting the email in the URL", () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = { stage: "password", factor: "totp" };
    renderSignIn();

    expect(screen.getByLabelText("auth:forms.email")).toHaveProperty(
      "value",
      "customer@example.test",
    );
    expect(screen.getByLabelText("auth:forms.email")).toHaveProperty(
      "readOnly",
      true,
    );
    expect(window.location.search).toBe("");
  });

  it("sends an admitted password session to the catalogue", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = { stage: "password", factor: "totp" };
    mocks.signIn.mockResolvedValue({ data: { token: "opaque" } });
    mocks.getSession.mockResolvedValue({
      data: { session: { id: "session" } },
    });
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.password"), {
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

  it("opens the factor stage only when the existing password endpoint requests it", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = { stage: "password", factor: "totp" };
    mocks.signIn.mockResolvedValue({ data: { twoFactorRedirect: true } });
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.password"), {
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
  });

  it("keeps a successful response without an admitted portal session generic", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = { stage: "password", factor: "totp" };
    mocks.signIn.mockResolvedValue({ data: { token: "opaque" } });
    mocks.getSession.mockResolvedValue({ data: null });
    renderSignIn();
    fireEvent.change(screen.getByLabelText("auth:forms.password"), {
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
    mocks.search = { stage: "factor", factor: "totp" };
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

    expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: "123456" });
    expect(await screen.findByText("auth:twoFactor.title")).toBeTruthy();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/catalogue" });
  });

  it("completes a backup-code challenge through the existing portal verifier", async () => {
    window.sessionStorage.setItem(
      "taskdesk:portal-sign-in-email",
      "customer@example.test",
    );
    mocks.search = { stage: "factor", factor: "backup" };
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

    expect(mocks.verifyBackupCode).toHaveBeenCalledWith({
      code: "backup-code",
    });
    expect(await screen.findByText("auth:twoFactor.title")).toBeTruthy();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/catalogue" });
  });
});
