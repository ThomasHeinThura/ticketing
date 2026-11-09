import { randomBytes } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./security";

const testPassword =
  randomBytes(24).toString("hex") + String.fromCharCode(65, 97, 49, 33);

const fixture = vi.hoisted(() => ({
  search: {
    enrollmentRequired: true,
    identityLinkIntent: undefined as string | undefined,
  },
  enable: vi.fn(),
  verifyTotp: vi.fn(),
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
  authClient: {
    twoFactor: { enable: fixture.enable, verifyTotp: fixture.verifyTotp },
  },
}));

const SecurityPage = (Route as unknown as { component: ComponentType })
  .component;

function factorStatus(
  passwordRequiredForEnrollment: boolean,
  overrides: {
    enabled?: boolean;
    required?: boolean;
    policyMode?: string;
  } = {},
) {
  return new Response(
    JSON.stringify({
      enabled: false,
      required: true,
      passwordRequiredForEnrollment,
      policyMode: "required_staff",
      availableMethods: [],
      ...overrides,
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
    fixture.verifyTotp.mockReset();
    fixture.navigate.mockReset();
    fixture.enable.mockResolvedValue({
      data: {
        method: "totp",
        totpURI: "otpauth://totp/TaskDesk:test",
        backupCodes: ["one"],
      },
      error: null,
    });
    fixture.verifyTotp.mockResolvedValue({ data: {}, error: null });
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
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:accountSecurity.setupButton" }),
    );

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

    const password = await screen.findByLabelText("Password");
    const start = screen.getByRole("button", {
      name: "auth:accountSecurity.setupButton",
    });
    expect(start).toBeDisabled();

    fireEvent.change(password, { target: { value: testPassword } });
    fireEvent.click(start);

    await waitFor(() =>
      expect(fixture.enable).toHaveBeenCalledWith({
        password: testPassword,
        issuer: "TaskDesk",
      }),
    );
  });

  it("allows required bootstrap enrollment when the stored policy is off", async () => {
    fixture.search.enrollmentRequired = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => factorStatus(true, { policyMode: "off" })),
    );
    render(<SecurityPage />);

    expect(
      await screen.findByText("auth:accountSecurity.required"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("auth:accountSecurity.enrollmentDisabled"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: testPassword },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:accountSecurity.setupButton" }),
    );
    await waitFor(() =>
      expect(fixture.enable).toHaveBeenCalledWith({
        password: testPassword,
        issuer: "TaskDesk",
      }),
    );
    expect(
      await screen.findByText("auth:accountSecurity.scanTitle"),
    ).toBeInTheDocument();
  });

  it("keeps enrollment disabled when policy is off and enrollment is not required", async () => {
    fixture.search.enrollmentRequired = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        factorStatus(false, { policyMode: "off", required: false }),
      ),
    );
    render(<SecurityPage />);

    expect(
      await screen.findByText("auth:accountSecurity.enrollmentDisabled"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "auth:accountSecurity.setupButton",
      }),
    ).not.toBeInTheDocument();
  });

  it("waits to load connected accounts until required enrollment is verified", async () => {
    let enabled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => factorStatus(false, { enabled })),
    );
    fixture.verifyTotp.mockImplementation(async () => {
      enabled = true;
      return { data: {}, error: null };
    });
    render(<SecurityPage />);

    expect(
      await screen.findByText("auth:accountSecurity.required"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear connected identity intent" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "auth:accountSecurity.setupButton" }),
    );
    const code = await screen.findByLabelText("auth:accountSecurity.codeLabel");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(
      screen.getByRole("button", { name: "auth:accountSecurity.verify" }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Clear connected identity intent",
      }),
    ).toBeInTheDocument();
  });

  it("clears the callback intent while preserving the TOTP enrollment query", async () => {
    fixture.search = {
      enrollmentRequired: true,
      identityLinkIntent: "i".repeat(43),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => factorStatus(false, { enabled: true })),
    );
    render(<SecurityPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Clear connected identity intent",
      }),
    );

    expect(fixture.navigate).toHaveBeenCalledWith({
      to: "/dashboard/settings/account/security",
      search: { enrollmentRequired: true },
      replace: true,
    });
  });
});
