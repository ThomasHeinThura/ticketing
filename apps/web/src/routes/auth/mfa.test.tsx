import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./mfa.index";

const { verifyTotp, verifyBackupCode, push } = vi.hoisted(() => ({
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  push: vi.fn(),
}));
let search = {
  redirect: undefined as string | undefined,
  invitationId: undefined as string | undefined,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useRouter: () => ({ history: { push } }),
  useSearch: () => search,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { twoFactor: { verifyTotp, verifyBackupCode } },
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

const MfaChallenge = (Route as unknown as { component: ComponentType })
  .component;

afterEach(() => {
  cleanup();
  verifyTotp.mockReset();
  verifyBackupCode.mockReset();
  push.mockReset();
  search = { redirect: undefined, invitationId: undefined };
});

describe("MfaChallenge", () => {
  it("verifies a TOTP code and returns to a safe local destination", async () => {
    search = { redirect: "/agent/work-items/ABC-1", invitationId: undefined };
    verifyTotp.mockResolvedValue({ data: {}, error: null });
    render(<MfaChallenge />);

    fireEvent.change(screen.getByLabelText("auth:mfa.challenge.totpLabel"), {
      target: { value: "123456" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "auth:mfa.challenge.continue" })
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(verifyTotp).toHaveBeenCalledWith({ code: "123456" }),
    );
    expect(push).toHaveBeenCalledWith("/agent/work-items/ABC-1");
  });

  it("uses a backup code through the backup-code verifier", async () => {
    verifyBackupCode.mockResolvedValue({ data: {}, error: null });
    render(<MfaChallenge />);

    fireEvent.click(
      screen.getByRole("button", { name: "auth:mfa.challenge.useBackupCode" }),
    );
    fireEvent.change(screen.getByLabelText("auth:mfa.challenge.backupLabel"), {
      target: { value: "ABCD-1234" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "auth:mfa.challenge.continue" })
        .closest("form") as HTMLFormElement,
    );

    await waitFor(() =>
      expect(verifyBackupCode).toHaveBeenCalledWith({ code: "ABCD-1234" }),
    );
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(verifyTotp).not.toHaveBeenCalled();
  });

  it("does not send a malformed TOTP code to the server", async () => {
    render(<MfaChallenge />);
    fireEvent.change(screen.getByLabelText("auth:mfa.challenge.totpLabel"), {
      target: { value: "123" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "auth:mfa.challenge.continue" })
        .closest("form") as HTMLFormElement,
    );

    expect(verifyTotp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
