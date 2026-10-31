import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./sign-in";

/**
 * S6: the staff sign-in page follows the effective staff methods from `/api/config`. When God
 * Mode turns staff email code off on an instance with SMTP, the page must show the password
 * form (the break-glass path, R5), never a send-code form whose endpoint is unmounted. While
 * email code is on, a switch keeps the password form one click away.
 */

const mocks = vi.hoisted(() => ({
  config: {
    hasGoogleSignIn: false,
    hasGithubSignIn: false,
    hasDiscordSignIn: false,
    hasCustomOAuth: false,
    customOAuthAutoLogin: false,
    hasSmtp: true,
    disableEmailOtpSignIn: false,
    disableLoginForm: false,
    disableRegistration: true,
    disablePasswordRegistration: false,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: mocks.config, isLoading: false }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getLastUsedLoginMethod: () => null,
    signIn: { social: vi.fn() },
  },
}));

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/components/page-title", () => ({ default: () => null }));

vi.mock("@/components/auth/layout", () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/auth/sign-in-form", () => ({
  SignInForm: () => <form aria-label="password sign-in" />,
}));

vi.mock("@/components/auth/otp-sign-in-form", () => ({
  OtpSignInForm: () => <form aria-label="email code sign-in" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const SignIn = (Route as unknown as { options: { component: ComponentType } })
  .options.component;

afterEach(() => {
  cleanup();
  mocks.config.disableEmailOtpSignIn = false;
  mocks.config.hasSmtp = true;
});

describe("staff sign-in page", () => {
  it("shows the email-code form while staff email code is on and SMTP is configured", () => {
    render(<SignIn />);
    expect(
      screen.getByRole("form", { name: "email code sign-in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "password sign-in" }),
    ).not.toBeInTheDocument();
  });

  it("keeps staff password reachable next to email code and switches back", () => {
    render(<SignIn />);
    fireEvent.click(
      screen.getByRole("button", { name: "auth:otpSignIn.usePassword" }),
    );
    expect(
      screen.getByRole("form", { name: "password sign-in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "email code sign-in" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:otpSignIn.useEmailCode" }),
    );
    expect(
      screen.getByRole("form", { name: "email code sign-in" }),
    ).toBeInTheDocument();
  });

  it("shows the password form when staff email code is off, even with SMTP configured", () => {
    mocks.config.disableEmailOtpSignIn = true;
    render(<SignIn />);
    expect(
      screen.getByRole("form", { name: "password sign-in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "email code sign-in" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "auth:otpSignIn.usePassword" }),
    ).not.toBeInTheDocument();
  });

  it("shows the password form when no email provider is configured", () => {
    mocks.config.hasSmtp = false;
    render(<SignIn />);
    expect(
      screen.getByRole("form", { name: "password sign-in" }),
    ).toBeInTheDocument();
  });
});
