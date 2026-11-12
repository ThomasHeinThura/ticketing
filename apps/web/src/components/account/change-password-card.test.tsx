import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordCard } from "./change-password-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ toast: { success: toastSuccess } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

for (const surface of ["agent", "portal"]) {
  describe(`${surface} change password card`, () => {
    const change = vi.fn();
    function setup(hasLocalPassword = true) {
      change.mockReset();
      render(
        <ChangePasswordCard
          hasLocalPassword={hasLocalPassword}
          changePassword={change}
        />,
      );
    }
    function fill(current: string, password: string, confirmation: string) {
      fireEvent.change(
        screen.getByLabelText("auth:changePassword.currentPassword"),
        { target: { value: current } },
      );
      fireEvent.change(
        screen.getByLabelText("auth:changePassword.newPassword"),
        { target: { value: password } },
      );
      fireEvent.change(
        screen.getByLabelText("auth:changePassword.confirmPassword"),
        { target: { value: confirmation } },
      );
    }
    function submit() {
      fireEvent.click(
        screen.getByRole("button", { name: "auth:changePassword.submit" }),
      );
    }
    it("hides the card for SSO-only accounts", () => {
      setup(false);
      expect(
        screen.queryByRole("button", { name: "auth:changePassword.submit" }),
      ).toBeNull();
    });
    it("focuses and reports weak passwords and mismatches", () => {
      setup();
      fill("old-password", "weak", "weak");
      submit();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "auth:signUpForm.passwordTooShort",
      );
      expect(
        screen.getByLabelText("auth:changePassword.newPassword"),
      ).toHaveFocus();
      fill("old-password", "valid-password", "other-password");
      submit();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "auth:changePassword.mismatch",
      );
      expect(
        screen.getByLabelText("auth:changePassword.confirmPassword"),
      ).toHaveFocus();
      expect(change).not.toHaveBeenCalled();
    });
    it("reports an incorrect current password inline", async () => {
      setup();
      change.mockRejectedValueOnce(new Error("INVALID_PASSWORD"));
      fill("old-password", "valid-password", "valid-password");
      submit();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "auth:changePassword.wrongCurrent",
      );
      expect(
        screen.getByLabelText("auth:changePassword.currentPassword"),
      ).toHaveFocus();
    });
    it("allows retaining other sessions", async () => {
      setup();
      change.mockResolvedValueOnce({});
      fireEvent.click(
        screen.getByRole("checkbox", { name: "auth:changePassword.revoke" }),
      );
      fill("old-password", "valid-password", "valid-password");
      submit();
      await waitFor(() =>
        expect(change).toHaveBeenCalledWith({
          currentPassword: "old-password",
          newPassword: "valid-password",
          revokeOtherSessions: false,
        }),
      );
    });
    it("sends the default revocation and clears fields on success", async () => {
      setup();
      change.mockResolvedValueOnce({});
      fill("old-password", "valid-password", "valid-password");
      submit();
      await waitFor(() =>
        expect(change).toHaveBeenCalledWith({
          currentPassword: "old-password",
          newPassword: "valid-password",
          revokeOtherSessions: true,
        }),
      );
      await waitFor(() =>
        expect(
          screen.getByLabelText("auth:changePassword.currentPassword"),
        ).toHaveValue(""),
      );
      expect(
        screen.getByLabelText("auth:changePassword.newPassword"),
      ).toHaveValue("");
      expect(
        screen.getByLabelText("auth:changePassword.confirmPassword"),
      ).toHaveValue("");
      expect(toastSuccess).toHaveBeenCalledWith("auth:changePassword.success");
    });
  });
}
