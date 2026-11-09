import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { Route } from "./request-types";

const mocks = vi.hoisted(() => ({
  search: { requestTypeId: "rt-1" } as { requestTypeId?: string },
  navigate: vi.fn(),
  getRequestTypes: vi.fn(),
  getRequestType: vi.fn(),
  saveRequestType: vi.fn(),
  unpublishRequestType: vi.fn(),
  getRequestTypeGroupOrder: vi.fn(),
  replaceRequestTypeGroupOrder: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    fullPath: "/dashboard/settings/workspace/request-types",
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/fetchers/intake", () => ({
  getRequestType: mocks.getRequestType,
  getRequestTypes: mocks.getRequestTypes,
  publishRequestType: vi.fn(),
  saveRequestType: mocks.saveRequestType,
  unpublishRequestType: mocks.unpublishRequestType,
}));
vi.mock("@/fetchers/intake-group-order", () => ({
  getRequestTypeGroupOrder: mocks.getRequestTypeGroupOrder,
  replaceRequestTypeGroupOrder: mocks.replaceRequestTypeGroupOrder,
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => ({ data: [{ id: "wit-1", name: "Task" }], isLoading: false }),
}));
vi.mock("@/hooks/queries/custom-field/use-custom-fields", () => ({
  useCustomFields: () => ({ data: { data: [] } }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [
      { id: "p-1", name: "Help desk" },
      { id: "p-2", name: "Website" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" }, isLoading: false }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => String(options?.[name] ?? `{{${name}}}`),
      ),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const RequestTypesPage = (Route as unknown as { component: ComponentType })
  .component;

const type = {
  id: "rt-1",
  key: "access",
  name: "Access",
  description: "",
  group: "General",
  workItemTypeId: "wit-1",
  defaultProjectId: null as string | null,
  formSchema: {
    fields: [
      {
        key: "title",
        label: "Summary",
        type: "text",
        required: true,
        mapsTo: { field: "title" },
      },
      { key: "urgency", label: "Urgency", type: "select", required: false },
      { key: "evidence", label: "Evidence", type: "file", required: false },
    ],
  },
  published: false,
  version: 1,
  autoAccept: false,
  customerVisible: false,
  forcePrivate: false,
  position: 0,
  updatedAt: "2026-11-01T10:00:00.000Z",
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RequestTypesPage />
    </QueryClientProvider>,
  );
}

describe("request type editor", () => {
  beforeEach(() => {
    mocks.search = { requestTypeId: "rt-1" };
    mocks.navigate.mockReset();
    mocks.getRequestTypes.mockReset().mockResolvedValue({
      requestTypes: [type],
    });
    mocks.getRequestType.mockReset().mockResolvedValue(type);
    mocks.saveRequestType
      .mockReset()
      .mockImplementation(async () => ({ ...type, id: "rt-1" }));
    mocks.unpublishRequestType.mockReset().mockResolvedValue(undefined);
    mocks.getRequestTypeGroupOrder.mockReset().mockResolvedValue({
      groups: ["Accounts", "Support"],
      version: 3,
    });
    mocks.replaceRequestTypeGroupOrder
      .mockReset()
      .mockImplementation(
        async ({ groups, version }: { groups: string[]; version: number }) => ({
          groups,
          version: version + 1,
        }),
      );
  });
  afterEach(() => cleanup());

  it("keeps the same field row mounted while its key is edited", async () => {
    renderPage();
    const keyInput = (await screen.findAllByLabelText("Field key"))[1];
    expect(keyInput).toBeDefined();
    for (const value of ["u", "ur", "urg"]) {
      fireEvent.change(keyInput as HTMLElement, { target: { value } });
      const current = screen.getAllByLabelText("Field key")[1];
      // A re-keyed row would replace the node (losing focus and the typed value).
      expect(current).toBe(keyInput);
      expect(current).toHaveValue(value);
    }
  });

  it("keeps typed line breaks in the options textarea and tidies them on blur", async () => {
    renderPage();
    const options = (
      await screen.findAllByLabelText("Options (one per line)")
    )[1] as HTMLTextAreaElement;
    fireEvent.change(options, { target: { value: "low\n" } });
    expect(options).toHaveValue("low\n");
    fireEvent.change(options, { target: { value: "low\n\nhigh\n" } });
    expect(options).toHaveValue("low\n\nhigh\n");
    fireEvent.blur(options);
    expect(options).toHaveValue("low\nhigh");
  });

  it("names every control in the customer preview", async () => {
    renderPage();
    await screen.findAllByLabelText("Field key");
    const preview = screen.getByText("Customer preview").closest("section");
    expect(preview).not.toBeNull();
    for (const el of Array.from(
      (preview as HTMLElement).querySelectorAll("input:not([aria-hidden])"),
    )) {
      expect(
        el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby"),
      ).toBeTruthy();
    }
    expect(
      (preview as HTMLElement).querySelector('input[type="file"]'),
    ).toHaveAttribute("aria-label", "Evidence");
  });

  it("offers Retry on a load error and recovers", async () => {
    // The editor Sheet is modal; the list-level Retry is only reachable with it closed.
    mocks.search = {};
    mocks.getRequestTypes
      .mockReset()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue({ requestTypes: [type] });
    renderPage();
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getRequestTypes).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Access" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("saves group order independently with its expected version", async () => {
    // The editor Sheet is modal; the group order controls live on the list behind it.
    mocks.search = {};
    renderPage();
    const moveSupportUp = await screen.findByRole("button", {
      name: "Move Support up",
    });
    fireEvent.click(moveSupportUp);
    fireEvent.click(screen.getByRole("button", { name: "Save group order" }));

    await waitFor(() =>
      expect(mocks.replaceRequestTypeGroupOrder).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        groups: ["Support", "Accounts"],
        version: 3,
      }),
    );
    expect(await screen.findByText("Group order saved.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Move Support down" }),
    ).toBeTruthy();
  });
});

