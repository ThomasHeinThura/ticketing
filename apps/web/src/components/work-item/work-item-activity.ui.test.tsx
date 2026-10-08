import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, translate } = vi.hoisted(() => ({
  mocks: {
    createComment: vi.fn(),
    updateComment: vi.fn(),
    rows: [] as Array<Record<string, unknown>>,
    cannedResponses: [] as Array<Record<string, unknown>>,
  },
  translate: (key: string, values?: Record<string, unknown>) => {
    if (key === "activity:timeline.deleted") {
      return `Comment deleted by ${String(values?.actor)} on ${String(values?.date)}`;
    }
    return (
      {
        "activity:timeline.edit": "Edit",
        "activity:timeline.save": "Save changes",
        "activity:timeline.cancel": "Cancel",
        "activity:timeline.send": "Send comment",
        "activity:timeline.sending": "Sending",
        "activity:timeline.visibilityLabel": "Comment visibility",
        "activity:timeline.heading": "Activity & comments",
        "activity:comment.leavePlaceholder": "Leave a comment",
        "activity:timeline.internal": "Internal",
        "activity:timeline.public": "Public",
        "activity:timeline.edited": "Edited",
        "common:unknown": "Unknown",
      }[key] ?? key
    );
  },
}));

vi.mock("@taskdesk/ui", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();
  function Tooltip({ children }: { children: ReactNode }) {
    const [open, setOpen] = React.useState(false);
    return React.Children.map(children, (child) =>
      isValidElement(child)
        ? cloneElement(
            child as ReactElement<{
              open?: boolean;
              setOpen?: (open: boolean) => void;
            }>,
            { open, setOpen },
          )
        : child,
    );
  }
  function TooltipTrigger({
    children,
    setOpen,
  }: {
    children: ReactElement;
    setOpen?: (open: boolean) => void;
  }) {
    return cloneElement(children as ReactElement<Record<string, unknown>>, {
      onMouseEnter: () => setOpen?.(true),
      onMouseLeave: () => setOpen?.(false),
      onFocus: () => setOpen?.(true),
      onBlur: () => setOpen?.(false),
    });
  }
  function TooltipContent({
    children,
    open,
  }: {
    children: ReactNode;
    open?: boolean;
  }) {
    return open ? <div role="tooltip">{children}</div> : null;
  }
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) {
    return (
      <select
        aria-label={value === "" ? "Canned response" : "Comment visibility"}
        value={value}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
      >
        {children}
      </select>
    );
  }
  const SelectContent = ({ children }: { children: ReactNode }) => (
    <>{children}</>
  );
  const SelectItem = ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>;
  return {
    ...actual,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger: () => null,
    SelectValue: () => null,
    Tooltip,
    TooltipContent,
    TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger,
  };
});

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => ({ t: translate }) };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.cannedResponses }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/hooks/mutations/work-item/use-create-work-item-comment", () => ({
  default: () => ({
    mutateAsync: mocks.createComment,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/mutations/work-item/use-update-work-item-comment", () => ({
  default: () => ({
    mutateAsync: mocks.updateComment,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-activity", () => ({
  default: () => ({
    data: { pages: [{ data: mocks.rows }] },
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          {
            userId: "user-1",
            personId: "person-1",
            user: { name: "Alice", email: "alice@example.test" },
          },
          {
            userId: "legacy-user",
            personId: null,
            user: { name: "Legacy actor", email: "legacy@example.test" },
          },
        ],
      },
    }),
  }),
);
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock("@/hooks/use-shiki-highlighter-for-code", () => ({
  useShikiHighlighterForCode: () => null,
}));

import WorkItemActivity from "./work-item-activity";

function renderActivity() {
  return render(
    <WorkItemActivity
      workItemKey="OPS-17"
      workspaceId="workspace-1"
      defaultVisibility="internal"
      filter="everything"
      onFilterChange={() => undefined}
    />,
  );
}

function editable(root: HTMLElement) {
  return root.querySelector<HTMLElement>(
    '.ProseMirror[contenteditable="true"]',
  );
}

