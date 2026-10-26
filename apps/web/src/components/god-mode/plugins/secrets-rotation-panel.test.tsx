import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ health: vi.fn() }));
vi.mock("@/fetchers/god-mode/instance-health", () => ({
  getInstanceHealth: () => mocks.health(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/lib/routes", () => ({
  routes: { godModeJobs: { path: "/agent/god-mode/jobs" } },
}));

import { SecretsRotationPanel } from "./secrets-rotation-panel";

function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SecretsRotationPanel />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.health.mockReset();
});
afterEach(cleanup);

describe("Plugins secrets rotation", () => {
  it("fails closed when current health cannot be loaded", async () => {
    mocks.health.mockRejectedValue(new Error("unavailable"));
    mount();
    expect(await screen.findByText("loadFailed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "rotateSecrets.action" }),
    ).toBeDisabled();
    expect(screen.queryByText(/details.secretsTotal/)).not.toBeInTheDocument();
  });
  it("shows persisted progress and the job history without claiming completion", async () => {
    mocks.health.mockResolvedValue({
      state: "degraded",
      checks: [
        {
          key: "secrets_encryption",
          state: "degraded",
          detail: {
            keyConfigured: true,
            secretsTotal: 9,
            secretsPendingRekey: 3,
            rekeyComplete: false,
          },
        },
      ],
    });
    mount();
    expect(
      await screen.findByText("details.secretsPendingRekey: 3"),
    ).toBeInTheDocument();
    expect(screen.getByText("details.secretsTotal: 9")).toBeInTheDocument();
    expect(screen.queryByText(/details.rekeyComplete/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "rotateSecrets.action" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("link", { name: "rotateSecrets.jobs" }),
    ).toHaveAttribute("href", "/agent/god-mode/jobs");
  });
  it("does not offer rotation without a configured key even when health succeeds", async () => {
    mocks.health.mockResolvedValue({
      state: "failing",
      checks: [
        {
          key: "secrets_encryption",
          state: "failing",
          detail: { keyConfigured: false },
        },
      ],
    });
    mount();
    expect(await screen.findByText("states.failing")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "rotateSecrets.action" }),
    ).toBeDisabled();
    expect(screen.queryByText(/details.secretsTotal/)).not.toBeInTheDocument();
  });
});
