import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";
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

describe("SignInForm on the wrong host (A-05)", () => {
  it("names the customer portal and never reports success for a refused customer", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: {
        status: 403,
        code: "USE_CUSTOMER_PORTAL",
        message: "Use the customer portal for this account.",
      },
    } as never);
    const onSuccess = vi.fn();
    render(<SignInForm onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText("auth:forms.email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.change(
      screen.getByLabelText("auth:forms.password", { exact: true }),
      { target: { value: "secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "auth:signInForm.signIn" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "auth:wrongPortal.useCustomerPortal",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
