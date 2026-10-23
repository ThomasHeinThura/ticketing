import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import { HttpError } from "@/lib/http-error";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemCrumbSelect from "./work-item-crumb-select";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: (...args: unknown[]) => mocks.read(...args),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => {
    throw new Error("Legacy task API must not be used");
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const row = (key: string, extra: Partial<WorkItemRow> = {}) =>
  ({
    id: key,
    key,
    workspaceId: "workspace",
    projectId: "project",
    title: `Title ${key}`,
    unavailableFields: [],
    ...extra,
  }) as WorkItemRow;
const page = (items: WorkItemRow[], nextCursor?: string): WorkItemsResult => ({
  items,
  hasMore: !!nextCursor,
  nextCursor,
  hasPartialFailure: false,
});
function mount() {
  const select = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <WorkItemCrumbSelect
        itemKey="HELP-1"
        workspaceId="workspace"
        projectId="project"
        onSelect={select}
      />
    </QueryClientProvider>,
  );
  return { ...view, select, client };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "HELP-1" }));
}
beforeEach(() => {
  mocks.read.mockReset();
  mocks.read.mockResolvedValue(page([row("HELP-1"), row("HELP-2")]));
});
afterEach(cleanup);
it("opens the original breadcrumb geometry lazily, disables current item and selects permanent keys", async () => {
  const { select } = mount();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.getByRole("button")).toHaveClass("h-7", "max-w-56");
  await open();
  const current = await screen.findByRole("menuitem", {
    name: "HELP-1 Title HELP-1",
  });
  expect(current).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("menu")).toHaveClass("w-80");
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith("project", "key", "asc", {
    cursor: undefined,
  });
  fireEvent.click(
    screen.getByRole("menuitem", { name: "HELP-2 Title HELP-2" }),
  );
  expect(select).toHaveBeenCalledExactlyOnceWith("HELP-2");
  await waitFor(() =>
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
  );
});
it("loads each opaque cursor explicitly without closing the menu or losing earlier rows", async () => {
  mocks.read
    .mockResolvedValueOnce(page([row("HELP-1")], "cursor-one"))
    .mockResolvedValueOnce(page([row("HELP-2")], "cursor-two"))
    .mockResolvedValueOnce(page([row("HELP-3")]));
  mount();
  await open();
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "workItems:list.loadMore" }),
  );
  await screen.findByRole("menuitem", { name: "HELP-2 Title HELP-2" });
  expect(
    screen.getByRole("menuitem", { name: "HELP-1 Title HELP-1" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "workItems:list.loadMore" }),
  );
  await screen.findByRole("menuitem", { name: "HELP-3 Title HELP-3" });
  expect(mocks.read.mock.calls.map((call) => call[3].cursor)).toEqual([
    undefined,
    "cursor-one",
    "cursor-two",
  ]);
  expect(
    screen.queryByRole("menuitem", { name: "workItems:list.loadMore" }),
  ).not.toBeInTheDocument();
});
it("does not expose rows from another project/workspace or unavailable/malformed identifiers", async () => {
  mocks.read.mockResolvedValue(
    page([
      row("HELP-2"),
      row("HELP-3", { projectId: "foreign" }),
      row("HELP-4", { workspaceId: "foreign" }),
      row("bad-uuid"),
      row("HELP-5", { unavailableFields: ["key"] }),
    ]),
  );
  mount();
  await open();
  await screen.findByRole("menuitem", { name: "HELP-2 Title HELP-2" });
  expect(
    screen.queryByText(/Title HELP-[345]|bad-uuid/),
  ).not.toBeInTheDocument();
  expect(screen.getByText("workItems:list.partialNoticeTitle")).toBeVisible();
});
it("shows loading and a real empty result without fabricated candidates", async () => {
  let resolve: ((result: WorkItemsResult) => void) | undefined;
  mocks.read.mockImplementation(
    () =>
      new Promise<WorkItemsResult>((done) => {
        resolve = done;
      }),
  );
  mount();
  await open();
  await waitFor(() =>
    expect(screen.getByText("workItems:list.loading")).toBeVisible(),
  );
  resolve?.(page([]));
  await screen.findByText("tasks:listView.noTasks");
  expect(screen.queryByText("workItems:list.loading")).not.toBeInTheDocument();
});
it("retries a failed page with its same cursor and keeps the confirmed previous page", async () => {
  mocks.read
    .mockResolvedValueOnce(page([row("HELP-1")], "opaque"))
    .mockRejectedValueOnce(new HttpError(500, "private debug"))
    .mockResolvedValueOnce(page([row("HELP-2")]));
  mount();
  await open();
  fireEvent.click(await screen.findByText("workItems:list.loadMore"));
  fireEvent.click(await screen.findByText("common:actions.retry"));
  await screen.findByText("HELP-2 Title HELP-2");
  expect(screen.getByText("HELP-1 Title HELP-1")).toBeVisible();
  expect(mocks.read.mock.calls.map((call) => call[3].cursor)).toEqual([
    undefined,
    "opaque",
    "opaque",
  ]);
  expect(screen.queryByText("private debug")).not.toBeInTheDocument();
});
it("hides previously cached candidates when fresh reach is lost", async () => {
  const { client } = mount();
  client.setQueryData(["work-items", "crumb", "workspace", "project"], {
    pages: [page([row("HELP-2")])],
    pageParams: [undefined],
  });
  mocks.read.mockRejectedValue(new HttpError(404, "secret project"));
  await open();
  await screen.findByText("workItems:list.errorTitle");
  expect(screen.queryByText("HELP-2 Title HELP-2")).not.toBeInTheDocument();
  expect(screen.queryByText("secret project")).not.toBeInTheDocument();
});
it("fails visibly when a server cursor repeats rather than silently claiming completeness", async () => {
  mocks.read
    .mockResolvedValueOnce(page([row("HELP-1")], "repeat"))
    .mockResolvedValueOnce(page([row("HELP-2")], "repeat"));
  mount();
  await open();
  fireEvent.click(await screen.findByText("workItems:list.loadMore"));
  await screen.findByText("workItems:list.errorTitle");
  expect(screen.queryByText("workItems:list.loadMore")).not.toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
