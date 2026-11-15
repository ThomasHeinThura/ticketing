import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LegalHoldListResponse } from "@/fetchers/god-mode/legal-holds";

const mocks = vi.hoisted(() => ({
  getLegalHolds: vi.fn(),
  placeLegalHold: vi.fn(),
  liftLegalHold: vi.fn(),
  getOrganisations: vi.fn(),
  getInstanceUsers: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count !== undefined
        ? `${key}:${String(options.count)}`
        : options?.target !== undefined
          ? `${key}:${String(options.target)}`
          : key,
  }),
}));

vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => value,
}));

vi.mock("@/fetchers/god-mode/legal-holds", () => ({
  getLegalHolds: (query: unknown) => mocks.getLegalHolds(query),
  placeLegalHold: (input: unknown) => mocks.placeLegalHold(input),
  liftLegalHold: (input: unknown) => mocks.liftLegalHold(input),
}));

vi.mock("@/fetchers/god-mode/organisations", () => ({
  getOrganisations: () => mocks.getOrganisations(),
}));

vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getInstanceUsers: (query: unknown) => mocks.getInstanceUsers(query),
}));

import { LegalHoldsPanel } from "./legal-holds-panel";

function sampleResponse(): LegalHoldListResponse {
  return {
    checkedAt: "2026-11-15T10:00:00.000Z",
    activeCount: 1,
    holds: [
      {
        id: "hold-active-1",
        scope: "organisation",
        scopeId: "org-acme",
        status: "active",
        targetLabel: "Acme Holdings",
        targetSecondaryLabel: "acme",
        reason: "Regulatory preservation notice #101",
        placedAt: "2026-11-15T09:00:00.000Z",
        placedBy: {
          id: "admin-1",
          name: "Ada Admin",
          email: "ada@example.test",
        },
        liftedAt: null,
        liftedBy: null,
      },
      {
        id: "hold-lifted-1",
        scope: "person",
        scopeId: "person-jane",
        status: "lifted",
        targetLabel: "Jane Subject",
        targetSecondaryLabel: "jane@example.test",
        reason: "Closed inquiry",
        placedAt: "2026-11-10T09:00:00.000Z",
        placedBy: {
          id: "admin-1",
          name: "Ada Admin",
          email: "ada@example.test",
        },
        liftedAt: "2026-11-14T12:00:00.000Z",
        liftedBy: {
          id: "admin-1",
          name: "Ada Admin",
          email: "ada@example.test",
        },
      },
    ],
  };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LegalHoldsPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getLegalHolds.mockReset().mockResolvedValue(sampleResponse());
  mocks.placeLegalHold.mockReset().mockResolvedValue({
    id: "hold-new",
    scope: "organisation",
    scopeId: "org-beta",
    status: "active",
    targetLabel: "Beta Corp",
    targetSecondaryLabel: "beta",
    reason: "Litigation preservation",
    placedAt: "2026-11-15T11:00:00.000Z",
    placedBy: { id: "admin-1", name: "Ada Admin", email: "ada@example.test" },
    liftedAt: null,
    liftedBy: null,
  });
  mocks.liftLegalHold.mockReset().mockResolvedValue({
    id: "hold-active-1",
    scope: "organisation",
    scopeId: "org-acme",
    status: "lifted",
    targetLabel: "Acme Holdings",
    targetSecondaryLabel: "acme",
    reason: "Regulatory preservation notice #101",
    placedAt: "2026-11-15T09:00:00.000Z",
    placedBy: { id: "admin-1", name: "Ada Admin", email: "ada@example.test" },
    liftedAt: "2026-11-15T12:00:00.000Z",
    liftedBy: { id: "admin-1", name: "Ada Admin", email: "ada@example.test" },
  });
  mocks.getOrganisations.mockReset().mockResolvedValue({
    data: [],
    options: [],
    projectDefaultOptions: [],
  });
  mocks.getInstanceUsers.mockReset().mockResolvedValue({
    data: [],
    page: { nextCursor: null },
  });
});

afterEach(cleanup);

describe("LegalHoldsPanel", () => {
  it("recovers from a failed register query with retry", async () => {
    mocks.getLegalHolds.mockRejectedValueOnce(
      new Error("Register unavailable"),
    );
    renderPanel();
    expect(
      await screen.findByText("legalHolds.loadErrorTitle"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    expect(await screen.findByText("Acme Holdings")).toBeInTheDocument();
  });

  it("rejects whitespace-only form values and keeps failed placement available for retry", async () => {
    mocks.placeLegalHold.mockRejectedValueOnce(
      new Error("Placement unavailable"),
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "legalHolds.placeAction" }),
    );
    const submit = await screen.findByRole("button", {
      name: "legalHolds.place.submit",
    });
    fireEvent.change(
      screen.getByLabelText("legalHolds.place.organisationIdLabel"),
      { target: { value: "   " } },
    );
    fireEvent.change(screen.getByLabelText("legalHolds.place.reasonLabel"), {
      target: { value: "   " },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("legalHolds.place.organisationIdLabel"),
      { target: { value: " org-beta " } },
    );
    fireEvent.change(screen.getByLabelText("legalHolds.place.reasonLabel"), {
      target: { value: " Preserve " },
    });
    fireEvent.click(submit);
    expect(
      await screen.findByText("legalHolds.place.errorTitle"),
    ).toBeInTheDocument();
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.placeLegalHold).toHaveBeenCalledTimes(2));
    expect(mocks.placeLegalHold).toHaveBeenLastCalledWith({
      scope: "organisation",
      scopeId: "org-beta",
      reason: "Preserve",
    });
  });

  it("renders active hold count, active and lifted holds, and lifts only active holds", async () => {
    renderPanel();

    expect(await screen.findByText("Acme Holdings")).toBeInTheDocument();
    expect(screen.getByText("legalHolds.activeBadge:1")).toBeInTheDocument();
    expect(screen.getByText("Jane Subject")).toBeInTheDocument();
    expect(
      screen.getByText("Regulatory preservation notice #101"),
    ).toBeInTheDocument();

    const liftButtons = screen.getAllByRole("button", {
      name: "legalHolds.liftAction",
    });
    expect(liftButtons).toHaveLength(1);
    const [liftButton] = liftButtons;
    if (!liftButton) throw new Error("Expected active lift button");

    fireEvent.click(liftButton);
    expect(
      await screen.findByText("legalHolds.lift.description:Acme Holdings"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("legalHolds.lift.reasonLabel"), {
      target: { value: "Matter resolved" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "legalHolds.lift.submit" }),
    );

    await waitFor(() => {
      expect(mocks.liftLegalHold).toHaveBeenCalledWith({
        id: "hold-active-1",
        reason: "Matter resolved",
      });
    });
  });

  it("opens Place legal hold dialog and submits trimmed scopeId and reason", async () => {
    renderPanel();
    expect(await screen.findByText("Acme Holdings")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "legalHolds.placeAction" }),
    );

    const submitButton = await screen.findByRole("button", {
      name: "legalHolds.place.submit",
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(
      screen.getByLabelText("legalHolds.place.organisationIdLabel"),
      { target: { value: "  org-beta  " } },
    );
    fireEvent.change(screen.getByLabelText("legalHolds.place.reasonLabel"), {
      target: { value: "  Litigation preservation  " },
    });

    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mocks.placeLegalHold).toHaveBeenCalledWith({
        scope: "organisation",
        scopeId: "org-beta",
        reason: "Litigation preservation",
      });
    });
  });
});
