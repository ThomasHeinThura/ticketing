import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPasswordResetToken } from "@/lib/password-reset-token";
import { ForgotPassword, ResetPassword } from "./password-recovery";

const request = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/use-send-password-reset", () => ({
  default: () => ({ mutateAsync: request, isPending: false }),
}));
vi.mock("@/hooks/mutations/use-reset-password", () => ({
  default: () => ({ mutateAsync: reset, isPending: false, reset: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/");
});

describe.each([false, true])("password recovery portal=%s", (portal) => {
  it("shows the same confirmation even when sending fails", async () => {
    request.mockRejectedValueOnce(new Error("unavailable"));
    render(<ForgotPassword portal={portal} />);
    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "person@example.test" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:passwordRecovery.send" }),
    );
    expect(
      await screen.findByText("auth:passwordRecovery.confirmation"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "auth:passwordRecovery.back" }),
    ).toHaveAttribute("href", portal ? "/sign-in" : "/auth/sign-in");
  });
  it("rejects missing tokens", () => {
    render(<ResetPassword portal={portal} />);
    expect(
      screen.getByText("auth:passwordRecovery.invalid"),
    ).toBeInTheDocument();
  });
  it("shows an invalid link after the server rejects an expired or used token", async () => {
    window.history.replaceState(
      {},
      "",
      `${portal ? "/reset-password" : "/auth/reset-password"}#token=raw.${"a".repeat(43)}`,
    );
    reset.mockRejectedValueOnce(new Error("invalid"));
    render(<ResetPassword portal={portal} />);
    expect(window.location.search).not.toContain("token");
    expect(window.location.hash).not.toContain("token");
    fireEvent.change(
      screen.getByLabelText("auth:passwordRecovery.newPassword"),
      { target: { value: "long-password" } },
    );
    fireEvent.change(
      screen.getByLabelText("auth:passwordRecovery.confirmPassword"),
      { target: { value: "long-password" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "auth:passwordRecovery.reset" }),
    );
    expect(
      await screen.findByText("auth:passwordRecovery.invalid"),
    ).toBeInTheDocument();
    expect(window.location.search).not.toContain("token");
    expect(window.location.hash).not.toContain("token");
    expect(readPasswordResetToken()).toBe("");
  });
  it("focuses mismatched confirmation and submits valid passwords", async () => {
    window.history.replaceState(
      {},
      "",
      `${portal ? "/reset-password" : "/auth/reset-password"}#token=raw.${"a".repeat(43)}`,
    );
    reset.mockResolvedValueOnce({});
    render(<ResetPassword portal={portal} />);
    expect(window.location.search).not.toContain("token");
    expect(window.location.hash).not.toContain("token");
    const password = screen.getByLabelText("auth:passwordRecovery.newPassword");
    const confirm = screen.getByLabelText(
      "auth:passwordRecovery.confirmPassword",
    );
    fireEvent.change(password, { target: { value: "long-password" } });
    fireEvent.change(confirm, { target: { value: "different" } });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:passwordRecovery.reset" }),
    );
    expect(confirm).toHaveFocus();
    fireEvent.change(confirm, { target: { value: "long-password" } });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:passwordRecovery.reset" }),
    );
    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith({
        token: `raw.${"a".repeat(43)}`,
        newPassword: "long-password",
      }),
    );
    expect(
      await screen.findByText("auth:passwordRecovery.success"),
    ).toBeInTheDocument();
    expect(window.location.search).not.toContain("token");
    expect(window.location.hash).not.toContain("token");
    expect(readPasswordResetToken()).toBe("");
  });
});
