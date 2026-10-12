import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignUpForm } from "./sign-up-form";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push: vi.fn() } }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signUp: { email: vi.fn() } },
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignUpForm password control", () => {
  it("associates the label with the input and describes validation errors", async () => {
    render(<SignUpForm />);

    const password = screen.getByLabelText("auth:forms.password", {
      exact: true,
    });
    const label = screen.getByText("auth:forms.password", { exact: true });

    expect(password.tagName).toBe("INPUT");
    expect(password).toHaveAttribute("type", "password");
    expect(label).toHaveAttribute("for", password.id);

    fireEvent.click(
      screen.getByRole("button", { name: "auth:forms.showPassword" }),
    );

    expect(screen.getByLabelText("auth:forms.password", { exact: true })).toBe(
      password,
    );
    expect(password).toHaveAttribute("type", "text");

    fireEvent.click(
      screen.getByRole("button", { name: "auth:signUpForm.createAccount" }),
    );

    await waitFor(() =>
      expect(password).toHaveAttribute("aria-invalid", "true"),
    );
    const error = screen.getByText("auth:signUpForm.passwordTooShort");
    expect(password.getAttribute("aria-describedby")?.split(" ")).toContain(
      error.id,
    );
  });
});
