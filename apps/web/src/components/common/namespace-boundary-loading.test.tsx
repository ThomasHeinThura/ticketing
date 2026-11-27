import { readFileSync } from "node:fs";
import path from "node:path";
import en from "@i18n/en-US.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button, ContextMenu } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, type i18n as I18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import usePendingActionDialogStore from "@/store/pending-action-dialog";

const loader = vi.hoisted(() => vi.fn());
const events = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/lib/i18n", () => ({
  whenAllNamespacesLoaded: loader,
  areAllNamespacesLoaded: () => false,
}));
vi.mock("@/components/work-item/work-item-context-menu-content", () => {
  events.list.push("menu-code");
  return { default: () => <p>real menu</p> };
});
vi.mock("@/components/work-item/work-item-side-pane-body", () => {
  events.list.push("pane-code");
  return { default: () => <p>real pane body</p> };
});
vi.mock("@/components/pending-action/pending-action-approval", async () => {
  const { DialogTitle } = await import("@taskdesk/ui");
  return {
    PendingActionApproval: () => <DialogTitle>Real approval title</DialogTitle>,
  };
});
vi.mock(
  "@/components/pending-action/pending-action-terminology-boundary",
  () => ({
    PendingActionTerminologyBoundary: ({ children }: { children: ReactNode }) =>
      children,
  }),
);

