import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganisationCustomerVisibility } from "@/fetchers/god-mode/organisation-customer-visibility";
import { HttpError } from "@/lib/http-error";
import { chooseOption, renderWithQuery } from "@/test/identity-test-harness";
import { OrganisationCustomerVisibilityCard } from "./organisation-customer-visibility-card";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  patch: vi.fn(),
}));

vi.mock(
  "@/fetchers/god-mode/organisation-customer-visibility",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/fetchers/god-mode/organisation-customer-visibility")
    >()),
    getOrganisationCustomerVisibility: (...args: unknown[]) =>
      mocks.read(...args),
    patchOrganisationCustomerVisibility: (...args: unknown[]) =>
      mocks.patch(...args),
  }),
);
vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(`${namespace}:${key}`, options),
    }),
  };
});

const initial: OrganisationCustomerVisibility = {
  organisationId: "org-1",
  defaultCustomerVisibility: "organisation",
  updatedAt: "2026-10-25T10:00:00.000Z",
};

beforeEach(() => {
  mocks.read.mockResolvedValue(initial);
  mocks.patch.mockResolvedValue({
    ...initial,
    defaultCustomerVisibility: "private",
    updatedAt: "2026-10-25T10:00:00.001Z",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrganisationCustomerVisibilityCard (CP-16)", () => {
  it("loads the persisted default and starts with save disabled", async () => {
    renderWithQuery(
      <OrganisationCustomerVisibilityCard organisationId="org-1" />,
    );

    expect(
      await screen.findByRole("combobox", {
        name: "Default visibility for new requests",
      }),
    ).toHaveTextContent("Permitted colleagues in this organisation");
    expect(
      screen.getByRole("button", { name: "Save visibility" }),
    ).toBeDisabled();
    expect(mocks.read).toHaveBeenCalledWith("org-1");
  });

  it("saves a changed value with the loaded version and reports success", async () => {
    renderWithQuery(
      <OrganisationCustomerVisibilityCard organisationId="org-1" />,
    );
    const select = await screen.findByRole("combobox", {
      name: "Default visibility for new requests",
    });
    await chooseOption(select, "Requester and explicitly added participants");
    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
    expect(mocks.patch.mock.calls[0]?.[0]).toEqual({
      organisationId: "org-1",
      expectedUpdatedAt: initial.updatedAt,
      defaultCustomerVisibility: "private",
    });
    expect(await screen.findByText("Visibility saved.")).toBeInTheDocument();
  });

  it("offers an explicit reload after an optimistic concurrency conflict", async () => {
    mocks.patch.mockRejectedValue(new HttpError(409, "version_conflict"));
    renderWithQuery(
      <OrganisationCustomerVisibilityCard organisationId="org-1" />,
    );
    const select = await screen.findByRole("combobox", {
      name: "Default visibility for new requests",
    });
    await chooseOption(select, "Requester and explicitly added participants");
    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));

    expect(
      await screen.findByText(
        "This setting changed elsewhere. Reload the page and try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reload setting" }),
    ).toBeInTheDocument();
  });
});
