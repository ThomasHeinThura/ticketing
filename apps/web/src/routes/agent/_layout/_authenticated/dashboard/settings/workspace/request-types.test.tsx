import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BUILT_IN_ROLES, type BuiltInRoleKey } from "@taskdesk/permissions";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./request-types";

const mocks = vi.hoisted(() => ({
  role: "admin" as string,
  checking: false,
  getWorkItemTypes: vi.fn(),
  search: { requestTypeId: "rt-1" } as { requestTypeId?: string },
  translations: {} as Record<string, string>,
  navigate: vi.fn(),
  getRequestTypes: vi.fn(),
  getRequestType: vi.fn(),
  getRequestTypeGroupOrder: vi.fn(),
  replaceRequestTypeGroupOrder: vi.fn(),
  saveRequestType: vi.fn(),
  publishRequestType: vi.fn(),
  unpublishRequestType: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
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
  publishRequestType: mocks.publishRequestType,
  saveRequestType: mocks.saveRequestType,
  unpublishRequestType: mocks.unpublishRequestType,
}));
vi.mock("@/fetchers/intake-group-order", () => ({
  getRequestTypeGroupOrder: mocks.getRequestTypeGroupOrder,
  replaceRequestTypeGroupOrder: mocks.replaceRequestTypeGroupOrder,
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: (...args: unknown[]) => {
    mocks.getWorkItemTypes(...args);
    return { data: [{ id: "wit-1", name: "Task" }], isLoading: false };
  },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" }, isLoading: false }),
}));
// `/api/capabilities` reports `manageRequestTypes` from the strict `request_type:manage`, so a
// role holds the flag exactly when its built-in capability list does.
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageRequestTypes: () =>
      (
        BUILT_IN_ROLES[mocks.role as BuiltInRoleKey].capabilities as string[]
      ).includes("request_type:manage"),
    isCheckingPermissions: mocks.checking,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      mocks.translations[key] ?? options?.defaultValue ?? key,
  }),
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
  defaultProjectId: null,
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
};

function renderPage(failed = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (failed) {
    const query = queryClient.getQueryCache().build(queryClient, {
      queryKey: ["workspace-capabilities", "workspace-1", "member"],
    });
    query.setState({
      status: "error",
      fetchStatus: "idle",
      error: new Error("failed"),
    });
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <RequestTypesPage />
    </QueryClientProvider>,
  );
}

