import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { CustomFieldsList } from "./custom-fields-list";

const writes = vi.hoisted(() => ({ create: vi.fn(), rename: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, className, ref }: ComponentProps<"a">) => (
    <a href="#new-field" className={className} ref={ref}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
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
  customFieldSectionsKey: (id: string) => ["custom-field-sections", id],
  useCustomFields: () => ({
    data: { data: [], meta: { total: 0, manyFieldsWarning: false } },
    isLoading: false,
  }),
  useCustomFieldSections: () => ({
    data: [{ id: "section-one", name: "Planning", position: 0 }],
    isLoading: false,
  }),
}));
vi.mock("@/fetchers/custom-field", () => ({
  createCustomFieldSection: writes.create,
  renameCustomFieldSection: writes.rename,
  deleteCustomFieldSection: vi.fn(),
  reorderCustomFieldSections: vi.fn(),
  reorderCustomFields: vi.fn(),
  restoreCustomField: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("custom-field section dialog focus", () => {
  it.each([
    ["New section", "New section", "Escape"],
    ["New section", "New section", "Cancel"],
    ["Rename section Planning", "Rename section", "Escape"],
    ["Rename section Planning", "Rename section", "Cancel"],
  ])("returns to %s from %s using %s", async (name, title, close) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <CustomFieldsList showDeleted={false} />
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole("button", { name });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: title });
    if (close === "Escape") {
      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(writes.create).not.toHaveBeenCalled();
    expect(writes.rename).not.toHaveBeenCalled();
  });

  it.each(["disabled", "disconnected"])(
    "does not restore focus to a %s trigger",
    async (state) => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      render(
        <QueryClientProvider client={client}>
          <CustomFieldsList showDeleted={false} />
        </QueryClientProvider>,
      );
      const trigger = screen.getByRole<HTMLButtonElement>("button", {
        name: "New section",
      });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = await screen.findByRole("dialog", { name: "New section" });
      if (state === "disabled") trigger.disabled = true;
      else trigger.remove();
      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(trigger).not.toHaveFocus();
      expect(writes.create).not.toHaveBeenCalled();
      expect(writes.rename).not.toHaveBeenCalled();
    },
  );
});
