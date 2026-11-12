import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { CustomFieldEditor } from "./custom-field-editor";

const state = vi.hoisted(() => ({
  field: {
    id: "field-one",
    name: "Department",
    key: "department",
    format: "text",
    sectionId: "section-one",
    helpText: null,
    customerVisible: false,
    options: [],
    defaultValue: null,
    visibilityCondition: null,
    visibility: [],
    deletedAt: null,
    usageCount: 0,
    updatedAt: "version-one",
  },
  update: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, ref, ...props }: ComponentProps<"a">) => (
    <a {...props} ref={ref}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) =>
      translate(
        typeof options.count === "number"
          ? `${key}_${new Intl.PluralRules("en").select(options.count)}`
          : key,
        options,
      ),
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-one" }, isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageCustomFields: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/custom-field/use-custom-fields", () => ({
  useCustomFields: () => ({ data: { data: [state.field] }, isLoading: false }),
  useCustomFieldSections: () => ({
    data: [{ id: "section-one", name: "Planning" }],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/fetchers/custom-field", () => ({
  createCustomField: vi.fn(),
  updateCustomField: state.update,
  requestCustomFieldDeletion: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("custom field save feedback", () => {
  it("keeps the focused save control and completion across an updated version", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    state.update.mockResolvedValue({
      ...state.field,
      name: "Team",
      updatedAt: "version-two",
    });
    vi.spyOn(client, "invalidateQueries").mockImplementation(async () => {
      state.field = { ...state.field, name: "Team", updatedAt: "version-two" };
      rerender(view);
    });
    const view = (
      <QueryClientProvider client={client}>
        <CustomFieldEditor fieldId="field-one" />
      </QueryClientProvider>
    );
    const { rerender } = render(view);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Team" },
    });
    const button = screen.getByRole("button", { name: "Save" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Saved" })).toBe(button),
    );
    expect(button).toHaveFocus();
    expect(screen.getByLabelText("Name")).toHaveValue("Team");
    expect(state.update).toHaveBeenCalledOnce();
  });
});