describe("request type editor", () => {
  beforeEach(() => {
    mocks.role = "admin";
    mocks.checking = false;
    mocks.getWorkItemTypes.mockReset();
    mocks.search = { requestTypeId: "rt-1" };
    mocks.translations = {};
    mocks.getRequestTypes.mockReset().mockResolvedValue({
      requestTypes: [type],
    });
    mocks.getRequestType.mockReset().mockResolvedValue(type);
    mocks.saveRequestType.mockReset().mockResolvedValue(type);
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

  it.each(["denied", "checking"])(
    "does not fetch editor data while %s",
    (state) => {
      mocks.role = "viewer";
      mocks.checking = state === "checking";
      renderPage();
      expect(
        state === "denied"
          ? screen.getByTestId("settings-access-denied")
          : screen.getByRole("status", {
              name: "settings:accessDenied.checking",
            }),
      ).toBeTruthy();
      expect(mocks.getRequestTypes).not.toHaveBeenCalled();
      expect(mocks.getRequestType).not.toHaveBeenCalled();
      expect(mocks.getRequestTypeGroupOrder).not.toHaveBeenCalled();
      expect(mocks.getWorkItemTypes).not.toHaveBeenCalled();
    },
  );

  it("shows no access when the main read returns 403", async () => {
    mocks.getRequestTypes.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "states.noAccess.title",
      }),
    ).toHaveFocus();
  });

  it.each(["lead", "member", "viewer"])(
    "shows the no-access state to a %s and sends no request",
    (role) => {
      mocks.role = role;
      renderPage();
      expect(screen.getByTestId("settings-access-denied")).toBeTruthy();
      expect(screen.queryByLabelText("Field key")).toBeNull();
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "states.noAccess.title",
        }),
      ).toHaveFocus();
      expect(screen.queryByTestId("settings-access-error")).toBeNull();
      expect(mocks.getRequestTypes).not.toHaveBeenCalled();
      expect(mocks.getRequestType).not.toHaveBeenCalled();
      expect(mocks.getRequestTypeGroupOrder).not.toHaveBeenCalled();
      expect(mocks.getWorkItemTypes).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", "admin"])(
    "opens the authoring editor for the %s role",
    async (role) => {
      mocks.role = role;
      renderPage();
      expect(
        (await screen.findAllByLabelText("Field key")).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId("settings-access-denied")).toBeNull();
      expect(mocks.getRequestTypes).toHaveBeenCalledWith("workspace-1");
    },
  );

  it("fails closed when capabilities fail", () => {
    mocks.checking = true;
    renderPage(true);
    expect(screen.getByTestId("settings-access-error")).toBeTruthy();
    expect(mocks.getRequestTypes).not.toHaveBeenCalled();
    expect(mocks.getRequestType).not.toHaveBeenCalled();
    expect(mocks.getRequestTypeGroupOrder).not.toHaveBeenCalled();
  });

  it("renders editor labels and clear options from translations", async () => {
    mocks.translations = {
      fieldKey: "Translated field key",
      label: "Translated customer label",
      type: "Translated field type",
      help: "Translated help",
      options: "Translated options",
      mapsTo: "Translated mapping",
      unmapped: "Translated clear mapping",
      showWhen: "Translated visibility",
      always: "Translated always visible",
      equals: "Translated equals",
      multiple: "Translated multiple files",
      remove: "Translated remove",
    };
    mocks.getRequestType.mockResolvedValue({
      ...type,
      formSchema: {
        fields: [
          type.formSchema.fields[0],
          {
            ...type.formSchema.fields[1],
            showIf: { field_key: "title", op: "eq", value: "yes" },
          },
          type.formSchema.fields[2],
        ],
      },
    });
    renderPage();
    expect(
      await screen.findAllByLabelText("Translated field key"),
    ).toHaveLength(3);
    expect(screen.getAllByLabelText("Translated customer label")).toHaveLength(
      3,
    );
    expect(screen.getAllByLabelText("Translated field type")).toHaveLength(3);
    expect(screen.getAllByLabelText("Translated help")).toHaveLength(3);
    expect(screen.getAllByLabelText("Translated options")).toHaveLength(3);
    expect(screen.getByLabelText("Translated equals")).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Translated multiple files" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /remove/i })[0],
    ).toHaveTextContent("Translated remove");
    const maps = screen.getAllByRole("combobox", {
      name: "Translated mapping",
    });
    fireEvent.click(maps[0] as HTMLElement);
    expect(
      screen.getByRole("option", { name: "Translated clear mapping" }),
    ).toBeTruthy();
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    const visibility = screen.getAllByRole("combobox", {
      name: "Translated visibility",
    });
    fireEvent.click(visibility[1] as HTMLElement);
    expect(
      screen.getByRole("option", { name: "Translated always visible" }),
    ).toBeTruthy();
  });

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
    mocks.getRequestTypes
      .mockReset()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue({ requestTypes: [type] });
    renderPage();
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.getRequestTypes).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByLabelText("Field key")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("saves group order independently with its expected version", async () => {
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
    const announcements = screen
      .getAllByRole("status")
      .filter((node) => node.textContent?.trim());
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toHaveTextContent("Group order saved.");
    expect(
      screen.getByRole("button", { name: "Move Support down" }),
    ).toBeTruthy();
  });

  it("selects and clears a mapping before saving (D9)", async () => {
    renderPage();
    await screen.findAllByLabelText("Field key");

    const mapsToTriggers = screen.getAllByRole("combobox", {
      name: "Maps to",
    });
    // First field has mapsTo: { field: "title" }
    const firstMapsTo = mapsToTriggers[0];
    if (!firstMapsTo) throw new Error("Maps to trigger is missing");
    fireEvent.click(firstMapsTo);
    const descriptionOption = screen.getByRole("option", {
      name: "Work item description",
    });
    fireEvent.pointerDown(descriptionOption, {
      pointerType: "mouse",
      button: 0,
    });
    fireEvent.click(descriptionOption);
    expect(firstMapsTo.textContent).toContain("Work item description");
    expect(firstMapsTo.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(firstMapsTo);
    const clearOption = screen.getByRole("option", {
      name: "Keep in request data",
    });
    fireEvent.pointerDown(clearOption, { pointerType: "mouse", button: 0 });
    fireEvent.click(clearOption);
    expect(firstMapsTo.textContent).toContain("Keep in request data");

    const saveButton = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(mocks.saveRequestType).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            formSchema: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({ key: "title", mapsTo: undefined }),
              ]),
            }),
          }),
        }),
      ),
    );
  });

  it("clears showIf when selecting Always visible (D9)", async () => {
    const typeWithCondition = {
      ...type,
      formSchema: {
        fields: [
          { key: "agree", label: "I agree", type: "checkbox" as const },
          {
            key: "details",
            label: "Details",
            type: "text" as const,
            showIf: { field_key: "agree", op: "eq" as const, value: true },
          },
        ],
      },
    };
    mocks.getRequestType.mockResolvedValue(typeWithCondition);
    renderPage();
    await screen.findAllByLabelText("Field key");

    const showWhenTriggers = screen.getAllByRole("combobox", {
      name: "Show when",
    });
    const firstShowWhen = showWhenTriggers[0];
    const secondShowWhen = showWhenTriggers[1];
    if (!firstShowWhen || !secondShowWhen)
      throw new Error("Show when trigger is missing");
    expect(firstShowWhen.textContent).toContain("Always visible");
    expect(secondShowWhen.textContent).toContain("I agree");
    fireEvent.click(secondShowWhen);
    const alwaysOption = screen.getByRole("option", {
      name: "Always visible",
    });
    fireEvent.pointerDown(alwaysOption, { pointerType: "mouse", button: 0 });
    fireEvent.click(alwaysOption);
    expect(secondShowWhen.textContent).toContain("Always visible");

    const saveButton = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(mocks.saveRequestType).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            formSchema: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({ key: "details", showIf: undefined }),
              ]),
            }),
          }),
        }),
      ),
    );
  });

  it("selects boolean condition value when controlling field is checkbox (D4, D9)", async () => {
    const typeWithCheckboxCondition = {
      ...type,
      formSchema: {
        fields: [
          { key: "agree", label: "I agree", type: "checkbox" as const },
          {
            key: "details",
            label: "Details",
            type: "text" as const,
            showIf: { field_key: "agree", op: "eq" as const, value: true },
          },
        ],
      },
    };
    mocks.getRequestType.mockResolvedValue(typeWithCheckboxCondition);
    renderPage();
    await screen.findAllByLabelText("Field key");

    const equalsTrigger = screen.getByRole("combobox", {
      name: "Equals value",
    });
    fireEvent.click(equalsTrigger);
    const falseOption = screen.getByRole("option", {
      name: "False",
    });
    fireEvent.pointerDown(falseOption, { pointerType: "mouse", button: 0 });
    fireEvent.click(falseOption);

    const saveButton = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(mocks.saveRequestType).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            formSchema: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({
                  key: "details",
                  showIf: { field_key: "agree", op: "eq", value: false },
                }),
              ]),
            }),
          }),
        }),
      ),
    );
  });

  it("maps and localizes priority options when select maps to priority (Finding 1)", async () => {
    const typeWithPriorityMapping = {
      ...type,
      formSchema: {
        fields: [
          {
            key: "severity",
            label: "Severity",
            type: "select" as const,
            options: ["Critical", "Routine"],
            mapsTo: {
              field: "priority" as const,
              map: { Critical: "urgent", Routine: "low" },
            },
          },
        ],
      },
    };
    mocks.getRequestType.mockResolvedValue(typeWithPriorityMapping);
    renderPage();
    await screen.findAllByLabelText("Field key");

    expect(screen.getByText("Priority value mapping")).toBeInTheDocument();

    const criticalTrigger = screen.getByRole("combobox", {
      name: "Critical",
    });
    expect(criticalTrigger).toHaveTextContent("tasks:priority.urgent");

    fireEvent.click(criticalTrigger);
    const highOption = screen.getByRole("option", {
      name: "tasks:priority.high",
    });
    fireEvent.pointerDown(highOption, { pointerType: "mouse", button: 0 });
    fireEvent.click(highOption);

    const saveButton = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(mocks.saveRequestType).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            formSchema: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({
                  key: "severity",
                  mapsTo: {
                    field: "priority",
                    map: { Critical: "high", Routine: "low" },
                  },
                }),
              ]),
            }),
          }),
        }),
      ),
    );
  });
});
