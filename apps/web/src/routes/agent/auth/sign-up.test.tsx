import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "./sign-up";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: { disableRegistration: true } }),
}));
vi.mock("@/components/auth/layout", () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/auth/sign-up-form", () => ({
  SignUpForm: () => <form aria-label="sign up" />,
}));
vi.mock("@/components/auth/sso-providers", () => ({
  SSOProviders: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const SignUp = (Route as unknown as { options: { component: ComponentType } })
  .options.component;
afterEach(cleanup);
it("shows an invitation-only screen instead of a form", () => {
  render(<SignUp />);
  expect(screen.getByText("auth:signUp.invitationOnly")).toBeInTheDocument();
  expect(
    screen.queryByRole("form", { name: "sign up" }),
  ).not.toBeInTheDocument();
});
