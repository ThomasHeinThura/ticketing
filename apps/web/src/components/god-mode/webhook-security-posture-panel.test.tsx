import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookSecurityPosturePage } from "@/fetchers/god-mode/webhook-security-posture";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  targets: vi.fn(),
  rotate: vi.fn(),
  stepUpRun: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => value,
}));
vi.mock("@/fetchers/god-mode/webhook-security-posture", () => ({
  listWebhookSecurityPosture: (input: unknown) => mocks.list(input),
  listAllWebhookRotationTargets: () => mocks.targets(),
  rotateAllWebhookSecrets: (...input: unknown[]) => mocks.rotate(...input),
  webhookSecretRotationSetDigest: vi.fn().mockResolvedValue("a".repeat(64)),
}));
vi.mock("@/hooks/use-step-up-action", () => ({
  useStepUpAction: () => ({
    method: "password",
    setMethod: vi.fn(),
    secret: "",
    setSecret: vi.fn(),
    busy: false,
    failure: null,
    availableMethods: [],
    canRun: true,
    clearFailure: vi.fn(),
    run: (...args: unknown[]) => mocks.stepUpRun(...args),
  }),
}));

import { WebhookSecurityPosturePanel } from "./webhook-security-posture-panel";

const page: WebhookSecurityPosturePage = {
  data: [
    {
      id: "webhook-1",
      name: "Incident receiver",
      workspaceId: "workspace-1",
      workspaceName: "Support",
      ownerPersonId: "person-1",
      ownerName: "A. Agent",
      receivesEverythingBecause: "sees_all",
      events: ["work_item.updated", "sla.breached"],
      active: true,
      disabledAt: null,
      disabledReason: null,
      secretRotatedAt: "2026-10-25T12:00:00.000Z",
    },
  ],
  page: { nextCursor: "webhook-1", hasMore: true },
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(page);
  mocks.targets.mockReset().mockResolvedValue([
    {
      id: "webhook-1",
      name: "Incident receiver",
      workspaceId: "workspace-1",
      workspaceName: "Support",
      version: 3,
    },
    {
      id: "webhook-2",
      name: "Build receiver",
      workspaceId: "workspace-2",
      workspaceName: "Engineering",
      version: 7,
    },
  ]);
  mocks.rotate.mockReset().mockResolvedValue({
    rotatedAt: "2026-10-26T00:00:00.000Z",
    rotatedCount: 2,
  });
  mocks.stepUpRun
    .mockReset()
    .mockImplementation(
      async (
        _binding: unknown,
        execute: (token: string) => Promise<unknown>,
      ) => ({ ok: true, value: await execute("single-use-token") }),
    );
});
afterEach(cleanup);

function renderPanel() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WebhookSecurityPosturePanel />
    </QueryClientProvider>,
  );
}

describe("WebhookSecurityPosturePanel", () => {
  it("shows current owner reach and safe webhook metadata without a destination or secret", async () => {
    renderPanel();
    expect(await screen.findByText("Incident receiver")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    expect(screen.getByText("A. Agent")).toBeInTheDocument();
    expect(screen.getByText("seesAll")).toBeInTheDocument();
    expect(
      screen.getByText("work_item.updated, sla.breached"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-10-25T12:00:00.000Z")).toBeInTheDocument();
    expect(screen.queryByText(/https?:/u)).not.toBeInTheDocument();
    expect(
      screen.queryByText("replacement-secret-value"),
    ).not.toBeInTheDocument();
  });

  it("loads the next bounded page using the opaque cursor", async () => {
    mocks.list.mockResolvedValueOnce(page).mockResolvedValueOnce({
      data: [],
      page: { nextCursor: null, hasMore: false },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "loadMore" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.list.mock.calls[1]?.[0]).toEqual({
      limit: 50,
      cursor: "webhook-1",
    });
  });

  it("binds step-up to a digest and sends distinct replacements only with the rotate request", async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "rotateAllAction" }),
    );
    const replacementInputs = await screen.findAllByLabelText(
      "rotateAllSecretLabel",
    );
    expect(replacementInputs).toHaveLength(2);
    const secrets = [
      "first-replacement-secret-00000001",
      "second-replacement-secret-00000002",
    ];
    replacementInputs.forEach((input, index) => {
      fireEvent.change(input, { target: { value: secrets[index] } });
    });

    fireEvent.click(screen.getByRole("button", { name: "rotateAllSubmit" }));
    await waitFor(() => expect(mocks.rotate).toHaveBeenCalledTimes(1));

    const binding = mocks.stepUpRun.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(binding).toMatchObject({ operation: "webhook_rotate_all" });
    expect(binding.replacementSetDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(binding)).not.toContain(secrets[0]);
    expect(JSON.stringify(binding)).not.toContain(secrets[1]);
    expect(mocks.rotate).toHaveBeenCalledWith(
      [
        { webhookId: "webhook-1", expectedVersion: 3, secret: secrets[0] },
        { webhookId: "webhook-2", expectedVersion: 7, secret: secrets[1] },
      ],
      "single-use-token",
    );
    expect(await screen.findByText("rotateAllSuccess")).toBeInTheDocument();
  });
});
