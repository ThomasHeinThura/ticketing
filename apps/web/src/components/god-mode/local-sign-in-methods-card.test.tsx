import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAuthMethods } from "@/fetchers/god-mode/local-auth-methods";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  prove: vi.fn(),
  toast: vi.fn(),
  factorStatus: {
    enabled: false,
    required: false,
    availableMethods: ["password"] as string[],
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) =>
      translate(
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey,
        options,
      ),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to: _to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }) => (
    <a href="/link" {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/fetchers/god-mode/local-auth-methods", () => ({
  getLocalAuthMethods: (...args: unknown[]) => mocks.get(...args),
  updateLocalAuthMethods: (...args: unknown[]) => mocks.update(...args),
}));
vi.mock("@/fetchers/god-mode/identity-step-up", () => ({
  proveIdentityOperation: (...args: unknown[]) => mocks.prove(...args),
}));
vi.mock("@/fetchers/god-mode/instance-users", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/instance-users")
  >()),
  getCurrentFactorStatus: async () => mocks.factorStatus,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: (...args: unknown[]) => mocks.toast(...args) },
}));

import { LocalSignInMethodsCard } from "./local-sign-in-methods-card";

const stored: LocalAuthMethods = {
  agent: { password: true, magicLink: true, emailOtp: true },
  customer: { password: false, magicLink: false, emailOtp: false },
  emailProviderEnabled: true,
  emailOtpDisabledByEnvironment: false,
  revision: "a".repeat(64),
};

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(stored);
  mocks.update.mockReset();
  mocks.prove.mockReset().mockResolvedValue("step-up-token");
  mocks.toast.mockReset();
});
afterEach(cleanup);

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["god-mode", "step-up-factor"], mocks.factorStatus);
  render(
    <QueryClientProvider client={client}>
      <LocalSignInMethodsCard />
    </QueryClientProvider>,
  );
  return client;
}

describe("LocalSignInMethodsCard", () => {
  it("locks staff password on and starts with nothing to save", async () => {
    renderCard();
    const staffPassword = await screen.findByRole("switch", {
      name: "Password for Staff",
    });
    expect(staffPassword).toBeChecked();
    expect(staffPassword).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("switch", { name: "Password for Customers" }),
    ).not.toBeChecked();
    expect(
      screen.getByText(/Staff password sign-in is always on/u),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save sign-in methods" }),
    ).toBeDisabled();
  });

  it("saves the exact six switches with one bound proof", async () => {
    const saved = {
      ...stored,
      customer: { password: true, magicLink: false, emailOtp: false },
      revision: "b".repeat(64),
    };
    mocks.update.mockResolvedValue(saved);
    renderCard();
    fireEvent.click(
      await screen.findByRole("switch", { name: "Password for Customers" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save sign-in methods" }),
    );
    expect(
      await screen.findByText("Password for Customers: on"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const request = {
      agent: { password: true, magicLink: true, emailOtp: true },
      customer: { password: true, magicLink: false, emailOtp: false },
      expectedRevision: "a".repeat(64),
    };
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.prove).toHaveBeenCalledWith(
      { operation: "auth_local_methods_update", ...request },
      { method: "password", secret: "correct horse" },
    );
    expect(mocks.update).toHaveBeenCalledWith(request, "step-up-token");
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Sign-in methods saved"),
    );
    expect(
      screen.getByRole("switch", { name: "Password for Customers" }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Save sign-in methods" }),
    ).toBeDisabled();
  });

  it("writes nothing when verification fails", async () => {
    mocks.prove.mockRejectedValue(new Error("refused"));
    renderCard();
    fireEvent.click(
      await screen.findByRole("switch", { name: "Magic link for Customers" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save sign-in methods" }),
    );
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Sign-in methods were not saved"),
    ).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("reports a newer save elsewhere and reloads on request", async () => {
    const { IdentityAdminError } = await import(
      "@/fetchers/god-mode/identity-admin-error"
    );
    mocks.update.mockRejectedValue(
      new IdentityAdminError(409, "x", "version_conflict", null),
    );
    renderCard();
    fireEvent.click(
      await screen.findByRole("switch", { name: "Email code for Customers" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save sign-in methods" }),
    );
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(/This configuration changed in another session/u),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reload latest settings" }),
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("switch", { name: "Email code for Customers" }),
    ).not.toBeChecked();
  });

  it("locks email code off and sends it off while the environment disables it", async () => {
    // An older stored row still says on; the runtime cannot serve it, so the card shows and
    // sends off, and a save of another switch stays within what the server accepts.
    mocks.get.mockResolvedValue({
      ...stored,
      customer: { password: false, magicLink: false, emailOtp: true },
      emailOtpDisabledByEnvironment: true,
    });
    mocks.update.mockResolvedValue(stored);
    renderCard();
    for (const audience of ["Staff", "Customers"]) {
      const emailCode = await screen.findByRole("switch", {
        name: `Email code for ${audience}`,
      });
      expect(emailCode).not.toBeChecked();
      expect(emailCode).toHaveAttribute("aria-disabled", "true");
    }
    expect(
      screen.getByRole("button", { name: "Save sign-in methods" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("switch", { name: "Password for Customers" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save sign-in methods" }),
    );
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith(
      {
        agent: { password: true, magicLink: true, emailOtp: false },
        customer: { password: true, magicLink: false, emailOtp: false },
        expectedRevision: "a".repeat(64),
      },
      "step-up-token",
    );
  });

  it("warns that email methods need an email provider", async () => {
    mocks.get.mockResolvedValue({ ...stored, emailProviderEnabled: false });
    renderCard();
    expect(
      await screen.findByText("No email provider is enabled"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open email settings" }),
    ).toBeInTheDocument();
  });
});
