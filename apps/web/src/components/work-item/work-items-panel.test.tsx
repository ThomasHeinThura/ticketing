import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemsPanel from "./work-items-panel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("./work-item-list", () => ({
  default: ({
    workItems,
    isLoading,
    isError,
  }: {
    workItems: WorkItemRow[] | undefined;
    isLoading: boolean;
    isError: boolean;
  }) => {
    if (isLoading)
      return <div data-testid="work-item-list-loading">Loading</div>;
    if (isError) return <div data-testid="work-item-list-error">Error</div>;
    if (!workItems?.length)
      return <div data-testid="work-item-list-empty">Empty</div>;
    return <div data-testid="work-item-list-populated">Work list</div>;
  },
}));

vi.mock("./work-item-list-realtime", () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="work-list-realtime">Realtime {projectId}</div>
  ),
}));

const frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

function advanceAnimationFrame() {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  act(() => {
    for (const callback of callbacks) callback(0);
  });
}

function makeWorkItems(count: number): WorkItemsResult {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      id: `work-item-${index}`,
      key: `WLP-${index}`,
      title: `Work item ${index}`,
    })) as WorkItemRow[],
    hasPartialFailure: false,
    hasMore: false,
  } as WorkItemsResult;
}

function panelProps({
  isLoading,
  isError = false,
  projectId = "project-a",
  itemCount = 1,
}: {
  isLoading: boolean;
  isError?: boolean;
  projectId?: string;
  itemCount?: number;
}) {
  const project = { id: projectId, name: projectId };
  return {
    project,
    workItemsResult:
      isLoading || isError ? undefined : makeWorkItems(itemCount),
    isLoading,
    isError,
    realtimeProjectId: projectId,
    realtimeStatus: {
      projectId,
      status: "connecting" as WorkItemRealtimeStatus,
    },
    sort: "key" as const,
    dir: "asc" as const,
    onSortChange: vi.fn(),
    onRealtimeAvailabilityChange: vi.fn(),
    onRetry: vi.fn(),
  };
}

describe("work-item list realtime startup", () => {
  beforeEach(() => {
    frameCallbacks.clear();
    nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frameCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frameCallbacks.delete(id);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: "populated",
      isError: false,
      itemCount: 1,
      expected: "work-item-list-populated",
    },
    {
      name: "empty",
      isError: false,
      itemCount: 0,
      expected: "work-item-list-empty",
    },
    {
      name: "error",
      isError: true,
      itemCount: 0,
      expected: "work-item-list-error",
    },
  ])("starts realtime after the $name list state commits", async (scenario) => {
    const view = render(
      <WorkItemsPanel {...panelProps({ isLoading: true })} />,
    );
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();

    view.rerender(
      <WorkItemsPanel
        {...panelProps({
          isLoading: false,
          isError: scenario.isError,
          itemCount: scenario.itemCount,
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(scenario.expected)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();

    advanceAnimationFrame();
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();
    advanceAnimationFrame();
    await waitFor(() =>
      expect(screen.getByTestId("work-list-realtime")).toHaveTextContent(
        "Realtime project-a",
      ),
    );
  });

  it("does not start the previous project's socket when a project switch begins", async () => {
    const view = render(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-a" })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("work-item-list-populated"),
      ).toBeInTheDocument(),
    );
    advanceAnimationFrame();
    advanceAnimationFrame();
    await waitFor(() =>
      expect(screen.getByTestId("work-list-realtime")).toHaveTextContent(
        "Realtime project-a",
      ),
    );

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: true, projectId: "project-b" })}
      />,
    );
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();
  });
});
