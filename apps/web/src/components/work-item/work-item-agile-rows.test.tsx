import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemAgileRows from "./work-item-agile-rows";
import {
  settleWorkItemMutation,
  workItemMutationKey,
  workItemMutationScope,
} from "./work-item-save";

const mocks = vi.hoisted(() => ({
  canUpdate: true,
  setCycle: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/queries/agile/use-agile-features", () => ({
  default: () => ({
    features: { estimates: false, cycles: true, modules: false },
  }),
}));
vi.mock("@/hooks/queries/agile/use-project-estimate", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => mocks.canUpdate }),
}));
vi.mock("@/fetchers/agile", () => ({
  FeatureDisabledError: class FeatureDisabledError extends Error {},
  getCycles: async () => ({
    data: [
      { id: "cycle-1", name: "Sprint 1", status: "active" },
      { id: "cycle-2", name: "Sprint 2", status: "planned" },
    ],
  }),
  getModules: async () => ({ data: [] }),
  getWorkItemEstimate: async () => null,
  setWorkItemCycle: mocks.setCycle,
  setWorkItemEstimate: vi.fn(),
  setWorkItemModule: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));

const item = {
  key: "HELP-7",
  projectId: "p1",
  workspaceId: "w1",
  cycleId: "cycle-1",
} as unknown as WorkItemDetailRow;

function renderRows() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkItemAgileRows item={item} compact={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.canUpdate = true;
  mocks.setCycle.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("WorkItemAgileRows", () => {
  it("settles a state refusal and queued agile save once after the row unmounts", async () => {
    let rejectState!: (error: Error) => void;
    let resolveCycle!: () => void;
    const state = new Promise<void>((_resolve, reject) => {
      rejectState = reject;
    });
    const cycle = new Promise<void>((resolve) => {
      resolveCycle = resolve;
    });
    mocks.setCycle.mockReturnValue(cycle);
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    function Harness() {
      const mutation = useMutation({
        mutationKey: workItemMutationKey(item.key),
        scope: workItemMutationScope(item.key),
        mutationFn: () => state,
        onSettled: () =>
          settleWorkItemMutation(client, item.key, () =>
            client.invalidateQueries({ queryKey: ["detail-refresh"] }),
          ),
      });
      return (
        <>
          <Button type="button" onClick={() => mutation.mutate()}>
            state
          </Button>
          <WorkItemAgileRows item={item} compact={false} />
        </>
      );
    }
    const view = render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("state"));
    fireEvent.click(await screen.findByRole("button", { name: /Sprint 1/ }));
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Sprint 2" }),
    );
    view.unmount();
    rejectState(new Error("refused"));
    await waitFor(() => expect(mocks.setCycle).toHaveBeenCalledTimes(1));
    expect(invalidate).not.toHaveBeenCalled();
    resolveCycle();
    await waitFor(() => expect(client.isMutating()).toBe(0));
    await waitFor(() =>
      expect(
        invalidate.mock.calls.filter(
          ([arg]) => arg?.queryKey?.[0] === "work-items",
        ),
      ).toHaveLength(5),
    );
  });

  it("does not delay another item's refresh while one item remains pending", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const firstRefresh = vi.fn();
    const secondRefresh = vi.fn();
    const create = (key: string, request: Promise<void>, refresh: () => void) =>
      client
        .getMutationCache()
        .build(client, {
          mutationKey: workItemMutationKey(key),
          scope: workItemMutationScope(key),
          mutationFn: () => request,
          onSettled: () => settleWorkItemMutation(client, key, refresh),
        })
        .execute(undefined);
    const running = create("HELP-7", first, firstRefresh);
    await create("HELP-8", Promise.resolve(), secondRefresh);
    expect(secondRefresh).toHaveBeenCalledTimes(1);
    expect(firstRefresh).not.toHaveBeenCalled();
    resolveFirst();
    await running;
    expect(firstRefresh).toHaveBeenCalledTimes(1);
  });

  it("offers the cycles as a radio menu that moves with the arrow keys", async () => {
    renderRows();
    const trigger = await screen.findByRole("button", { name: /Sprint 1/ });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const none = await screen.findByRole("menuitemradio", {
      name: "properties.agile.noCycle",
    });
    await waitFor(() => expect(none).toHaveFocus());
    expect(
      screen.getByRole("menuitemradio", { name: "Sprint 1" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(none, { key: "ArrowDown" });
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: "Sprint 1" }),
      ).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Sprint 2" }));
    await waitFor(() =>
      expect(mocks.setCycle).toHaveBeenCalledWith("HELP-7", "cycle-2"),
    );
  });

  it("shows the cycle as plain text to a caller who cannot change it", async () => {
    mocks.canUpdate = false;
    renderRows();
    const row = await screen.findByTestId("work-item-cycle-control");
    await waitFor(() => expect(row).toHaveTextContent("Sprint 1"));
    expect(row.tagName).toBe("DIV");
    expect(screen.queryByRole("button", { name: /Sprint 1/ })).toBeNull();
  });
});
