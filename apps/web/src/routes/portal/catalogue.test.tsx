import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { Route } from "./catalogue";

const mocks = vi.hoisted(() => ({
  search: { q: "access", key: "access" } as { q?: string; key?: string },
  navigate: vi.fn(),
  getCatalogue: vi.fn(),
  getRequestType: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => mocks.search,
    useRouteContext: () => ({ portalUserId: "customer-a" }),
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/fetchers/intake", () => ({
  getPortalCatalogue: mocks.getCatalogue,
  getPortalRequestType: mocks.getRequestType,
  submitPortalRequest: mocks.submit,
}));

vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    i18n: {
      language: "en-US",
      resolvedLanguage: "en-US",
      t: (_key: string, options?: { count?: number }) =>
        translate(
          `term:customer.request_${options?.count === 1 ? "one" : "other"}`,
        ),
    },
    t: (
      _key: string,
      options?: { defaultValue?: string; [key: string]: unknown },
    ) =>
      (options?.defaultValue ?? _key).replace(
        /\{\{(\w+)\}\}/gu,
        (_match, name: string) => String(options?.[name] ?? `{{${name}}}`),
      ),
  }),
}));

const PortalCatalogue = (Route as unknown as { component: ComponentType })
  .component;

const catalogue = {
  defaultCustomerVisibility: "organisation" as const,
  requestTypes: [
    {
      key: "access",
      name: "Access request",
      description: "Request access to a support workspace.",
      icon: null,
      group: "Access",
      position: 0,
      forcePrivate: false,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
        ],
      },
      version: 3,
    },
  ],
};
const emptyCatalogue = {
  defaultCustomerVisibility: "organisation" as const,
  requestTypes: [],
};

const form = {
  key: "access",
  name: "Access request",
  description: "Request access to a support workspace.",
  formSchema: {
    fields: [{ key: "title", label: "Summary", type: "text", required: true }],
  },
  version: 3,
};

function renderCatalogue() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <PortalCatalogue />
      </QueryClientProvider>,
    ),
  };
}

