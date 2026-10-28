import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) =>
      translate(
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey,
        options,
      ),
  }),
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/fetchers/god-mode/instance-settings", () => ({
  getInstanceSettings: (...args: unknown[]) => mocks.get(...args),
  patchInstanceSettings: (...args: unknown[]) => mocks.patch(...args),
  InstanceSettingsConflictError: class InstanceSettingsConflictError extends Error {},
}));

import { InstanceSettingsForm } from "./instance-settings-form";

const response = {
  updatedAt: "2026-10-25T00:00:00.000Z",
  settings: {
    approvalDefaultExpiryDays: 7,
    clarificationWindowDays: 14,
    reopenWindowDays: 14,
    notificationRetentionDays: 90,
    cspMode: "report_only" as const,
    invitationLifetimeHours: 48,
    customerInvitationCreateWindowMinutes: 60,
    customerInvitationPerInviterLimit: 20,
    customerInvitationPerOrganisationLimit: 50,
    customerInvitationResendCooldownSeconds: 60,
    anonymousRateLimitWindowMs: 600_000,
    anonymousRateLimitMax: 100,
    mcpWriteCeilingPerMinute: 30,
    apiKeyBurstThreshold: 300,
    timezone: "UTC",
    attachmentMaxBytes: 25 * 1024 * 1024,
    attachmentMaxPerItem: 100,
    attachmentAllowedExtensions: ["pdf"],
  },
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.patch.mockReset();
  mocks.get.mockResolvedValue(response);
});
afterEach(cleanup);

async function chooseSelectOption(combobox: HTMLElement, name: string) {
  fireEvent.click(combobox);
  const option = await screen.findByRole("option", { name });
  // Base UI ignores a mouse activation immediately after opening to avoid
  // interpreting the opening pointer-up as an option selection.
  await new Promise((resolve) => setTimeout(resolve, 300));
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}

function renderForm() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InstanceSettingsForm />
    </QueryClientProvider>,
  );
}

describe("instance MCP rate setting", () => {
  it("loads the persisted ceiling and saves changes through instance settings", async () => {
    mocks.patch.mockResolvedValue({
      ...response,
      updatedAt: "2026-10-25T00:01:00.000Z",
      settings: { ...response.settings, mcpWriteCeilingPerMinute: 12 },
    });
    renderForm();

    const input = await screen.findByLabelText(
      translate("godModeSettings:fields.mcpWriteCeilingPerMinute.label"),
    );
    expect(input).toHaveValue(30);
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "100");
    expect(
      screen.getByText(translate("godModeSettings:mcpRateLimit.description")),
    ).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(
      screen.getByRole("button", { name: translate("godModeSettings:save") }),
    );
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        expectedUpdatedAt: response.updatedAt,
        changes: { mcpWriteCeilingPerMinute: 12 },
      }),
    );
  });
  it("edits the persisted burst threshold separately from the write ceiling", async () => {
    mocks.patch.mockResolvedValue({
      ...response,
      settings: { ...response.settings, apiKeyBurstThreshold: 450 },
    });
    renderForm();
    const input = await screen.findByLabelText(
      translate("godModeSettings:fields.apiKeyBurstThreshold.label"),
    );
    expect(input).toHaveValue(300);
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "100000");
    fireEvent.change(input, { target: { value: "450" } });
    fireEvent.click(
      screen.getByRole("button", { name: translate("godModeSettings:save") }),
    );
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        expectedUpdatedAt: response.updatedAt,
        changes: { apiKeyBurstThreshold: 450 },
      }),
    );
  });
});

describe("content security policy settings", () => {
  it("saves report-only or enforced mode through the shared settings patch", async () => {
    mocks.patch.mockResolvedValue({
      ...response,
      updatedAt: "2026-10-25T00:03:00.000Z",
      settings: { ...response.settings, cspMode: "enforce" },
    });
    renderForm();

    const policyMode = await screen.findByRole("combobox", {
      name: translate("godModeSettings:fields.cspMode.label"),
    });
    expect(policyMode).toHaveTextContent(
      translate("godModeSettings:cspModeOptions.reportOnly"),
    );
    expect(
      screen.getByText(
        translate("godModeSettings:contentSecurityPolicy.description"),
      ),
    ).toBeInTheDocument();

    await chooseSelectOption(
      policyMode,
      translate("godModeSettings:cspModeOptions.enforce"),
    );
    expect(policyMode).toHaveTextContent(
      translate("godModeSettings:cspModeOptions.enforce"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: translate("godModeSettings:save") }),
    );
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        expectedUpdatedAt: response.updatedAt,
        changes: { cspMode: "enforce" },
      }),
    );
  });
});

describe("customer invitation runtime settings", () => {
  it("edits bounded invitation values through the shared General settings patch", async () => {
    mocks.patch.mockResolvedValue({
      ...response,
      updatedAt: "2026-10-25T00:02:00.000Z",
      settings: {
        ...response.settings,
        invitationLifetimeHours: 72,
        customerInvitationPerOrganisationLimit: 55,
      },
    });
    renderForm();

    const lifetime = await screen.findByLabelText(
      translate("godModeSettings:fields.invitationLifetimeHours.label"),
    );
    const organisationLimit = screen.getByLabelText(
      translate(
        "godModeSettings:fields.customerInvitationPerOrganisationLimit.label",
      ),
    );
    expect(lifetime).toHaveValue(48);
    expect(lifetime).toHaveAttribute("min", "1");
    expect(lifetime).toHaveAttribute("max", "720");
    expect(organisationLimit).toHaveValue(50);
    expect(organisationLimit).toHaveAttribute("max", "10000");
    expect(
      screen.getByText(
        translate("godModeSettings:invitationLimits.description"),
      ),
    ).toBeInTheDocument();

    fireEvent.change(lifetime, { target: { value: "72" } });
    fireEvent.change(organisationLimit, { target: { value: "55" } });
    fireEvent.click(
      screen.getByRole("button", { name: translate("godModeSettings:save") }),
    );
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        expectedUpdatedAt: response.updatedAt,
        changes: {
          invitationLifetimeHours: 72,
          customerInvitationPerOrganisationLimit: 55,
        },
      }),
    );
  });
});