describe("work item comment editor lifecycle and CA-16 drafts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.createComment.mockReset().mockResolvedValue({});
    mocks.updateComment.mockReset().mockResolvedValue({});
    mocks.rows = [];
    mocks.cannedResponses = [];
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("opens a legacy string-bodied comment with editable Markdown and saves a document", async () => {
    mocks.rows = [
      {
        id: "comment-1",
        workItemId: "work-item-1",
        actorId: "user-1",
        actorType: "person",
        verb: "commented",
        field: null,
        oldValue: null,
        newValue: null,
        payload: null,
        visibility: "internal",
        workflowVersionId: null,
        createdAt: "2026-10-08T10:00:00.000Z",
        kind: "comment",
        body: "**workflow transition note**",
        activityId: "activity-1",
        editedAt: null,
        deletedAt: null,
        deletedBy: null,
      },
    ];
    const view = renderActivity();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => expect(editable(view.container)).not.toBeNull());
    expect(screen.getByText("workflow transition note")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(mocks.updateComment).toHaveBeenCalledOnce());
    expect(mocks.updateComment).toHaveBeenCalledWith({
      id: "comment-1",
      body: expect.objectContaining({ type: "doc" }),
    });
  });

  it("persists a one-character text/document pair and keeps it sendable after reload", async () => {
    const first = renderActivity();
    const composer = await waitFor(() => {
      const node = editable(first.container);
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    composer.querySelector("p")?.append("a");
    fireEvent.input(composer, { inputType: "insertText", data: "a" });

    const key = "taskdesk:comment-draft:user-1:OPS-17";
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
        text?: string;
        document?: { content?: unknown[] };
      } | null;
      expect(saved?.text).toBe("a");
      expect(JSON.stringify(saved?.document)).toContain("a");
    });

    first.unmount();
    const restored = renderActivity();
    await waitFor(() => expect(editable(restored.container)).not.toBeNull());
    const send = within(restored.container).getByRole("button", {
      name: "Send comment",
    });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledOnce());
    expect(mocks.createComment).toHaveBeenCalledWith({
      key: "OPS-17",
      body: expect.objectContaining({ type: "doc" }),
      visibility: "internal",
    });
    expect(JSON.stringify(mocks.createComment.mock.calls[0]?.[0])).toContain(
      '"a"',
    );
  });

  it("persists canned inserts only after text and document match", async () => {
    const cannedDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Canned response body" }],
        },
      ],
    };
    mocks.cannedResponses = [
      {
        id: "canned-1",
        body: cannedDocument,
        visibilityDefault: "internal",
      },
    ];
    const persistedSnapshots: Array<{ text: string; document: unknown }> = [];
    const originalSetItem = window.localStorage.setItem.bind(
      window.localStorage,
    );
    vi.spyOn(window.localStorage, "setItem").mockImplementation(
      (key, value) => {
        if (key.includes("comment-draft")) {
          const record = JSON.parse(value) as {
            text: string;
            document: unknown;
          };
          persistedSnapshots.push(record);
        }
        originalSetItem(key, value);
      },
    );

    const view = renderActivity();
    fireEvent.change(
      within(view.container).getByRole("combobox", { name: "Canned response" }),
      {
        target: { value: "canned-1" },
      },
    );
    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17") ??
          "{}",
      ) as { text: string; document: typeof cannedDocument };
      expect(saved.text).toContain("Canned response body");
      expect(saved.document).toEqual(cannedDocument);
    });
    expect(
      persistedSnapshots.every(
        (snapshot) =>
          snapshot.text.includes("Canned response body") ===
          JSON.stringify(snapshot.document).includes("Canned response body"),
      ),
    ).toBe(true);
    view.unmount();
  });

  it("resolves new person ids and legacy user ids without inventing an actor", async () => {
    mocks.rows = [
      {
        id: "comment-tombstone",
        workItemId: "work-item-1",
        actorId: "user-1",
        actorType: "person",
        verb: "commented",
        field: null,
        oldValue: null,
        newValue: null,
        payload: null,
        visibility: "internal",
        workflowVersionId: null,
        createdAt: "2026-10-08T10:00:00.000Z",
        kind: "comment",
        body: null,
        activityId: "activity-1",
        editedAt: "2026-10-08T10:02:00.000Z",
        deletedAt: "2026-10-08T10:03:00.000Z",
        deletedBy: "legacy-user",
        versions: [
          {
            number: 1,
            body: {
              type: "doc",
              content: [{ type: "paragraph" }],
            },
            editedBy: "person-1",
            createdAt: "2026-10-08T10:01:00.000Z",
          },
          {
            number: 2,
            body: {
              type: "doc",
              content: [{ type: "paragraph" }],
            },
            editedBy: null,
            createdAt: "2026-10-08T10:02:00.000Z",
          },
          {
            number: 3,
            body: {
              type: "doc",
              content: [{ type: "paragraph" }],
            },
            editedBy: "unlinked-person",
            createdAt: "2026-10-08T10:02:30.000Z",
          },
        ],
      },
    ];
    renderActivity();

    expect(
      within(screen.getByTestId("work-item-activity")).getByText(
        /Comment deleted by Legacy actor/,
      ),
    ).toBeInTheDocument();
    const historyTrigger = screen.getAllByRole("button", { name: "Edited" })[0];
    if (!historyTrigger) throw new Error("History trigger is missing");
    fireEvent.mouseEnter(historyTrigger);
    await waitFor(() => expect(screen.getAllByText("Alice")).toHaveLength(2));
    expect(screen.getAllByText("Unknown")).toHaveLength(1);
  });
});
