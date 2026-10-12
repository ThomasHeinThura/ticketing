import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "./sign-in-form";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: vi.fn() } },
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

describe("SignInForm password control", () => {
  it("associates the visible label with the input through toggling visibility", () => {
    render(<SignInForm />);

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
  });
});