let instance: I18n;
let resolve: () => void;
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={instance}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  vi.useFakeTimers();
  events.list.length = 0;
  instance = createInstance();
  await instance.use(initReactI18next).init({
    lng: "en-US",
    fallbackLng: "en-US",
    resources: {
      "en-US": { common: en.common, workItems: en.workItems, tasks: en.tasks },
    },
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  loader.mockReset();
  loader.mockImplementation(() => {
    events.list.push("strings");
    return new Promise<void>((yes) => {
      resolve = yes;
    });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  usePendingActionDialogStore.getState().close();
});

const tick = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

describe("namespace boundary loading", () => {
  it("starts the surface code and the strings together, and the code never waits for strings", async () => {
    const { default: NamespaceBoundary } = await import("./namespace-boundary");
    const preload = vi.fn(() => {
      events.list.push("preload");
      return Promise.resolve();
    });
    render(
      <NamespaceBoundary preload={preload}>
        <p>content</p>
      </NamespaceBoundary>,
      { wrapper: Wrapper },
    );
    // Strings are still pending, yet the code load has already started.
    expect(preload).toHaveBeenCalledTimes(1);
    expect(events.list).toContain("preload");
    expect(events.list).toContain("strings");
    expect(screen.queryByText("content")).toBeNull();
    await act(async () => resolve());
    expect(screen.getByText("content")).toBeVisible();
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("shows no placeholder for a load shorter than the 150 ms delay, then one", async () => {
    const { default: NamespaceBoundary } = await import("./namespace-boundary");
    const seen: boolean[] = [];
    render(
      <NamespaceBoundary
        fallback={(visible) => {
          seen.push(visible);
          return <p data-testid="placeholder">{String(visible)}</p>;
        }}
      >
        <p>content</p>
      </NamespaceBoundary>,
      { wrapper: Wrapper },
    );
    await tick(149);
    expect(seen.every((visible) => !visible)).toBe(true);
    await tick(2);
    expect(screen.getByTestId("placeholder")).toHaveTextContent("true");
    // The strings land right after the placeholder appeared: it stays for the house minimum
    // (300 ms from when it was shown) instead of flashing for a frame, and content waits for it.
    await act(async () => resolve());
    await tick(100);
    expect(screen.getByTestId("placeholder")).toHaveTextContent("true");
    expect(screen.queryByText("content")).toBeNull();
    await tick(250);
    expect(screen.queryByTestId("placeholder")).toBeNull();
    expect(screen.getByText("content")).toBeVisible();
  });

  it("keeps a shown placeholder for at least 300 ms even when the load ends at 160 ms", async () => {
    const { default: NamespaceBoundary } = await import("./namespace-boundary");
    render(
      <NamespaceBoundary
        fallback={(visible) =>
          visible ? <p data-testid="placeholder">loading</p> : null
        }
      >
        <p>content</p>
      </NamespaceBoundary>,
      { wrapper: Wrapper },
    );
    await tick(160);
    expect(screen.getByTestId("placeholder")).toBeVisible();
    await act(async () => resolve());
    await tick(10);
    // Ten milliseconds after the load, the placeholder is still there (no single-frame flash).
    expect(screen.getByTestId("placeholder")).toBeVisible();
    expect(screen.queryByText("content")).toBeNull();
    await tick(300);
    expect(screen.queryByTestId("placeholder")).toBeNull();
    expect(screen.getByText("content")).toBeVisible();
  });

  it("shows an error at once, without waiting for the placeholder minimum", async () => {
    const { default: NamespaceBoundary } = await import("./namespace-boundary");
    loader.mockImplementation(() => Promise.reject(new Error("offline")));
    render(
      <NamespaceBoundary
        fallback={(visible) =>
          visible ? <p data-testid="placeholder">loading</p> : null
        }
      >
        <p>content</p>
      </NamespaceBoundary>,
      { wrapper: Wrapper },
    );
    await tick(0);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("never shows the placeholder when the strings land inside the delay", async () => {
    const { default: NamespaceBoundary } = await import("./namespace-boundary");
    const seen: boolean[] = [];
    render(
      <NamespaceBoundary
        fallback={(visible) => {
          seen.push(visible);
          return null;
        }}
      >
        <p>content</p>
      </NamespaceBoundary>,
      { wrapper: Wrapper },
    );
    await tick(100);
    await act(async () => resolve());
    await tick(500);
    expect(seen).not.toContain(true);
  });
});

describe("context menu placeholder", () => {
  const row = {
    id: "row",
    key: "PROJ-1",
    workspaceId: "w",
    projectId: "p",
    unavailableFields: [],
  };

  it("loads code and strings together, paints a menu-shaped skeleton only after 150 ms, then the real menu", async () => {
    const { default: Menu } = await import(
      "@/components/work-item/work-item-context-menu"
    );
    render(
      <Menu items={[row as never]}>
        <div>
          <div data-task-id="row">
            <Button type="button">Real row</Button>
          </div>
        </div>
      </Menu>,
      { wrapper: Wrapper },
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Real row" }));
    await tick(0);
    // Code and strings are in flight together.
    expect(events.list).toEqual(
      expect.arrayContaining(["menu-code", "strings"]),
    );
    await tick(120);
    expect(screen.queryByTestId("work-item-context-menu-loading")).toBeNull();
    await tick(40);
    const popup = screen.getByTestId("work-item-context-menu-loading");
    const rows = screen.getAllByTestId("work-item-context-menu-loading-row");
    // The controller's own loading menu (copy link + status) is two rows; so is the skeleton.
    expect(rows).toHaveLength(2);
    // Same width and row height tokens as the real menu, so nothing resizes on arrival.
    expect(popup.className).toContain("w-46");
    for (const placeholder of rows) {
      expect(placeholder.className).toContain("min-h-8");
      expect(placeholder.className).toContain("sm:min-h-7");
    }
    const presentation = readFileSync(
      path.resolve(
        __dirname,
        "../kanban-board/task-card-context-menu/task-context-menu-presentation.tsx",
      ),
      "utf8",
    );
    expect(presentation).toContain('className="w-46"');
    const itemSource = readFileSync(
      path.resolve(
        __dirname,
        "../../../../../packages/ui/src/components/context-menu.tsx",
      ),
      "utf8",
    );
    expect(itemSource).toContain("min-h-8");
    expect(itemSource).toContain("sm:min-h-7");
    await act(async () => resolve());
    await tick(350);
    expect(screen.queryByTestId("work-item-context-menu-loading")).toBeNull();
    expect(screen.getByText("real menu")).toBeVisible();
  });

  it("has the geometry of the controller's loading menu, so the handoff neither resizes nor moves the popup", async () => {
    const { default: Presentation } = await import(
      "@/components/kanban-board/task-card-context-menu/task-context-menu-presentation"
    );
    const { default: Skeleton } = await import(
      "@/components/work-item/work-item-context-menu-skeleton"
    );
    const { ContextMenuItem } = await import("@taskdesk/ui");
    const real = render(
      <ContextMenu open>
        <Presentation
          onCopyLink={() => undefined}
          status={<ContextMenuItem disabled>Loading</ContextMenuItem>}
        />
      </ContextMenu>,
      { wrapper: Wrapper },
    );
    const realPopup = document.querySelector(
      "[data-slot=context-menu-content]",
    );
    const realItems = document.querySelectorAll(
      "[data-slot=context-menu-item]",
    );
    const realWidth = realPopup?.className.match(/\bw-\d+\b/)?.[0];
    expect(realItems).toHaveLength(2);
    real.unmount();
    render(
      <ContextMenu open>
        <Skeleton visible />
      </ContextMenu>,
      { wrapper: Wrapper },
    );
    const popup = screen.getByTestId("work-item-context-menu-loading");
    expect(popup.className).toContain(realWidth);
    expect(
      screen.getAllByTestId("work-item-context-menu-loading-row"),
    ).toHaveLength(realItems.length);
    // No separator: the controller's loading menu has none either.
    expect(popup.querySelector("[class*='h-px']")).toBeNull();
  });

  it("is unmounted cleanly: the skeleton popup is a real ContextMenuContent of the same width", async () => {
    const { default: Skeleton } = await import(
      "@/components/work-item/work-item-context-menu-skeleton"
    );
    render(
      <ContextMenu open>
        <Skeleton visible />
      </ContextMenu>,
      { wrapper: Wrapper },
    );
    expect(
      screen.getByTestId("work-item-context-menu-loading").className,
    ).toContain("w-46");
  });
});

describe("deletion approval placeholder", () => {
  it("keeps the dialog mounted, paints the approval's own geometry after 150 ms, then the approval", async () => {
    const { default: Dialog } = await import(
      "@/components/pending-action/pending-action-approval-dialog"
    );
    usePendingActionDialogStore.getState().open("action-1");
    render(<Dialog />, { wrapper: Wrapper });
    await tick(120);
    const dialogBefore = screen.getByRole("dialog");
    // Reserved but invisible inside the delay: no flash, no layout change when it appears.
    expect(screen.getByTestId("pending-action-approval-loading")).toHaveStyle({
      visibility: "hidden",
    });
    await tick(40);
    const panel = screen.getByTestId("pending-action-approval-loading");
    expect(panel).toHaveStyle({ visibility: "visible" });
    // The approval's own loading state that follows is a h-32 panel under a header.
    expect(panel.className).toContain("h-32");
    const approval = readFileSync(
      path.resolve(__dirname, "../pending-action/pending-action-approval.tsx"),
      "utf8",
    );
    expect(approval).toContain('className="h-32 w-full"');
    expect(screen.getByRole("dialog")).toBe(dialogBefore);
    await act(async () => resolve());
    await tick(350);
    expect(screen.queryByTestId("pending-action-approval-loading")).toBeNull();
    expect(screen.getByText("Real approval title")).toBeVisible();
    // Same dialog element: the shell never remounted.
    expect(screen.getByRole("dialog")).toBe(dialogBefore);
  });

  it("is named from the first frame, after a failed load, and by exactly one title once revealed", async () => {
    const { default: Dialog } = await import(
      "@/components/pending-action/pending-action-approval-dialog"
    );
    const titles = () => document.querySelectorAll("[data-slot=dialog-title]");
    usePendingActionDialogStore.getState().open("action-1");
    render(<Dialog />, { wrapper: Wrapper });
    // Loading, inside the delay and after the skeleton appears: an eager-namespace name.
    expect(
      screen.getByRole("dialog", { name: en.common.pendingActionTitle }),
    ).toBeInTheDocument();
    expect(titles()).toHaveLength(1);
    await tick(200);
    expect(
      screen.getByRole("dialog", { name: en.common.pendingActionTitle }),
    ).toBeInTheDocument();
    expect(titles()).toHaveLength(1);
    // Revealed: the approval's own title is the one and only name.
    await act(async () => resolve());
    await tick(350);
    expect(
      screen.getByRole("dialog", { name: "Real approval title" }),
    ).toBeInTheDocument();
    expect(titles()).toHaveLength(1);
  });

  it("keeps the dialog named when the strings fail to load", async () => {
    const { default: Dialog } = await import(
      "@/components/pending-action/pending-action-approval-dialog"
    );
    loader.mockImplementation(() => Promise.reject(new Error("offline")));
    usePendingActionDialogStore.getState().open("action-1");
    render(<Dialog />, { wrapper: Wrapper });
    await tick(0);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: en.common.pendingActionTitle }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll("[data-slot=dialog-title]")).toHaveLength(
      1,
    );
  });
});

describe("deep link straight into a pane", () => {
  it("starts the pane code with the strings, shows the pane shell at once and its skeleton after the delay", async () => {
    const { default: Pane } = await import(
      "@/components/work-item/work-item-side-pane"
    );
    render(<Pane itemKey="PROJ-1" onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    await tick(0);
    expect(events.list).toEqual(
      expect.arrayContaining(["pane-code", "strings"]),
    );
    expect(screen.queryByText("real pane body")).toBeNull();
    await tick(200);
    expect(screen.getByTestId("work-item-detail-loading")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\w+:[\w.]+/);
    await act(async () => resolve());
    await tick(350);
    expect(screen.getByText("real pane body")).toBeVisible();
  });
});
