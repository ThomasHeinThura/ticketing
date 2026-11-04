import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
vi.mock("./work-item-save", () => ({ useRefreshWorkItem: () => vi.fn() }));
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