describe("portal catalogue route", () => {
  beforeEach(() => {
    mocks.search = { q: "access", key: "access" };
    mocks.navigate.mockReset();
    mocks.getCatalogue.mockReset().mockResolvedValue(catalogue);
    mocks.getRequestType.mockReset().mockResolvedValue(form);
    mocks.submit.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the visibility label, not the raw value, in the trigger", async () => {
    renderCatalogue();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Access request" }),
      ).toBeVisible(),
    );
    const trigger = screen.getByRole("combobox", {
      name: /Who can see this request/u,
    });
    expect(trigger).toHaveTextContent("People in my organisation");
    expect(trigger).not.toHaveTextContent(/^organisation$/u);
  });

  it("uses a calendar, preserves a date-only draft on reload and submits its exact selected day", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "needed", label: "Needed by", type: "date", required: true },
        ],
      },
    });
    const storageKey = "taskdesk:intake-draft:customer-a:access:3";
    localStorage.setItem(
      storageKey,
      JSON.stringify({ title: "Dated request", needed: "2028-02-29" }),
    );
    mocks.submit.mockResolvedValue({ reference: "REQUEST-1" });
    const view = renderCatalogue();
    const trigger = await screen.findByRole("button", { name: "Needed by *" });
    expect(view.container.querySelector('input[type="date"]')).toBeNull();
    expect(trigger).toHaveTextContent("Feb 29, 2028");
    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole("button", { name: /February 28th, 2028/u }),
    );
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).toEqual({
        title: "Dated request",
        needed: "2028-02-28",
      }),
    );
    view.unmount();
    renderCatalogue();
    expect(
      await screen.findByRole("button", { name: "Needed by *" }),
    ).toHaveTextContent("Feb 28, 2028");
    const reloadedForm = screen
      .getByRole("textbox", { name: "Summary" })
      .closest("form");
    if (!reloadedForm) throw new Error("The request form is missing");
    fireEvent.submit(reloadedForm);
    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
        key: "access",
        formData: { title: "Dated request", needed: "2028-02-28" },
        customerVisibility: "organisation",
      }),
    );
  });

  it("focuses and describes a missing required date and clears its error after selection", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "needed", label: "Needed by", type: "date", required: true },
        ],
      },
    });
    renderCatalogue();
    const trigger = await screen.findByRole("button", { name: "Needed by *" });
    const requestForm = trigger.closest("form");
    if (!requestForm) throw new Error("The request form is missing");
    fireEvent.submit(requestForm);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAccessibleDescription("This field is required.");
    fireEvent.click(trigger);
    const today = new Date();
    const selected = new Date(today.getFullYear(), today.getMonth(), 15);
    const dayName = new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(selected);
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(dayName.replace("15,", "15th,")),
      }),
    );
    expect(trigger).toHaveAttribute("aria-invalid", "false");
    expect(trigger).toHaveAccessibleDescription("This field is required.");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "common:clearDate" }));
    fireEvent.submit(requestForm);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(trigger).toHaveAccessibleDescription("This field is required.");
  });

  it("keeps the selected form and saved draft when q no longer matches the type", async () => {
    mocks.getCatalogue.mockImplementation(async (query?: string) =>
      query === "does-not-match" ? emptyCatalogue : catalogue,
    );
    localStorage.setItem(
      "taskdesk:intake-draft:customer-a:access:3",
      JSON.stringify({ title: "Draft answer" }),
    );
    const view = renderCatalogue();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Access request" }),
      ).toBeVisible(),
    );
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue(
      "Draft answer",
    );

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "does-not-match" },
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      search: { q: "does-not-match", key: "access" },
    });
    mocks.search = { q: "does-not-match", key: "access" };
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <PortalCatalogue />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Access request" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue(
      "Draft answer",
    );
    expect(mocks.getCatalogue).toHaveBeenCalledWith("access");
    expect(mocks.getCatalogue).toHaveBeenCalledWith("does-not-match");
    expect(mocks.getCatalogue.mock.calls).toContainEqual([]);
    expect(mocks.getRequestType).toHaveBeenCalledWith("access");
  });

  it("shows a retryable catalogue error without presenting the empty state", async () => {
    mocks.search = { q: "", key: "access" };
    mocks.getCatalogue
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(catalogue);
    renderCatalogue();

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(
      screen.queryByText(
        "No request types are available for your organisation.",
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.getCatalogue).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", { name: "Access request" }),
    ).toBeVisible();
  });

  it("keeps metadata lookup distinct from a catalogue search with the same text", async () => {
    mocks.search = { q: "selection-metadata", key: "access" };
    mocks.getCatalogue.mockImplementation(async (query?: string) =>
      query === "selection-metadata" ? emptyCatalogue : catalogue,
    );
    renderCatalogue();

    expect(
      await screen.findByRole("heading", { name: "Access request" }),
    ).toBeVisible();
    expect(mocks.getCatalogue).toHaveBeenCalledWith("selection-metadata");
    expect(mocks.getCatalogue.mock.calls).toContainEqual([]);
    expect(mocks.getRequestType).toHaveBeenCalledWith("access");
  });

  it("clears a metadata-only error when the selected type returns to q results", async () => {
    mocks.search = { q: "does-not-match", key: "access" };
    mocks.getCatalogue.mockImplementation(async (query?: string) => {
      if (query === "does-not-match") return emptyCatalogue;
      if (query === "access") return catalogue;
      throw new Error("metadata temporarily unavailable");
    });
    const view = renderCatalogue();

    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
    mocks.search = { q: "access", key: "access" };
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <PortalCatalogue />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Access request" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells a no-match search apart from an organisation with no request types", async () => {
    mocks.search = { q: "zzz", key: undefined };
    mocks.getCatalogue.mockResolvedValue(emptyCatalogue);
    const view = renderCatalogue();
    expect(
      await screen.findByText("No request types match your search."),
    ).toBeVisible();
    expect(
      screen.queryByText(
        "No request types are available for your organisation.",
      ),
    ).not.toBeInTheDocument();

    mocks.search = { q: "", key: undefined };
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <PortalCatalogue />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(
        "No request types are available for your organisation.",
      ),
    ).toBeVisible();
  });

  it("moves focus to the form heading when a card is opened", async () => {
    mocks.search = { q: "", key: undefined };
    const view = renderCatalogue();
    const card = await screen.findByRole("button", { name: /Access request/u });
    card.focus();
    fireEvent.click(card);
    mocks.search = { q: "", key: "access" };
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <PortalCatalogue />
      </QueryClientProvider>,
    );
    const heading = await screen.findByRole("heading", {
      name: "Access request",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
