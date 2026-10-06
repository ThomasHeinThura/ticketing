import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import WorkItemsPanel from "./work-items-panel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("./work-item-list", () => ({
  default: () => <div data-testid="work-list-content">Work list</div>,
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

function panelProps({
  isLoading,
  projectId = "project-a",
}: {
  isLoading: boolean;
  projectId?: string;
}) {
  const project = { id: projectId, name: projectId };
  return {
    project,
    workItemsResult: undefined,
    isLoading,
    isError: false,
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

  it("starts the socket after list content commits and keeps a project switch gated", async () => {
    const view = render(
      <WorkItemsPanel {...panelProps({ isLoading: true })} />,
    );
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();

    view.rerender(<WorkItemsPanel {...panelProps({ isLoading: false })} />);
    await waitFor(() =>
      expect(screen.getByTestId("work-list-content")).toBeInTheDocument(),
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

    view.rerender(
      <WorkItemsPanel
        {...panelProps({ isLoading: true, projectId: "project-b" })}
      />,
    );
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();

    advanceAnimationFrame();
    expect(screen.queryByTestId("work-list-realtime")).not.toBeInTheDocument();
  });
});
