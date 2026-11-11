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
  presign: vi.fn(),
  complete: vi.fn(),
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
  presignPortalSubmissionAttachment: mocks.presign,
  completePortalSubmissionAttachment: mocks.complete,
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
    mocks.presign.mockReset();
    mocks.complete.mockReset();
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

    // An open form hides the list's filter; `q` can still change through the URL.
    expect(screen.queryByLabelText("Search")).toBeNull();
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

  it("replaces the form once the request exists, so a failed file upload cannot send it twice", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "evidence", label: "Evidence", type: "file" },
        ],
      },
    });
    localStorage.setItem(
      "taskdesk:intake-draft:customer-a:access:3",
      JSON.stringify({ title: "Laptop access" }),
    );
    mocks.submit.mockResolvedValue({ ref: "SUB-7", state: "accepted" });
    mocks.presign.mockRejectedValue(new Error("upload refused"));
    renderCatalogue();
    const summary = await screen.findByRole("textbox", { name: "Summary" });
    fireEvent.change(screen.getByLabelText("Evidence"), {
      target: {
        files: [
          new File(["%PDF-1.4"], "screen.pdf", { type: "application/pdf" }),
        ],
      },
    });
    expect(screen.getByText("screen.pdf")).toBeVisible();
    const requestForm = summary.closest("form");
    if (!requestForm) throw new Error("The request form is missing");
    fireEvent.submit(requestForm);

    expect(
      await screen.findByText("portal:intake.filesNotAttached"),
    ).toBeVisible();
    expect(screen.getByText("screen.pdf")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "portal:intake.openSentRequest" }),
    ).toBeVisible();
    // The form and its Submit button are gone: neither a click nor Enter can resend it.
    expect(
      screen.queryByRole("button", { name: "portal:intake.submit" }),
    ).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Summary" })).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    fireEvent.submit(requestForm);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      localStorage.getItem("taskdesk:intake-draft:customer-a:access:3"),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "portal:intake.openSentRequest" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/submissions/$ref",
      params: { ref: "SUB-7" },
    });
  });

  it("requires a staged file for a required file field, focusing its Attach button, then submits", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          {
            key: "evidence",
            label: "Evidence",
            type: "file",
            required: true,
          },
        ],
      },
    });
    mocks.submit.mockResolvedValue({ ref: "SUB-8", state: "new" });
    mocks.presign.mockResolvedValue({
      attachmentId: "att-1",
      uploadUrl: "https://portal.example.test/upload",
      uploadHeaders: {},
    });
    mocks.complete.mockResolvedValue({});
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    renderCatalogue();
    const summary = await screen.findByRole("textbox", { name: "Summary" });
    fireEvent.change(summary, { target: { value: "Laptop access" } });
    const requestForm = summary.closest("form");
    if (!requestForm) throw new Error("The request form is missing");
    const attach = screen.getByRole("button", {
      name: "workItems:detail.attachments.add",
    });

    // No file staged: the request is not sent and focus goes to the visible Attach button.
    fireEvent.submit(requestForm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This field is required.",
    );
    expect(attach).toHaveFocus();
    expect(attach).toHaveAttribute("aria-invalid", "true");
    expect(attach).toHaveAttribute(
      "aria-describedby",
      "request-field-error-evidence",
    );
    expect(mocks.submit).not.toHaveBeenCalled();

    // A staged file answers the field: its error clears and the request is sent with the file.
    fireEvent.change(screen.getByLabelText("Evidence"), {
      target: {
        files: [
          new File(["%PDF-1.4"], "screen.pdf", { type: "application/pdf" }),
        ],
      },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(requestForm);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/submissions/$ref",
        params: { ref: "SUB-8" },
      }),
    );
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.presign).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "SUB-8", fieldKey: "evidence" }),
    );
    expect(mocks.complete).toHaveBeenCalledWith({ ref: "SUB-8", id: "att-1" });
    fetchMock.mockRestore();
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

  it("omits conditionally hidden answers and staged files on submit, and coerces number fields to numbers (D5, D10)", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "has_hardware", label: "Hardware issue?", type: "checkbox" },
          {
            key: "serial_number",
            label: "Serial number",
            type: "text",
            required: true,
            showIf: { field_key: "has_hardware", op: "eq", value: true },
          },
          {
            key: "hardware_photo",
            label: "Hardware photo",
            type: "file",
            showIf: { field_key: "has_hardware", op: "eq", value: true },
          },
          { key: "device_count", label: "Device count", type: "number" },
        ],
      },
    });
    mocks.submit.mockResolvedValue({ ref: "SUB-9", state: "new" });

    const storageKey = "taskdesk:intake-draft:customer-a:access:3";
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        title: "Laptop broken",
        has_hardware: false,
        serial_number: "HIDDEN-SERIAL-123",
        device_count: "42",
      }),
    );

    renderCatalogue();

    const summary = await screen.findByRole("textbox", { name: "Summary" });
    expect(summary).toHaveValue("Laptop broken");

    // serial_number is hidden because has_hardware is false
    expect(screen.queryByLabelText("Serial number")).toBeNull();

    const requestForm = summary.closest("form");
    if (!requestForm) throw new Error("The request form is missing");

    fireEvent.submit(requestForm);

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        key: "access",
        formData: {
          title: "Laptop broken",
          has_hardware: false,
          device_count: 42,
        },
        customerVisibility: "organisation",
      }),
    );
    expect(mocks.submit.mock.calls[0][0].formData).not.toHaveProperty(
      "serial_number",
    );
    expect(mocks.submit.mock.calls[0][0].formData.device_count).toBe(42);
    expect(typeof mocks.submit.mock.calls[0][0].formData.device_count).toBe(
      "number",
    );
    expect(mocks.presign).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("keeps unfinished numeric typing through blur and reload, then submits a number", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "amount", label: "Amount", type: "number", required: true },
        ],
      },
    });
    mocks.submit.mockResolvedValue({ ref: "SUB-10", state: "new" });
    const view = renderCatalogue();
    const amount = await screen.findByRole("textbox", { name: "Amount" });
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "Request" },
    });
    fireEvent.keyDown(amount, { key: "-" });
    fireEvent.change(amount, { target: { value: "-" } });
    fireEvent.blur(amount);
    expect(amount).toHaveValue("-");
    const invalidForm = amount.closest("form");
    if (!invalidForm) throw new Error("The request form is missing");
    fireEvent.submit(invalidForm);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(amount).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(amount, { key: "1" });
    fireEvent.change(amount, { target: { value: "1." } });
    fireEvent.blur(amount);
    expect(amount).toHaveValue("1.");
    await waitFor(() =>
      expect(
        localStorage.getItem("taskdesk:intake-draft:customer-a:access:3"),
      ).toContain('"amount":"1."'),
    );
    view.unmount();
    renderCatalogue();
    const restored = await screen.findByRole("textbox", { name: "Amount" });
    await waitFor(() => expect(restored).toHaveValue("1."));
    fireEvent.change(restored, { target: { value: "1.5" } });
    const requestForm = restored.closest("form");
    if (!requestForm) throw new Error("The request form is missing");
    fireEvent.submit(requestForm);
    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        key: "access",
        formData: { title: "Request", amount: 1.5 },
        customerVisibility: "organisation",
      }),
    );
  });

  it("shows false-conditional fields before a checkbox is touched", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "gate", label: "Gate", type: "checkbox" },
          {
            key: "details",
            label: "Details",
            type: "text",
            showIf: { field_key: "gate", op: "eq", value: false },
          },
        ],
      },
    });
    renderCatalogue();
    expect(
      await screen.findByRole("textbox", { name: "Details" }),
    ).toBeVisible();
  });

  it("normalises legacy numeric draft answers on load and preserves required conditional answers (D5, Finding 3)", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "seat_count", label: "Seat count", type: "number" },
          {
            key: "volume_license",
            label: "Volume license key",
            type: "text",
            required: true,
            showIf: { field_key: "seat_count", op: "eq", value: 50 },
          },
        ],
      },
    });
    mocks.submit.mockResolvedValue({ ref: "SUB-10", state: "new" });

    const storageKey = "taskdesk:intake-draft:customer-a:access:3";
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        title: "Enterprise order",
        seat_count: "50",
        volume_license: "VOL-50-ABC",
      }),
    );

    renderCatalogue();

    // The conditional field is visible because seat_count "50" is normalized to 50
    const licenseInput = await screen.findByRole("textbox", {
      name: "Volume license key",
    });
    expect(licenseInput).toBeVisible();
    expect(licenseInput).toHaveValue("VOL-50-ABC");

    const summary = screen.getByRole("textbox", { name: "Summary" });
    const requestForm = summary.closest("form");
    if (!requestForm) throw new Error("The request form is missing");

    fireEvent.submit(requestForm);

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        key: "access",
        formData: {
          title: "Enterprise order",
          seat_count: 50,
          volume_license: "VOL-50-ABC",
        },
        customerVisibility: "organisation",
      }),
    );
    expect(typeof mocks.submit.mock.calls[0][0].formData.seat_count).toBe(
      "number",
    );
  });

  it("preserves accepted __proto__ answer key in submitted client accumulator (Finding 4)", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "__proto__", label: "Proto payload", type: "text" },
        ],
      },
    });
    mocks.submit.mockResolvedValue({ ref: "SUB-11", state: "new" });

    const storageKey = "taskdesk:intake-draft:customer-a:access:3";
    const draft = { title: "Proto test" };
    Object.defineProperty(draft, "__proto__", {
      value: "proto-secret-123",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    localStorage.setItem(storageKey, JSON.stringify(draft));

    renderCatalogue();

    const summary = await screen.findByRole("textbox", { name: "Summary" });
    const requestForm = summary.closest("form");
    if (!requestForm) throw new Error("The request form is missing");

    fireEvent.submit(requestForm);

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const submittedData = mocks.submit.mock.calls[0][0].formData;
    expect(Object.hasOwn(submittedData, "__proto__")).toBe(true);
    expect(Reflect.get(submittedData, "__proto__")).toBe("proto-secret-123");
    expect(Object.keys(submittedData)).toContain("__proto__");
  });

  it("preserves condition-driving blank values in client payload and enables conditional file presign when controller is empty", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "controller", label: "Controller text", type: "text" },
          {
            key: "evidence",
            label: "Evidence",
            type: "file",
            showIf: { field_key: "controller", op: "eq", value: "" },
          },
          { key: "unrelated_notes", label: "Unrelated notes", type: "text" },
        ],
      },
    });
    mocks.submit.mockResolvedValue({ ref: "SUB-12", state: "new" });
    mocks.presign.mockResolvedValue({
      attachmentId: "att-12",
      uploadUrl: "https://portal.example.test/upload",
      uploadHeaders: {},
    });
    mocks.complete.mockResolvedValue({});
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    renderCatalogue();

    const summary = await screen.findByRole("textbox", { name: "Summary" });
    fireEvent.change(summary, { target: { value: "Controller empty test" } });

    // Controller is empty, so Evidence file field is visible
    const fileInput = screen.getByLabelText("Evidence");
    expect(fileInput).toBeInTheDocument();

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["%PDF-1.4"], "evidence.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    expect(screen.getByText("evidence.pdf")).toBeVisible();

    const requestForm = summary.closest("form");
    if (!requestForm) throw new Error("The request form is missing");

    fireEvent.submit(requestForm);

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        key: "access",
        formData: {
          title: "Controller empty test",
          controller: "",
        },
        customerVisibility: "organisation",
      }),
    );
    // Unrelated blank text field is stripped
    expect(mocks.submit.mock.calls[0][0].formData).not.toHaveProperty(
      "unrelated_notes",
    );
    // Presign is called for the conditional file field
    expect(mocks.presign).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "SUB-12", fieldKey: "evidence" }),
    );
    expect(mocks.complete).toHaveBeenCalledWith({
      ref: "SUB-12",
      id: "att-12",
    });
    fetchMock.mockRestore();
  });

  it("negative regression: hides conditional file field and skips presign when eq-empty controller is non-empty", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "controller", label: "Controller text", type: "text" },
          {
            key: "evidence",
            label: "Evidence",
            type: "file",
            showIf: { field_key: "controller", op: "eq", value: "" },
          },
        ],
      },
    });
    mocks.submit.mockResolvedValue({ ref: "SUB-13", state: "new" });

    renderCatalogue();

    const summary = await screen.findByRole("textbox", { name: "Summary" });
    fireEvent.change(summary, {
      target: { value: "Controller non-empty test" },
    });

    const controllerInput = screen.getByRole("textbox", {
      name: "Controller text",
    });
    fireEvent.change(controllerInput, { target: { value: "filled-value" } });

    // Conditional file field is hidden
    expect(screen.queryByLabelText("Evidence")).toBeNull();

    const requestForm = summary.closest("form");
    if (!requestForm) throw new Error("The request form is missing");

    fireEvent.submit(requestForm);

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        key: "access",
        formData: {
          title: "Controller non-empty test",
          controller: "filled-value",
        },
        customerVisibility: "organisation",
      }),
    );
    expect(mocks.presign).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("reload and persisted draft: restores visibility and answers for eq-empty conditional fields", async () => {
    mocks.getRequestType.mockResolvedValue({
      ...form,
      formSchema: {
        fields: [
          { key: "title", label: "Summary", type: "text", required: true },
          { key: "controller", label: "Controller text", type: "text" },
          {
            key: "dependent_note",
            label: "Dependent note",
            type: "text",
            showIf: { field_key: "controller", op: "eq", value: "" },
          },
        ],
      },
    });
    mocks.submit.mockResolvedValue({ ref: "SUB-14", state: "new" });

    const storageKey = "taskdesk:intake-draft:customer-a:access:3";
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        title: "Persisted draft test",
        controller: "",
        dependent_note: "Persisted conditional note",
      }),
    );

    renderCatalogue();

    const noteInput = await screen.findByRole("textbox", {
      name: "Dependent note",
    });
    expect(noteInput).toBeVisible();
    expect(noteInput).toHaveValue("Persisted conditional note");

    const summary = screen.getByRole("textbox", { name: "Summary" });
    const requestForm = summary.closest("form");
    if (!requestForm) throw new Error("The request form is missing");

    fireEvent.submit(requestForm);

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        key: "access",
        formData: {
          title: "Persisted draft test",
          controller: "",
          dependent_note: "Persisted conditional note",
        },
        customerVisibility: "organisation",
      }),
    );
  });
});
