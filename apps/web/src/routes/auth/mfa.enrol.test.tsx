import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./mfa.enrol";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    useSession: vi.fn(),
    listAccounts: vi.fn(),
    enable: vi.fn(),
    verifyTotp: vi.fn(),
    replace,
    history: { replace },
  };
});
let search = { redirect: undefined as string | undefined };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useRouter: () => ({ history: mocks.history }),
  useSearch: () => search,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: mocks.useSession,
    listAccounts: mocks.listAccounts,
    twoFactor: { enable: mocks.enable, verifyTotp: mocks.verifyTotp },
  },
}));

vi.mock("@/components/page-title", () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/auth/layout", () => ({
  AuthLayout: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MfaEnrollment = (Route as unknown as { component: ComponentType })
  .component;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useSession.mockReturnValue({
    data: { user: { id: "user-1", twoFactorEnabled: false } },
    isPending: false,
  });
  mocks.listAccounts.mockResolvedValue({
    data: [{ providerId: "credential" }],
    error: null,
  });
  mocks.enable.mockResolvedValue({
    data: {
      totpURI:
        "otpauth://totp/TaskDesk%3Auser%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=TaskDesk",
      backupCodes: ["AAAA-BBBB", "CCCC-DDDD"],
    },
    error: null,
  });
  mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
  search = { redirect: "/agent/work-items/PROJ-1" };
});

describe("MfaEnrollment", () => {
  it("requires the local password, verifies setup, and displays backup codes once", async () => {
    render(<MfaEnrollment />);

    const password = await screen.findByLabelText(
      "auth:mfa.enrol.passwordLabel",
    );
    fireEvent.change(password, { target: { value: "correct horse" } });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "auth:mfa.enrol.startEnrollment",
      }),
    );

    await waitFor(() =>
      expect(mocks.enable).toHaveBeenCalledWith({ password: "correct horse" }),
    );
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("auth:mfa.enrol.codeLabel"), {
      target: { value: "123456" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:mfa.enrol.verifyAndEnable" }),
    );

    await screen.findByText("AAAA-BBBB");
    expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: "123456" });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:mfa.enrol.savedCodes" }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/agent/work-items/PROJ-1");
  });

  it("does not require or send a password for an SSO-only account", async () => {
    mocks.listAccounts.mockResolvedValue({
      data: [{ providerId: "custom" }],
      error: null,
    });
    render(<MfaEnrollment />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "auth:mfa.enrol.startEnrollment",
      }),
    );

    await waitFor(() => expect(mocks.enable).toHaveBeenCalledWith({}));
  });

  it("fails closed when linked account methods cannot be loaded", async () => {
    mocks.listAccounts.mockResolvedValue({
      data: null,
      error: { message: "failed" },
    });
    render(<MfaEnrollment />);

    expect(
      await screen.findByText("auth:mfa.enrol.accountCheckFailed"),
    ).toBeTruthy();
    expect(mocks.enable).not.toHaveBeenCalled();
  });
});
