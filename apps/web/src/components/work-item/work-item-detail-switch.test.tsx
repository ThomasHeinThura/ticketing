import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemDetail, { type WorkItemDetailProps } from "./work-item-detail";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: mocks.update,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));
vi.mock("./work-item-sla", () => ({ default: () => null }));
vi.mock("./work-item-approvals", () => ({ default: () => null }));
vi.mock("./work-item-attachments", () => ({ default: () => null }));
vi.mock("./work-item-activity", () => ({ default: () => null }));
vi.mock("./work-item-properties", () => ({ default: () => null }));
/** The editor double reports typing through `onDocumentChange`, as kaneo's editor does. */
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    onDocumentChange,
  }: {
    onDocumentChange?: (document: unknown) => void;
  }) => (
    // ui-exempt: this test double stands in for kaneo's rich-text editor.
    <textarea
      aria-label="description"
      onChange={(event) =>
        onDocumentChange?.({ type: "doc", text: event.target.value })
      }
    />
  ),
}));

function makeItem(key: string, title: string): WorkItemDetailRow {
  return {
    id: `wi_${key}`,
    projectId: "proj_1",
    workspaceId: "ws_1",
    number: Number(key.split("-")[1]),
    key,
    title,
    description: null,
    stateName: "Backlog",
    stateCategory: "backlog",
    defaultCommentVisibility: "internal",
    priority: "high",
    assigneeId: null,
    assigneeName: null,
    startDate: null,
    dueDate: null,
    version: key === "PROJ-1" ? 3 : 9,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    unavailableFields: [],
  } as unknown as WorkItemDetailRow;
}

const a = makeItem("PROJ-1", "Item A");
const b = makeItem("PROJ-2", "Item B");

function props(item: WorkItemDetailRow): WorkItemDetailProps {
  return {
    item,
    workItemKey: item.key,
    activityFilter: "everything",
    onActivityFilterChange: vi.fn(),
    project: undefined,
    isLoading: false,
    isNotFound: false,
    isError: false,
    onRetry: vi.fn(),
    onAccessLost: vi.fn(),
    variant: "pane",
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.update.mockReset();
  mocks.update.mockResolvedValue({ version: 4 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WorkItemDetail switching items", () => {
  it("flushes A's pending edits against A and carries nothing over to B", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <WorkItemDetail {...props(a)} />
      </QueryClientProvider>,
    );
    const title = () =>
      screen.getByLabelText(
        "workItems:properties.titleLabel",
      ) as HTMLInputElement;
    fireEvent.change(title(), { target: { value: "Typed on A" } });
    fireEvent.focus(screen.getByLabelText("description"));
    fireEvent.change(screen.getByLabelText("description"), {
      target: { value: "Body typed on A" },
    });

    // The pane switches to B (already cached) inside the save pause.
    rerender(
      <QueryClientProvider client={client}>
        <WorkItemDetail {...props(b)} />
      </QueryClientProvider>,
    );
    expect(title().value).toBe("Item B");

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    const calls = mocks.update.mock.calls.map((call) => call[0]);
    // Both saves are A's, serialised on A's scope (the second asserts the version the
    // first one returned).
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "PROJ-1", title: "Typed on A" }),
        expect.objectContaining({
          key: "PROJ-1",
          description: { type: "doc", text: "Body typed on A" },
        }),
      ]),
    );
    expect(calls[0]).toMatchObject({ version: 3 });
    expect(calls.every((call) => call.key === "PROJ-1")).toBe(true);
    expect(title().value).toBe("Item B");
  });
});
