import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import type { WorkItemRow } from "@/types/work-item";

const testState = vi.hoisted(() => ({
  kaneoListImports: 0,
  states: undefined as
    | { id: string; name: string; group: string }[]
    | undefined,
  statesLoading: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/hooks/use-project-view-preference", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/use-project-view-preference")
  >()),
  useProjectViewPreference: () => ({
    value: undefined,
    set: vi.fn(),
    settled: true,
  }),
}));

vi.mock("@/hooks/queries/project/use-get-project-states", () => ({
  default: () => ({
    data: testState.states,
    isLoading: testState.statesLoading,
    isError: false,
  }),
}));

vi.mock("./work-item-list-realtime", () => ({ default: () => null }));

const frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

async function advanceAnimationFrame() {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  await act(async () => {
    for (const callback of callbacks) callback(0);
  });
}

/** Lets pending dynamic imports and React updates settle without running any frame. */
async function flushMicrotasks() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

function row(index: number): WorkItemRow {
  return {
    id: `id-${index}`,
    key: `WLP-${index}`,
    number: index,
    projectId: "project-a",
    workspaceId: "workspace-1",
    typeId: "type-1",
    requesterId: null,
    parentId: null,
    customerVisibility: "private",
    archivedAt: null,
    deletedAt: null,
    stateCategory: "backlog",
    title: `Seeded work item ${index}`,
    description: null,
    stateId: "backlog",
    stateName: "Backlog",
    priority: "medium",
    assigneeId: null,
    assigneeName: null,
    position: String(index),
    startDate: null,
    dueDate: null,
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
    version: 1,
    unavailableFields: [],
  };
}

function panelProps({
  isLoading = false,
  sort = "key",
}: {
  isLoading?: boolean;
  sort?: "key" | "position";
}) {
  return {
    layout: "list" as const,
    project: { id: "project-a", name: "Project A" },
    workItemsResult: isLoading
      ? undefined
      : ({
          items: Array.from({ length: 3 }, (_, index) => row(index + 1)),
          hasPartialFailure: false,
          hasMore: false,
        } as unknown as WorkItemsResult),
    isLoading,
    isError: false,
    realtimeProjectId: "project-a",
    realtimeStatus: {
      projectId: "project-a",
      status: "connecting" as WorkItemRealtimeStatus,
    },
    sort,
    dir: "asc" as const,
    onSortChange: vi.fn(),
    onRealtimeAvailabilityChange: vi.fn(),
    onRetry: vi.fn(),
  };
}

describe("grouped list first paint (G11 work-list LCP)", () => {
  beforeEach(() => {
    vi.resetModules();
    // Registered per test (after the module reset), so its factory runs when the panel imports
    // the grouped list's module: it counts when that download starts.
    vi.doMock("./work-item-kaneo-list", () => {
      testState.kaneoListImports += 1;
      return {
        default: () => (
          <div data-testid="work-item-list-populated">Kaneo grouped list</div>
        ),
      };
    });
    testState.kaneoListImports = 0;
    testState.states = [{ id: "backlog", name: "Backlog", group: "backlog" }];
    testState.statesLoading = false;
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
    vi.useRealTimers();
    Reflect.deleteProperty(document, "fonts");
  });

  it("paints the preview first and starts the list's download only after that paint", async () => {
    const { default: WorkItemsPanel } = await import("./work-items-panel");
    render(<WorkItemsPanel {...panelProps({})} />);
    await flushMicrotasks();

    expect(screen.getByTestId("work-item-list-preview")).toBeInTheDocument();
    expect(screen.queryByText("Kaneo grouped list")).toBeNull();
    expect(testState.kaneoListImports).toBe(0);

    // The preview's frame, then the next one: it has been presented.
    await advanceAnimationFrame();
    await advanceAnimationFrame();
    await flushMicrotasks();

    expect(testState.kaneoListImports).toBe(1);
    expect(await screen.findByText("Kaneo grouped list")).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-list-preview")).toBeNull();
  });

  it("does not start the list's download while the rows that decide the preview load", async () => {
    const { default: WorkItemsPanel } = await import("./work-items-panel");
    render(<WorkItemsPanel {...panelProps({ isLoading: true })} />);
    await flushMicrotasks();
    await advanceAnimationFrame();
    await advanceAnimationFrame();
    await flushMicrotasks();

    expect(screen.getByTestId("work-item-list-loading")).toBeInTheDocument();
    expect(testState.kaneoListImports).toBe(0);
  });

  it("starts the list's download at once when no preview can stand in for it", async () => {
    const { default: WorkItemsPanel } = await import("./work-items-panel");
    // Manual (position) order is ranked by the list itself, so it never previews.
    render(
      <WorkItemsPanel {...panelProps({ isLoading: true, sort: "position" })} />,
    );
    await flushMicrotasks();

    expect(testState.kaneoListImports).toBe(1);
    expect(frameCallbacks.size).toBe(0);
  });

  it("starts the list's download once the rows load without a previewable state", async () => {
    testState.states = undefined;
    const { default: WorkItemsPanel } = await import("./work-items-panel");
    render(<WorkItemsPanel {...panelProps({})} />);
    await flushMicrotasks();

    expect(testState.kaneoListImports).toBe(1);
    expect(await screen.findByText("Kaneo grouped list")).toBeInTheDocument();
  });

  describe("with the web font still loading", () => {
    function stubFonts() {
      const font: { resolve?: () => void } = {};
      const fonts = {
        check: vi.fn(() => false),
        load: vi.fn(
          () =>
            new Promise<unknown[]>((resolve) => {
              font.resolve = () => resolve([]);
            }),
        ),
      };
      Object.defineProperty(document, "fonts", {
        value: fonts,
        configurable: true,
      });
      return { fonts, font };
    }

    it("paints the preview in the web font, so its rows never change size afterwards", async () => {
      const { fonts, font } = stubFonts();
      const { default: WorkItemsPanel } = await import("./work-items-panel");
      render(<WorkItemsPanel {...panelProps({})} />);
      await flushMicrotasks();
      await advanceAnimationFrame();
      await advanceAnimationFrame();
      await flushMicrotasks();

      expect(fonts.load).toHaveBeenCalledWith(
        '400 14px "Geist Variable"',
        "Seeded",
      );
      expect(screen.getByTestId("work-item-list-loading")).toBeInTheDocument();
      expect(screen.queryByTestId("work-item-list-preview")).toBeNull();
      // The list's download waits for the preview too, so it does not slow the font.
      expect(testState.kaneoListImports).toBe(0);

      await act(async () => font.resolve?.());
      expect(screen.getByTestId("work-item-list-preview")).toBeInTheDocument();
      expect(testState.kaneoListImports).toBe(0);
    });

    it("paints the preview without the web font when it does not arrive in time", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      stubFonts();
      const { default: WorkItemsPanel } = await import("./work-items-panel");
      render(<WorkItemsPanel {...panelProps({})} />);
      await flushMicrotasks();
      expect(screen.queryByTestId("work-item-list-preview")).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(1_500);
      });
      expect(screen.getByTestId("work-item-list-preview")).toBeInTheDocument();
    });
  });
});
