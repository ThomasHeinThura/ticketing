import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/identity-test-harness";
import {
  formatCountdown,
  ImpersonationBanner,
  secondsUntil,
} from "./impersonation-banner";

const mocks = vi.hoisted(() => ({ status: vi.fn(), end: vi.fn() }));

vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(namespace ? `${namespace}:${key}` : key, options),
      i18n: { language: "en-US" },
      ready: true,
    }),
  };
});
vi.mock("@/fetchers/god-mode/impersonation", () => ({
  getImpersonationStatus: (...args: unknown[]) => mocks.status(...args),
  endImpersonation: (...args: unknown[]) => mocks.end(...args),
}));

const assign = vi.fn();

beforeEach(() => {
  mocks.end.mockResolvedValue({ ended: true, reason: "exit", restored: true });
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("impersonation banner (GM-11)", () => {
  it("formats the remaining time and never goes negative", () => {
    const now = Date.parse("2026-10-23T10:00:00Z");
    expect(secondsUntil("2026-10-23T10:30:00Z", now)).toBe(1800);
    expect(secondsUntil("2026-10-23T09:59:00Z", now)).toBe(0);
    expect(secondsUntil(null, now)).toBe(0);
    expect(formatCountdown(1800)).toBe("30:00");
    expect(formatCountdown(65)).toBe("1:05");
  });

  it("names both people, the countdown and the reason, and exits on demand", async () => {
    mocks.status.mockResolvedValue({
      impersonating: true,
      impersonator: { id: "admin-1", name: "Ada Admin" },
      target: { id: "user-1", name: "Tom Target", email: "tom@example.test" },
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(),
      reason: "Reproducing the missing board column",
    });
    renderWithQuery(<ImpersonationBanner />);
    expect(
      await screen.findByText("Ada Admin is impersonating Tom Target"),
    ).toBeDefined();
    expect(screen.getByText(/Session ends in/u)).toBeDefined();
    expect(
      screen.getByText(/Reproducing the missing board column/u),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Exit impersonation" }));
    await waitFor(() => expect(mocks.end).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(assign).toHaveBeenCalled());
  });

  it("renders nothing for a session that is not impersonated", async () => {
    mocks.status.mockResolvedValue({
      impersonating: false,
      impersonator: null,
      target: null,
      startedAt: null,
      expiresAt: null,
      reason: null,
    });
    renderWithQuery(<ImpersonationBanner />);
    await waitFor(() => expect(mocks.status).toHaveBeenCalled());
    expect(screen.queryByTestId("impersonation-banner")).toBeNull();
  });

  it("exits automatically at the 30-minute cap", async () => {
    mocks.status.mockResolvedValue({
      impersonating: true,
      impersonator: { id: "admin-1", name: "Ada Admin" },
      target: { id: "user-1", name: "Tom Target", email: "tom@example.test" },
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      reason: null,
    });
    renderWithQuery(<ImpersonationBanner />);
    await waitFor(() => expect(mocks.end).toHaveBeenCalledTimes(1));
  });
});