describe("request type list", () => {
  beforeEach(() => {
    mocks.search = {};
    mocks.navigate.mockReset();
    mocks.getRequestTypes.mockReset().mockResolvedValue({
      requestTypes: [
        { ...type, group: "Support" },
        {
          ...type,
          id: "rt-2",
          key: "laptop",
          name: "Laptop",
          group: "Accounts",
          published: true,
          version: 2,
          customerVisible: true,
        },
      ],
    });
    mocks.getRequestType.mockReset().mockResolvedValue(type);
    mocks.saveRequestType
      .mockReset()
      .mockImplementation(async () => ({ ...type, id: "rt-9" }));
    mocks.getRequestTypeGroupOrder.mockReset().mockResolvedValue({
      groups: ["Accounts", "Support"],
      version: 3,
    });
    mocks.replaceRequestTypeGroupOrder.mockReset();
  });
  afterEach(() => cleanup());

  it("opens on the list, not on a create form", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Access" })).toBeTruthy();
    expect(screen.queryByLabelText("Field key")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("groups request types by catalogue group with a status badge", async () => {
    renderPage();
    const accounts = await screen.findByRole("region", { name: "Accounts" });
    const support = screen.getByRole("region", { name: "Support" });
    expect(within(accounts).getByText("Laptop")).toBeTruthy();
    expect(within(accounts).getByText("Published v2")).toBeTruthy();
    expect(within(accounts).getByText("Visible to customers")).toBeTruthy();
    expect(within(support).getByText("Access")).toBeTruthy();
    expect(within(support).getByText("Draft")).toBeTruthy();
    // Group order decides the order of the sections.
    expect(
      accounts.compareDocumentPosition(support) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides impossible group moves and shows Save and Cancel only while the order changed", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Move Support up" });
    expect(
      screen.queryByRole("button", { name: "Move Accounts up" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move Support down" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Save group order" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move Support up" }));
    expect(
      screen.getByRole("button", { name: "Save group order" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("button", { name: "Save group order" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Move Support up" }),
    ).toBeTruthy();
    expect(mocks.replaceRequestTypeGroupOrder).not.toHaveBeenCalled();
  });

  it("opens the editor for a new request type from the header button", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "new" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");
    expect(within(dialog).getAllByLabelText("Field key")).toHaveLength(1);
    expect(within(dialog).queryByLabelText(/Catalogue order/)).toBeNull();
  });

  it("opens an existing request type from its row", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Laptop" }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      search: { requestTypeId: "rt-2" },
    });
  });
});

describe("request type default project", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.getRequestTypes.mockReset().mockResolvedValue({
      requestTypes: [type],
    });
    mocks.getRequestTypeGroupOrder
      .mockReset()
      .mockResolvedValue({ groups: ["General"], version: 1 });
    mocks.saveRequestType
      .mockReset()
      .mockImplementation(async () => ({ ...type, id: "rt-1" }));
  });
  afterEach(() => cleanup());

  it("shows the default project by name and saves its id with the existing position", async () => {
    mocks.search = { requestTypeId: "rt-1" };
    mocks.getRequestType
      .mockReset()
      .mockResolvedValue({ ...type, defaultProjectId: "p-2", position: 4 });
    renderPage();
    const dialog = await screen.findByRole("dialog");
    const picker = await within(dialog).findByLabelText("Default project");
    await waitFor(() => expect(picker).toHaveTextContent("Website"));
    expect(within(dialog).queryByText("p-2")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mocks.saveRequestType).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "rt-1",
          data: expect.objectContaining({
            defaultProjectId: "p-2",
            position: 4,
          }),
        }),
      ),
    );
  });

  it("keeps a default project that is no longer listed", async () => {
    mocks.search = { requestTypeId: "rt-1" };
    mocks.getRequestType
      .mockReset()
      .mockResolvedValue({ ...type, defaultProjectId: "p-gone" });
    renderPage();
    const dialog = await screen.findByRole("dialog");
    const picker = await within(dialog).findByLabelText("Default project");
    await waitFor(() =>
      expect(picker).toHaveTextContent("Unavailable project"),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mocks.saveRequestType).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ defaultProjectId: "p-gone" }),
        }),
      ),
    );
  });
});
