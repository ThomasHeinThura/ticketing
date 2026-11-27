import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prefetchWorkItemDetail,
  workItemDetailQueryKey,
} from "@/hooks/queries/work-item/use-get-work-item";
import { HttpError } from "@/lib/http-error";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemSidePane from "./work-item-side-pane";

const mocks = vi.hoisted(() => ({
  getWorkItem: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: (key: string) => mocks.getWorkItem(key),
}));
vi.mock("@/hooks/use-native-work-item-realtime", () => ({
  useNativeWorkItemRealtime: () => ({ status: "available" }),
}));
vi.mock("@/lib/i18n", () => ({
  areAllNamespacesLoaded: () => true,
  whenAllNamespacesLoaded: () => Promise.resolve(),
}));
vi.mock("react-i18next", async () => ({
  I18nContext: (await import("react")).createContext(undefined),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [], isLoading: false }),
}));
vi.mock("./work-item-actions", () => ({ default: () => null }));
vi.mock("@/components/work-item/load-work-item-detail", () => ({
  default: async () => ({
    default: (props: {
      item?: { title: string };
      onAccessLost: () => void;
    }) => {
      mocks.detail(props);
      return (
        <div data-testid="detail">
          {props.item?.title}
          <Button type="button" onClick={props.onAccessLost}>
            lose access
          </Button>
        </div>
      );
    },
  }),
}));

const secret = { key: "HELP-1", title: "Secret title", projectId: "p" };
const row = {
  key: "HELP-1",
  title: "Printer on fire",
  stateName: "In progress",
  assigneeName: "Ada Lovelace",
  unavailableFields: [],
} as unknown as WorkItemRow;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  const view = (listRow?: WorkItemRow) => (
    <QueryClientProvider client={queryClient}>
      <WorkItemSidePane itemKey="HELP-1" onClose={() => {}} listRow={listRow} />
    </QueryClientProvider>
  );
  return { queryClient, view };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("side pane access changes", () => {
  it("shows no content from a prefetch that was in flight when the session's cache was cleared", async () => {
    const { queryClient, view } = setup();
    let finish: (value: unknown) => void = () => {};
    mocks.getWorkItem.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    // Hover started the read under the old role or workspace.
    prefetchWorkItemDetail(queryClient, "HELP-1");
    // A workspace change or sign-out empties the cache while it is still in flight.
    queryClient.clear();
    mocks.getWorkItem.mockRejectedValueOnce(new HttpError(403, "Forbidden"));

    render(view());
    finish(secret);
    await waitFor(() =>
      expect(mocks.detail).toHaveBeenCalledWith(
        expect.objectContaining({ isError: true }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText("Secret title")).not.toBeInTheDocument();
    expect(
      mocks.detail.mock.calls.every(([props]) => props.item === undefined),
    ).toBe(true);
    expect(queryClient.getQueryData(workItemDetailQueryKey("HELP-1"))).toBe(
      undefined,
    );
  });

  it("clears the item and its cache entry when access is lost while it is open", async () => {
    const { queryClient, view } = setup();
    mocks.getWorkItem.mockResolvedValue({
      ...secret,
      workspaceId: "w",
      unavailableFields: [],
    });
    render(view());
    expect(await screen.findByText("Secret title")).toBeInTheDocument();

    // The server now refuses the item (the role that allowed it is gone).
    mocks.getWorkItem.mockRejectedValue(new HttpError(403, "Forbidden"));
    screen.getByRole("button", { name: "lose access" }).click();

    await waitFor(() =>
      expect(screen.queryByText("Secret title")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(workItemDetailQueryKey("HELP-1"))).toBe(
        undefined,
      ),
    );
  });

  it("shows the list row as the header while loading, never as detail data, and drops it when refused", async () => {
    const { queryClient, view } = setup();
    let refuse: (reason: unknown) => void = () => {};
    mocks.getWorkItem.mockReset();
    mocks.getWorkItem.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );
    render(view(row));

    expect(await screen.findByText("Printer on fire")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    // Display only: nothing was written into the detail cache for it.
    expect(queryClient.getQueryData(workItemDetailQueryKey("HELP-1"))).toBe(
      undefined,
    );
    expect(mocks.detail).not.toHaveBeenCalled();

    refuse(new HttpError(403, "Forbidden"));
    await waitFor(() =>
      expect(screen.queryByText("Printer on fire")).not.toBeInTheDocument(),
    );
  });

  it("keeps the list row header up for as long as the loading placeholder is shown, even after the item arrives", async () => {
    const { view } = setup();
    let finish: (value: unknown) => void = () => {};
    mocks.getWorkItem.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(view(row));
    // Past the 150 ms delay, the placeholder is visible.
    await waitFor(
      () =>
        expect(screen.getByTestId("work-item-detail-loading")).toBeVisible(),
      { timeout: 1000 },
    );
    finish({ ...secret, workspaceId: "w", unavailableFields: [] });

    const gaps: string[] = [];
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && !screen.queryByText("Secret title")) {
      if (
        screen.queryByTestId("work-item-detail-loading") &&
        !screen.queryByText("Printer on fire")
      )
        gaps.push("loading skeleton without the row header");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await screen.findByText("Secret title")).toBeInTheDocument();
    expect(gaps).toEqual([]);
    expect(screen.queryByText("Printer on fire")).not.toBeInTheDocument();
  });
});
