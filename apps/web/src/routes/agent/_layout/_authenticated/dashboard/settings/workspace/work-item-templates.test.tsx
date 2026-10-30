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
import { Route } from "./work-item-templates";

const mocks = vi.hoisted(() => ({
  search: {} as { q?: string; library?: string; id?: string },
  navigate: vi.fn(),
  editorPlaceholder: undefined as string | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    fullPath: "/dashboard/settings/workspace/work-item-templates",
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/fetchers/work-item-template/work-item-templates", () => ({
  archiveChecklistTemplate: vi.fn(),
  archiveWorkItemTemplate: vi.fn(),
  listChecklistTemplates: vi.fn().mockResolvedValue([]),
  listWorkItemTemplatesForManagement: vi.fn().mockResolvedValue([]),
  saveChecklistTemplate: vi.fn(),
  saveWorkItemTemplate: vi.fn(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "workspace-1" },
    canManageWorkspaceSettings: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({ placeholder }: { placeholder?: string }) => {
    mocks.editorPlaceholder = placeholder;
    return null;
  },
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const Page = (Route as unknown as { component: ComponentType }).component;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

describe("templates and checklists switch", () => {
  beforeEach(() => {
    mocks.search = { q: "abc" };
    mocks.navigate.mockReset();
  });
  afterEach(cleanup);

  it("is a tab list with the current library selected", async () => {
    renderPage();
    const templates = await screen.findByRole("tab", {
      name: "settings:workItemTemplates.templatesTab",
    });
    const checklists = screen.getByRole("tab", {
      name: "settings:workItemTemplates.checklistsTab",
    });
    expect(templates).toHaveAttribute("aria-selected", "true");
    expect(checklists).toHaveAttribute("aria-selected", "false");
  });

  it("switches library into the URL, keeping the search text", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("tab", {
        name: "settings:workItemTemplates.checklistsTab",
      }),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        search: { q: "abc", library: "checklists" },
      }),
    );
  });

  it("moves between the tabs with the arrow keys", async () => {
    renderPage();
    const templates = await screen.findByRole("tab", {
      name: "settings:workItemTemplates.templatesTab",
    });
    templates.focus();
    fireEvent.keyDown(templates, { key: "ArrowRight" });
    await waitFor(() =>
      expect(
        screen.getByRole("tab", {
          name: "settings:workItemTemplates.checklistsTab",
        }),
      ).toHaveFocus(),
    );
  });
});

describe("template dialog description field", () => {
  afterEach(cleanup);
  it("passes its own placeholder instead of the comment one", async () => {
    mocks.search = { id: "new" };
    mocks.editorPlaceholder = undefined;
    renderPage();
    await waitFor(() =>
      expect(mocks.editorPlaceholder).toBe(
        "settings:workItemTemplates.descriptionPlaceholder",
      ),
    );
  });
});
