import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KbList } from "@/components/kb/agent/kb-list";
import { PagesList } from "@/components/pages/pages-list";

const mocks = vi.hoisted(() => ({
  createArticle: vi.fn(),
  createPage: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/kb/agent/kb-categories", () => ({
  KbCategories: () => null,
}));
vi.mock("@/components/kb/agent/kb-report", () => ({ KbReport: () => null }));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-one" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/kb", () => ({
  kbKeys: { all: (id: string) => ["kb", id] },
  useKbSettings: () => ({ data: { canWrite: true } }),
  useKbCategories: () => ({ data: { categories: [] } }),
  useKbArticles: () => ({ data: { articles: [], total: 0 } }),
}));
vi.mock("@/fetchers/kb", () => ({ createKbArticle: mocks.createArticle }));
vi.mock("@/fetchers/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/pages")>()),
  getPages: async () => ({ canEdit: true, pages: [] }),
  createPage: mocks.createPage,
}));

const flows = [
  {
    area: "KB",
    trigger: "kb:list.new",
    title: "kb:create.title",
    cancel: "common:actions.cancel",
    close: "common:actions.close",
    input: "kb:fields.title",
    submit: "kb:create.submit",
  },
  {
    area: "Pages",
    trigger: "list.create",
    title: "create.title",
    cancel: "common.cancel",
    close: "common.close",
    input: "fields.title",
    submit: "create.submit",
  },
] as const;

async function openDialog(flow: (typeof flows)[number]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      {flow.area === "KB" ? (
        <KbList search={{}} onSearchChange={vi.fn()} />
      ) : (
        <PagesList projectKey="HELP" />
      )}
    </QueryClientProvider>,
  );
  const trigger = await screen.findByRole<HTMLButtonElement>("button", {
    name: flow.trigger,
  });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: flow.title });
  return { trigger, dialog };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe.each(flows)("$area create dialog focus", (flow) => {
  it.each(["Escape", "Cancel", "Close"])(
    "returns to its opener after %s without creating data",
    async (action) => {
      const { trigger, dialog } = await openDialog(flow);
      if (action === "Escape") {
        fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
      } else {
        fireEvent.click(
          screen.getByRole("button", {
            name: action === "Cancel" ? flow.cancel : flow.close,
          }),
        );
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(mocks.createArticle).not.toHaveBeenCalled();
      expect(mocks.createPage).not.toHaveBeenCalled();
    },
  );

  it("does not return focus to a disabled opener", async () => {
    const { trigger, dialog } = await openDialog(flow);
    trigger.disabled = true;
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).not.toHaveFocus();
  });

  it("navigates after creation without refocusing the old opener", async () => {
    mocks.createArticle.mockResolvedValue({ id: "new-article" });
    mocks.createPage.mockResolvedValue({ id: "new-page" });
    const { trigger } = await openDialog(flow);
    const focus = vi.spyOn(trigger, "focus");
    fireEvent.change(screen.getByRole("textbox", { name: flow.input }), {
      target: { value: "New content" },
    });
    fireEvent.click(screen.getByRole("button", { name: flow.submit }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(focus).not.toHaveBeenCalled();
    if (flow.area === "KB") {
      expect(mocks.createArticle).toHaveBeenCalledWith("workspace-one", {
        title: "New content",
      });
    } else {
      expect(mocks.createPage).toHaveBeenCalledWith("HELP", {
        title: "New content",
        parentId: null,
      });
    }
  });
});
