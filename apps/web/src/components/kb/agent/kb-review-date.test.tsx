import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { KbArticleEditor } from "./kb-article-editor";

const mocks = vi.hoisted(() => ({ update: vi.fn(), canWrite: true }));
const article = {
  id: "qa-article",
  workspaceId: "qa-workspace",
  title: "QA review date",
  body: { type: "doc", content: [] },
  categoryId: null,
  projectId: null,
  customerVisible: false,
  ownerId: null,
  reviewDueAt: null,
  version: 7,
  state: "draft",
};
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: PropsWithChildren<{ to: string }>) => (
    <a href={to}>{children}</a>
  ),
  useBlocker: () => ({ status: "idle" }),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
    i18n: { language: "en-US", resolvedLanguage: "en-US" },
  }),
}));
vi.mock("@/components/activity/comment-editor", () => ({
  default: () => null,
}));
vi.mock("@/fetchers/kb", async () => ({
  ...(await vi.importActual<typeof import("@/fetchers/kb")>("@/fetchers/kb")),
  updateKbArticle: mocks.update,
}));
vi.mock("@/hooks/queries/kb", () => ({
  kbKeys: {
    all: (workspaceId: string) => ["kb", workspaceId],
    article: (id: string) => ["kb", "article", id],
    versions: (id: string) => ["kb", "article", id, "versions"],
  },
  useKbArticle: () => ({
    data: { article, canWrite: mocks.canWrite, canPublish: false },
  }),
  useKbCategories: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [] }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }),
  }),
);
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function renderEditor() {
  const cache = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <KbArticleEditor id={article.id} search={{}} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  mocks.canWrite = true;
  mocks.update
    .mockReset()
    .mockImplementation(async (_id, _version, changes) => ({
      ...article,
      ...changes,
      version: 8,
    }));
});

describe("KB review date library picker", () => {
  it("saves a chosen date at once on the loaded version, without a Save button", async () => {
    const view = renderEditor();
    expect(view.container.querySelector('input[type="date"]')).toBeNull();
    const trigger = screen.getByRole("button", { name: "Review due" });
    fireEvent.click(trigger);
    const entry = screen.getByRole("textbox", {
      name: "Review due (YYYY-MM-DD)",
    });
    fireEvent.change(entry, { target: { value: "2028-02-29" } });
    fireEvent.keyDown(entry, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveTextContent("Feb 29, 2028");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith("qa-article", 7, {
        reviewDueAt: "2028-02-29T00:00:00.000Z",
      }),
    );
  });

  it("does not dirty or save an invalid typed date or an Escape dismissal", async () => {
    renderEditor();
    const trigger = screen.getByRole("button", { name: "Review due" });
    fireEvent.click(trigger);
    const entry = screen.getByRole("textbox", {
      name: "Review due (YYYY-MM-DD)",
    });
    fireEvent.change(entry, { target: { value: "2027-02-29" } });
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Save",
      }),
    ).toBeDisabled();
    fireEvent.keyDown(entry, { key: "Enter", code: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid date");
    fireEvent.keyDown(entry, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps the picker out of a read-only article", () => {
    mocks.canWrite = false;
    renderEditor();
    expect(screen.queryByRole("button", { name: "Review due" })).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
