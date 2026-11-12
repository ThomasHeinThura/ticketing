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
  navigate: vi.fn(),
  getRequestTypes: vi.fn(),
  getRequestType: vi.fn(),
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
  saveRequestType: vi.fn(),
  unpublishRequestType: vi.fn(),
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
      options?.defaultValue ?? key,
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
    mocks.getRequestTypes.mockReset().mockResolvedValue({
      requestTypes: [type],
    });
    mocks.getRequestType.mockReset().mockResolvedValue(type);
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

  it.each(["lead", "member", "viewer"])(
    "shows the no-access state to a %s and sends no request",
    (role) => {
      mocks.role = role;
      renderPage();
      expect(screen.getByTestId("settings-access-denied")).toBeTruthy();
      expect(screen.queryByLabelText("Field key")).toBeNull();
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
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
    expect(
      screen.getByRole("button", { name: "Move Support down" }),
    ).toBeTruthy();
  });
});
