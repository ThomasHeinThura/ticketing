import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, startTransition } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemsPanel from "./work-items-panel";

const testState = vi.hoisted(() => ({
  listReady: true,
  suspendWorkItemId: undefined as string | undefined,
  suspendedAttempts: 0,
}));
const neverResolve = new Promise<never>(() => {});

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
    if (
      testState.suspendWorkItemId !== undefined &&
      workItems?.[0]?.id === testState.suspendWorkItemId
    ) {
      testState.suspendedAttempts += 1;
      throw neverResolve;
    }
    if (!testState.listReady) return null;
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
const observers: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];

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
    observers.length = 0;
    testState.listReady = true;
    testState.suspendWorkItemId = undefined;
    testState.suspendedAttempts = 0;
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

  it("requires fresh two-frame readiness after a ready A to B to A transition", async () => {
    const view = render(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-a" })}
      />,
    );
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    advanceAnimationFrame();
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    advanceAnimationFrame();
    await waitFor(() =>
      expect(screen.getByTestId("work-list-realtime")).toHaveTextContent(
        "Realtime project-a",
      ),
    );

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-b" })}
      />,
    );
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    const staleProjectFrame = [...frameCallbacks.keys()][0];

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-a" })}
      />,
    );
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    expect(frameCallbacks.has(staleProjectFrame)).toBe(false);

    advanceAnimationFrame();
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();
    advanceAnimationFrame();
    await waitFor(() =>
      expect(screen.getByTestId("work-list-realtime")).toHaveTextContent(
        "Realtime project-a",
      ),
    );
  });

  it("keeps committed A readiness when a suspended B render is abandoned", async () => {
    const view = render(
      <Suspense fallback={<div data-testid="suspended-project" />}>
        <WorkItemsPanel
          {...panelProps({ isLoading: false, projectId: "project-a" })}
        />
      </Suspense>,
    );
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    advanceAnimationFrame();
    await waitFor(() => expect(frameCallbacks.size).toBe(1));

    const projectB = panelProps({
      isLoading: false,
      projectId: "project-b",
    });
    projectB.workItemsResult = {
      ...makeWorkItems(1),
      items: [
        { id: "work-item-b", key: "WLP-B", title: "Project B item" },
      ] as WorkItemRow[],
    } as WorkItemsResult;
    testState.suspendWorkItemId = "work-item-b";

    act(() => {
      startTransition(() => {
        view.rerender(
          <Suspense fallback={<div data-testid="suspended-project" />}>
            <WorkItemsPanel {...projectB} />
          </Suspense>,
        );
      });
    });
    await waitFor(() => expect(testState.suspendedAttempts).toBeGreaterThan(0));
    expect(screen.getByTestId("work-item-list-populated")).toBeInTheDocument();
    expect(screen.queryByTestId("suspended-project")).not.toBeInTheDocument();

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

  it("cancels the old project's pending frame and eventually mounts the current project", async () => {
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
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    advanceAnimationFrame();
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    const staleFrameId = [...frameCallbacks.keys()][0];

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-b" })}
      />,
    );
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    expect(frameCallbacks.has(staleFrameId)).toBe(false);
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();

    advanceAnimationFrame();
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();
    advanceAnimationFrame();
    await waitFor(() =>
      expect(screen.getByTestId("work-list-realtime")).toHaveTextContent(
        "Realtime project-b",
      ),
    );
  });

  it("ignores a late old-project frame callback after cleanup", async () => {
    const view = render(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-a" })}
      />,
    );
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    advanceAnimationFrame();
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    const staleCallback = [...frameCallbacks.values()][0];

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-b" })}
      />,
    );
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    act(() => staleCallback(0));

    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();
    expect(frameCallbacks.size).toBe(1);
    advanceAnimationFrame();
    advanceAnimationFrame();
    await waitFor(() =>
      expect(screen.getByTestId("work-list-realtime")).toHaveTextContent(
        "Realtime project-b",
      ),
    );
  });

  it("disconnects readiness observers on project change and unmount", async () => {
    testState.listReady = false;
    class TestMutationObserver {
      disconnect = vi.fn();
      constructor(_callback: MutationCallback) {
        observers.push(this);
      }
      observe() {}
    }
    vi.stubGlobal(
      "MutationObserver",
      TestMutationObserver as unknown as typeof MutationObserver,
    );
    const view = render(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-a" })}
      />,
    );
    await waitFor(() => expect(observers.length).toBeGreaterThan(0));
    const firstObserver = observers.at(-1);

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-b" })}
      />,
    );
    await waitFor(() => expect(observers.length).toBeGreaterThan(1));
    expect(firstObserver?.disconnect).toHaveBeenCalled();

    const projectObserver = observers.at(-1);
    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: true, projectId: "project-b" })}
      />,
    );
    expect(projectObserver?.disconnect).toHaveBeenCalled();

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-b" })}
      />,
    );
    await waitFor(() => expect(observers.length).toBeGreaterThan(2));
    const currentObserver = observers.at(-1);
    view.unmount();
    expect(currentObserver?.disconnect).toHaveBeenCalled();
  });

  it("cancels both queued frames when loading resumes or the panel unmounts", async () => {
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
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    advanceAnimationFrame();
    expect(frameCallbacks.size).toBe(1);

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: true, projectId: "project-a" })}
      />,
    );
    expect(frameCallbacks.size).toBe(0);

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: false, projectId: "project-a" })}
      />,
    );
    await waitFor(() => expect(frameCallbacks.size).toBe(1));
    advanceAnimationFrame();
    expect(frameCallbacks.size).toBe(1);
    view.unmount();
    expect(frameCallbacks.size).toBe(0);
  });
});
