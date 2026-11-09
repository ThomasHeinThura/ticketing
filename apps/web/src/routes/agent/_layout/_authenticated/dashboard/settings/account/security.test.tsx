import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./security";

const fixture = vi.hoisted(() => ({
  search: {
    enrollmentRequired: true,
    identityLinkIntent: undefined as string | undefined,
  },
  enable: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => fixture.search,
  }),
  useNavigate: () => fixture.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/settings/connected-accounts-panel", async () => {
  const { Button } = await import("@taskdesk/ui");
  return {
    ConnectedAccountsPanel: ({
      onClearIntent,
    }: {
      onClearIntent: () => void;
    }) => (
      <Button onClick={onClearIntent}>Clear connected identity intent</Button>
    ),
  };
});
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `/api/${path}`,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { twoFactor: { enable: fixture.enable, verifyTotp: vi.fn() } },
}));

const SecurityPage = (Route as unknown as { component: ComponentType })
  .component;

function factorStatus(passwordRequiredForEnrollment: boolean) {
  return new Response(
    JSON.stringify({
      enabled: false,
      required: true,
      passwordRequiredForEnrollment,
      policyMode: "required_staff",
      availableMethods: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("account security factor enrollment", () => {
  beforeEach(() => {
    fixture.search = {
      enrollmentRequired: true,
      identityLinkIntent: undefined,
    };
    fixture.enable.mockReset();
    fixture.navigate.mockReset();
    fixture.enable.mockResolvedValue({
      data: {
        method: "totp",
        totpURI: "otpauth://totp/TaskDesk:test",
        backupCodes: ["one"],
      },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => factorStatus(false)),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lets an SSO-only account start required TOTP enrollment without a password", async () => {
    render(<SecurityPage />);

    expect(
      await screen.findByText("auth:accountSecurity.required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("auth:accountSecurity.statusOff"),
    ).toBeInTheDocument();
    // No password is needed, so "Set up" starts enrollment without a dialog.
    fireEvent.click(
      screen.getByRole("button", { name: "auth:accountSecurity.setupAction" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(fixture.enable).toHaveBeenCalledWith({ issuer: "TaskDesk" }),
    );
    expect(
      await screen.findByText("auth:accountSecurity.scanTitle"),
    ).toBeInTheDocument();
  });

  it("requires the password for an account that has a credential password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => factorStatus(true)),
    );
    render(<SecurityPage />);

    // S8: the page opens on a status row, not on a bare password field.
    expect(
      screen.queryByLabelText("auth:accountSecurity.passwordLabel"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "auth:accountSecurity.setupAction",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    const password = within(dialog).getByLabelText(
      "auth:accountSecurity.passwordLabel",
    );
    const start = within(dialog).getByRole("button", {
      name: "auth:accountSecurity.setupButton",
    });
    expect(start).toBeDisabled();

    fireEvent.change(password, { target: { value: "current-password" } });
    fireEvent.click(start);

    await waitFor(() =>
      expect(fixture.enable).toHaveBeenCalledWith({
        password: "current-password",
        issuer: "TaskDesk",
      }),
    );
    expect(
      await screen.findByText("auth:accountSecurity.scanTitle"),
    ).toBeInTheDocument();
  });

  it("shows the authenticator as on once a factor is enrolled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              enabled: true,
              required: false,
              passwordRequiredForEnrollment: true,
              policyMode: "optional",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    render(<SecurityPage />);
    expect(
      await screen.findByText("auth:accountSecurity.statusOn"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "auth:accountSecurity.setupAction",
      }),
    ).not.toBeInTheDocument();
  });

  it("clears the callback intent while preserving the TOTP enrollment query", async () => {
    fixture.search = {
      enrollmentRequired: true,
      identityLinkIntent: "i".repeat(43),
    };
    render(<SecurityPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Clear connected identity intent" }),
    );

    expect(fixture.navigate).toHaveBeenCalledWith({
      to: "/dashboard/settings/account/security",
      search: { enrollmentRequired: true },
      replace: true,
    });
  });
});
