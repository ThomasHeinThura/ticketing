vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

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
    enqueue: vi.fn(),
    noUploads: [] as never[],
    attachments: [] as Array<Record<string, unknown>>,
    fetchCanned: vi.fn(),
    updateComment: vi.fn(),
    preflightRefetch: vi.fn(),
    mentionCandidates: [] as Array<Record<string, unknown>>,
    rows: [] as Array<Record<string, unknown>>,
    activityRead: vi.fn(),
    cannedResponses: [] as Array<Record<string, unknown>>,
    permissions: {
      public: true,
      internal: true,
      checking: false,
      attach: true,
    },
    permissionWorkspaces: [] as Array<string | undefined>,
    activityState: { isLoading: false, isError: false },
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
        "activity:timeline.publicOnly": "Public only",
        "activity:timeline.everything": "Everything",
        "activity:timeline.comments": "Comments",
        "activity:timeline.edited": "Edited",
        "common:people.unknown": "Unknown",
        "tasks:relations.title": "Relations",
        "workItems:relations.types.relates": "relates to",
        "workItems:relations.types.blocked_by": "blocked by",
        "workItems:detail.unavailable": "Unavailable",
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
    items,
    disabled,
  }: {
    value?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    children: ReactNode;
    items?: Array<{ value: string; label: string }>;
  }) {
    const selectedLabel = items?.find((item) => item.value === value)?.label;
    return (
      // ui-exempt: test double for the shared Select value/change contract.
      <select
        disabled={disabled}
        aria-label={value === "" ? "Canned response" : "Comment visibility"}
        value={value}
        data-selected-label={selectedLabel ?? value}
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
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[1] === "comment-mention-candidates") {
      return {
        data: mocks.mentionCandidates,
        isLoading: false,
        isError: false,
      };
    }
    if (queryKey[1] === "attachments") {
      return { data: mocks.attachments, isLoading: false, isError: false };
    }
    if (queryKey[1] === "comment-mention-preflight") {
      return {
        data: { reachablePersonIds: [], unreachablePersonIds: [] },
        isLoading: false,
        isError: false,
        refetch: mocks.preflightRefetch,
      };
    }
    return { data: mocks.cannedResponses, isLoading: false, isError: false };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/fetchers/attachment/work-item-upload-queue", () => ({
  enqueueWorkItemUploads: mocks.enqueue,
  retryWorkItemUpload: vi.fn(),
  dismissWorkItemUpload: vi.fn(),
  getWorkItemUploads: () => mocks.noUploads,
  subscribeWorkItemUploads: () => () => undefined,
}));
vi.mock("@/fetchers/canned-response/list-canned-responses", () => ({
  default: mocks.fetchCanned,
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
  default: (input: unknown) => {
    mocks.activityRead(input);
    return {
      data: { pages: [{ data: mocks.rows }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: mocks.activityState.isLoading,
      isError: mocks.activityState.isError,
      refetch: vi.fn(),
    };
  },
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
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (workspaceId?: string) => {
    mocks.permissionWorkspaces.push(workspaceId);
    return {
      canCreatePublicComments: () => mocks.permissions.public,
      canCreateInternalComments: () => mocks.permissions.internal,
      canCreateAttachments: () => mocks.permissions.attach,
      isCheckingPermissions: mocks.permissions.checking,
    };
  },
}));
vi.mock("@/hooks/use-shiki-highlighter-for-code", () => ({
  useShikiHighlighterForCode: () => null,
}));

import WorkItemActivity from "./work-item-activity";

function renderActivity(
  workspaceId = "workspace-1",
  defaultVisibility: "public" | "internal" = "internal",
) {
  return render(
    <WorkItemActivity
      workItemKey="OPS-17"
      workspaceId={workspaceId}
      defaultVisibility={defaultVisibility}
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
    mocks.enqueue.mockReset();
    mocks.updateComment.mockReset().mockResolvedValue({});
    mocks.preflightRefetch.mockReset().mockResolvedValue({
      data: {
        reachablePersonIds: ["person-mention"],
        unreachablePersonIds: [],
      },
    });
    mocks.rows = [];
    mocks.cannedResponses = [];
    mocks.fetchCanned
      .mockReset()
      .mockImplementation(async () => mocks.cannedResponses);
    mocks.mentionCandidates = [];
    mocks.permissions = {
      public: true,
      internal: true,
      checking: false,
      attach: true,
    };
    mocks.permissionWorkspaces = [];
    mocks.activityState = { isLoading: false, isError: false };
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("keeps the composer above loading, empty and populated history", () => {
    const view = renderActivity();
    const composer = screen.getByTestId("work-item-comment-composer");
    const history = screen.getByRole("list", { name: "Activity & comments" });
    expect(
      Boolean(
        composer.compareDocumentPosition(history) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      within(composer).getByRole("button", { name: "Send comment" }),
    ).toBeDisabled();
    view.unmount();
    mocks.activityState.isLoading = true;
    renderActivity();
    expect(
      Boolean(
        screen
          .getByTestId("work-item-comment-composer")
          .compareDocumentPosition(
            screen.getByTestId("work-item-activity-loading"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("maps the activity filter value to its translated label and resolves permissions for the item's workspace", () => {
    const view = renderActivity("item-workspace-B");
    const filter = within(view.container).getByRole("button", {
      name: /filterLabel|filter/i,
    });

    expect(filter).toHaveTextContent("Everything");
    expect(mocks.permissionWorkspaces).toContain("item-workspace-B");
  });

  it("states the only allowed audience instead of offering a choice", () => {
    mocks.permissions = {
      public: true,
      internal: false,
      checking: false,
      attach: true,
    };
    renderActivity();
    const composer = screen.getByTestId("work-item-comment-composer");
    expect(within(composer).getByText("Public")).toBeInTheDocument();
    expect(
      within(composer).queryByRole("button", { name: "Internal" }),
    ).toBeNull();
    expect(composer.querySelector("[data-visibility]")).toHaveAttribute(
      "data-visibility",
      "public",
    );
  });

  it.each([
    ["internal", "Internal"],
    ["public", "Public"],
  ] as const)(
    "starts the composer on the project's %s default comment visibility (CA-2)",
    (defaultVisibility, label) => {
      renderActivity("workspace-1", defaultVisibility);
      const composer = screen.getByTestId("work-item-comment-composer");

      expect(
        within(composer).getByRole("button", { name: label, pressed: true }),
      ).toBeInTheDocument();
    },
  );

  it("falls back to an allowed visibility when the project default is outside the caller's capability", () => {
    mocks.permissions = {
      public: false,
      internal: true,
      checking: false,
      attach: true,
    };
    renderActivity("workspace-1", "public");
    const composer = screen.getByTestId("work-item-comment-composer");

    expect(composer.querySelector("[data-visibility]")).toHaveAttribute(
      "data-visibility",
      "internal",
    );
  });

  it("CA-1/CA-5: the audience toggle always shows the current choice in a neutral composer, never a warning surface", () => {
    renderActivity("workspace-1", "internal");
    const composer = screen.getByTestId("work-item-comment-composer");
    const notice = within(composer).getByTestId("comment-audience-notice");
    expect(notice).toHaveTextContent("activity:timeline.internalNotice");

    fireEvent.click(within(composer).getByRole("button", { name: "Public" }));

    expect(
      within(composer).getByRole("button", { name: "Public", pressed: true }),
    ).toBeInTheDocument();
    expect(notice).toHaveTextContent("activity:timeline.publicNotice");
    // No Alert (warning/error surface) is rendered for either audience.
    expect(composer.querySelector('[data-slot="alert"]')).toBeNull();
  });

  it("AT-1/CA-15: files chosen or pasted into the composer are staged, then attached to the comment once it exists", async () => {
    mocks.createComment.mockResolvedValue({ id: "comment-new" });
    const view = renderActivity();
    const file = new File(["png"], "screen.png", { type: "image/png" });
    const picker =
      view.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(picker).not.toBeNull();
    fireEvent.change(picker as HTMLInputElement, { target: { files: [file] } });

    // The file is only staged: nothing is uploaded and no comment exists yet.
    expect(await screen.findByText("screen.png")).toBeInTheDocument();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.createComment).not.toHaveBeenCalled();

    // A file alone is sendable (the screenshot-only comment).
    const send = within(view.container).getByRole("button", {
      name: "Send comment",
    });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);

    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledOnce());
    expect(mocks.createComment).toHaveBeenCalledOnce();
    expect(mocks.enqueue.mock.calls[0]?.[0]).toMatchObject({
      itemKey: "OPS-17",
      commentId: "comment-new",
      files: [file],
    });
    // The stored document never carries the local file or a blob URL.
    expect(
      JSON.stringify(mocks.createComment.mock.calls[0]?.[0]),
    ).not.toContain("blob:");
  });

  it("CA-15: a screenshot pasted into the composer is staged as an attachment, never inlined into the document", async () => {
    const view = renderActivity();
    const composer = await waitFor(() => {
      const node = editable(view.container);
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    const screenshot = new File(["png"], "pasted.png", { type: "image/png" });
    fireEvent.paste(composer, {
      clipboardData: {
        files: [screenshot],
        items: [],
        types: ["Files"],
        getData: () => "",
      },
    });
    expect(await screen.findByText("pasted.png")).toBeInTheDocument();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(composer.querySelector("img")).toBeNull();
  });

  it("offers no attach control and stages nothing without the attachment:create capability", () => {
    mocks.permissions = {
      public: true,
      internal: true,
      checking: false,
      attach: false,
    };
    renderActivity();
    expect(
      within(screen.getByTestId("work-item-comment-composer")).queryByRole(
        "button",
        { name: "activity:comment.attachFile" },
      ),
    ).toBeNull();
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
        canEdit: true,
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

  it("resolves fresh insertion context instead of using the cached body", async () => {
    const body = (value: string) => ({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: value }] },
      ],
    });
    mocks.cannedResponses = [
      {
        id: "canned-1",
        body: body("Due 2026-10-21"),
        visibilityDefault: "internal",
      },
    ];
    mocks.fetchCanned.mockResolvedValue([
      {
        id: "canned-1",
        body: body("Due 2026-10-25"),
        visibilityDefault: "internal",
      },
    ]);
    const view = renderActivity();
    fireEvent.change(
      within(view.container).getByRole("combobox", { name: "Canned response" }),
      { target: { value: "canned-1" } },
    );
    await waitFor(() =>
      expect(editable(view.container)?.textContent).toContain("Due 2026-10-25"),
    );
    expect(editable(view.container)?.textContent).not.toContain("2026-10-21");
    expect(mocks.fetchCanned).toHaveBeenCalledWith("OPS-17");
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("preserves the draft on insertion failure and allows a fresh retry", async () => {
    mocks.cannedResponses = [
      {
        id: "canned-1",
        body: { type: "doc", content: [] },
        visibilityDefault: "internal",
      },
    ];
    mocks.fetchCanned.mockRejectedValueOnce(new Error("Access changed"));
    const view = renderActivity();
    // Match an actual user: hydration must settle before typing into Tiptap.
    const editor = await waitFor(() => {
      const node = editable(view.container);
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    fireEvent.input(editor, { target: { textContent: "Keep my draft" } });
    await waitFor(() =>
      expect(
        window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17"),
      ).toContain("Keep my draft"),
    );
    const select = within(view.container).getByRole("combobox", {
      name: "Canned response",
    });
    fireEvent.change(select, { target: { value: "canned-1" } });
    await waitFor(() =>
      expect(within(view.container).getByRole("alert")).toBeTruthy(),
    );
    expect(editor.textContent).toContain("Keep my draft");
    await waitFor(() => expect(select).toBeEnabled());
    mocks.fetchCanned.mockResolvedValueOnce([
      {
        id: "canned-1",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Current retry" }],
            },
          ],
        },
        visibilityDefault: "internal",
      },
    ]);
    fireEvent.change(select, { target: { value: "canned-1" } });
    await waitFor(() =>
      expect(editable(view.container)?.textContent).toContain("Current retry"),
    );
    expect(within(view.container).queryByRole("alert")).toBeNull();
  });

  it("locks editing and sending while resolving and preserves a draft when the template was removed", async () => {
    let finish: (rows: unknown[]) => void = () => undefined;
    mocks.cannedResponses = [
      {
        id: "canned-1",
        body: { type: "doc", content: [] },
        visibilityDefault: "internal",
      },
    ];
    mocks.fetchCanned.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = renderActivity();
    // Match an actual user: hydration must settle before typing into Tiptap.
    const editor = await waitFor(() => {
      const node = editable(view.container);
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    fireEvent.input(editor, { target: { textContent: "Keep pending draft" } });
    await waitFor(() =>
      expect(
        window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17"),
      ).toContain("Keep pending draft"),
    );
    const select = within(view.container).getByRole("combobox", {
      name: "Canned response",
    });
    const send = within(view.container).getByRole("button", {
      name: "Send comment",
    });
    fireEvent.change(select, { target: { value: "canned-1" } });
    await waitFor(() => expect(select).toBeDisabled());
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(mocks.createComment).not.toHaveBeenCalled();
    finish([]);
    await waitFor(() =>
      expect(within(view.container).getByRole("alert")).toBeTruthy(),
    );
    expect(editor.textContent).toContain("Keep pending draft");
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(select).toBeEnabled();
  });

  it("locks the mentioned draft from preflight through comment save", async () => {
    let resolvePreflight: (value: unknown) => void = () => undefined;
    let resolveCreate: (value: unknown) => void = () => undefined;
    mocks.preflightRefetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreflight = resolve;
        }),
    );
    mocks.createComment.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    mocks.mentionCandidates = [
      {
        personId: "person-mention",
        name: "Reachable teammate",
        image: null,
      },
    ];
    const document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Please review " },
            {
              type: "taskdeskMention",
              attrs: { id: "person-mention", label: "Reachable teammate" },
            },
          ],
        },
      ],
    };
    window.localStorage.setItem(
      "taskdesk:comment-draft:user-1:OPS-17",
      JSON.stringify({ text: "Please review @Reachable teammate", document }),
    );
    const view = renderActivity();
    const send = within(view.container).getByRole("button", {
      name: "Send comment",
    });
    const editor = await waitFor(() => {
      const node = editable(view.container);
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });

    fireEvent.click(send);
    await waitFor(() => expect(mocks.preflightRefetch).toHaveBeenCalledOnce());
    expect(send).toBeDisabled();
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(
      JSON.parse(
        window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17") ??
          "null",
      ),
    ).toMatchObject({ text: expect.stringContaining("person-mention") });
    fireEvent.click(send);
    expect(mocks.preflightRefetch).toHaveBeenCalledOnce();
    expect(mocks.createComment).not.toHaveBeenCalled();

    resolvePreflight({
      data: {
        reachablePersonIds: ["person-mention"],
        unreachablePersonIds: [],
      },
    });
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledOnce());
    expect(send).toBeDisabled();
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(
      JSON.parse(
        window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17") ??
          "null",
      ),
    ).toMatchObject({ text: expect.stringContaining("person-mention") });
    fireEvent.click(send);
    expect(mocks.createComment).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.createComment.mock.calls[0]?.[0])).toContain(
      "person-mention",
    );

    resolveCreate({});
    await waitFor(() =>
      expect(editable(view.container)).toHaveAttribute(
        "contenteditable",
        "true",
      ),
    );
    expect(mocks.createComment).toHaveBeenCalledOnce();
    const saved = JSON.parse(
      window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17") ??
        "null",
    ) as { text?: string; document?: unknown } | null;
    expect(saved?.text).toBe("");
    expect(JSON.stringify(saved?.document)).not.toContain("person-mention");
  });

  it("does not claim the timeline is empty while it failed to load", () => {
    mocks.activityState = { isLoading: false, isError: true };
    renderActivity();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "activity:timeline.loadFailed",
    );
    expect(
      screen.queryByText("activity:timeline.empty"),
    ).not.toBeInTheDocument();
  });

  it("shows the empty text only when the load succeeded with no rows", () => {
    renderActivity();

    expect(screen.getByText("activity:timeline.empty")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders row-shaped loading placeholders (G13) with an accessible status", () => {
    mocks.activityState = { isLoading: true, isError: false };
    renderActivity();

    const loading = screen.getByTestId("work-item-activity-loading");
    expect(loading).toHaveAttribute("role", "status");
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveTextContent("activity:timeline.loading");
    expect(loading.querySelectorAll('[data-slot="skeleton"]').length).toBe(12);
    expect(
      screen.queryByText("activity:timeline.empty"),
    ).not.toBeInTheDocument();
  });

  it("moves focus into the editor on Edit and back to the Edit trigger on Cancel and Save", async () => {
    mocks.rows = [
      {
        id: "comment-focus",
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
        canEdit: true,
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "focus me" }],
            },
          ],
        },
        activityId: "activity-1",
        editedAt: null,
        deletedAt: null,
        deletedBy: null,
      },
    ];
    const view = renderActivity();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(editable(view.container)).not.toBeNull());
    await waitFor(() =>
      expect(
        document.activeElement?.closest(".taskdesk-comment-editor-content"),
      ).not.toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(editable(view.container)).not.toBeNull());
    const save = screen.getByRole("button", { name: "Save changes" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(mocks.updateComment).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit" }),
      ),
    );
  });

  it("renders grouped relation additions and removals as human labels without endpoint details", () => {
    const common = {
      workItemId: "work-item-1",
      actorId: "user-1",
      actorType: "person",
      verb: "updated",
      field: "relation",
      payload: null,
      visibility: "internal",
      workflowVersionId: null,
      kind: "activity",
    };
    mocks.rows = [
      {
        ...common,
        id: "relation-remove",
        createdAt: "2026-10-08T10:01:00Z",
        oldValue: {
          type: "relates",
          direction: "outgoing",
          targetId: "private-peer-uuid",
        },
        newValue: null,
      },
      {
        ...common,
        id: "relation-add",
        createdAt: "2026-10-08T10:00:00Z",
        oldValue: null,
        newValue: {
          type: "blocks",
          direction: "incoming",
          targetKey: "SECRET-9",
        },
      },
    ];
    renderActivity();
    const timeline = screen.getByTestId("work-item-activity");
    expect(timeline).toHaveTextContent("Relations: — → blocked by");
    expect(timeline.querySelector("details")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "activity:timeline.groupedChanges" }),
    );
    expect(timeline).toHaveTextContent("Relations: relates to → —");
    expect(timeline).not.toHaveTextContent("private-peer-uuid");
    expect(timeline).not.toHaveTextContent("SECRET-9");
    expect(timeline).not.toHaveTextContent('"direction"');
  });

  it("AT-1/AT-8: shows a comment's own files on its card, never another comment's or the item's panel files", () => {
    const file = (id: string, filename: string, commentId: string | null) => ({
      id,
      workItemId: "work-item-1",
      commentId,
      filename,
      mimeType: filename.endsWith(".png") ? "image/png" : "application/pdf",
      size: 1024,
      state: "ready",
      customerVisible: false,
      uploadedBy: null,
      canDelete: false,
      createdAt: "2026-10-08T10:00:00.000Z",
      deletedAt: null,
    });
    mocks.attachments = [
      file("f1", "screen.png", "comment-1"),
      file("f2", "log.pdf", "comment-1"),
      file("f3", "elsewhere.png", "comment-2"),
      file("f4", "panel-only.pdf", null),
    ];
    const comment = (id: string) => ({
      id,
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
      body: "see attached",
      activityId: null,
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
    });
    mocks.rows = [comment("comment-1"), comment("comment-2")];
    renderActivity();
    const first = document.getElementById("comment-comment-1") as HTMLElement;
    const second = document.getElementById("comment-comment-2") as HTMLElement;
    expect(
      within(first).getByRole("button", {
        name: "workItems:detail.attachments.preview",
      }),
    ).toBeInTheDocument();
    expect(
      within(first).getByRole("link", { name: "log.pdf" }),
    ).toBeInTheDocument();
    expect(within(second).queryByText("screen.png")).toBeNull();
    expect(
      within(second).getByRole("button", {
        name: "workItems:detail.attachments.preview",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("panel-only.pdf")).toBeNull();
    // A deleted comment keeps no files on its tombstone.
    cleanup();
    mocks.rows = [
      {
        ...comment("comment-1"),
        deletedAt: "2026-10-08T11:00:00.000Z",
        deletedBy: "user-1",
      },
    ];
    renderActivity();
    expect(screen.queryByText("screen.png")).toBeNull();
  });

  it("CA-9: names the kind of non-person actor, or the automation that names itself, never a person", () => {
    const row = (id: string, actorType: string, payload: unknown) => ({
      id,
      workItemId: "work-item-1",
      actorId: null,
      actorType,
      verb: "updated",
      field: "priority",
      oldValue: "low",
      newValue: "high",
      payload,
      visibility: "internal",
      workflowVersionId: null,
      createdAt: `2026-10-08T10:0${id.length}:00.000Z`,
      kind: "activity",
    });
    mocks.rows = [
      row("a", "automation", { automationName: "Escalate overdue" }),
      row("bb", "system", null),
      row("ccc", "api_key", null),
      row("dddd", "automation", null),
    ];
    renderActivity();
    const timeline = screen.getByTestId("work-item-activity");
    expect(timeline).toHaveTextContent("Escalate overdue");
    expect(timeline).toHaveTextContent("activity:timeline.actors.system");
    expect(timeline).toHaveTextContent("activity:timeline.actors.apiKey");
    expect(timeline).toHaveTextContent("activity:timeline.actors.automation");
    expect(timeline).not.toHaveTextContent("Unknown");
  });

  it("P6-R1-04: marks imported comment and history rows, and only those", () => {
    const base = {
      workItemId: "work-item-1",
      actorId: null,
      actorType: "system",
      oldValue: null,
      newValue: null,
      payload: null,
      visibility: "internal",
      workflowVersionId: null,
    };
    mocks.rows = [
      {
        ...base,
        id: "imported-comment",
        verb: "commented",
        field: null,
        kind: "comment",
        body: "Historic note",
        activityId: null,
        editedAt: null,
        deletedAt: null,
        deletedBy: null,
        createdAt: "2021-02-03T04:05:06.000Z",
        origin: "imported",
        importedAt: "2026-10-20T10:00:00.000Z",
      },
      {
        ...base,
        id: "imported-history",
        verb: "updated",
        field: "priority",
        oldValue: "low",
        newValue: "high",
        kind: "activity",
        createdAt: "2021-03-04T05:06:07.000Z",
        origin: "imported",
        importedAt: "2026-10-20T10:00:00.000Z",
      },
      {
        ...base,
        id: "native-history",
        verb: "updated",
        field: "priority",
        oldValue: "high",
        newValue: "low",
        kind: "activity",
        createdAt: "2026-10-21T05:06:07.000Z",
        origin: null,
        importedAt: null,
      },
    ];
    renderActivity();
    expect(screen.getAllByTestId("imported-marker")).toHaveLength(2);
    expect(screen.getAllByText("activity:timeline.imported")).toHaveLength(2);
  });

  it("retains the legacy tombstone actor and withholds comment history", async () => {
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
        canEdit: true,
        body: null,
        activityId: "activity-1",
        editedAt: "2026-10-08T10:02:00.000Z",
        deletedAt: "2026-10-08T10:03:00.000Z",
        deletedBy: "legacy-user",
      },
    ];
    renderActivity();

    expect(
      within(screen.getByTestId("work-item-activity")).getByText(
        /Comment deleted by Legacy actor/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Edited/ }),
    ).not.toBeInTheDocument();
  });
  it("requests the scoped comment page and focuses the rendered comment without revealing other rows", () => {
    mocks.rows = [
      {
        id: "comment-deep",
        kind: "comment",
        canEdit: true,
        actorId: "person-1",
        actorType: "person",
        createdAt: "2026-10-08T10:00:00.000Z",
        visibility: "internal",
        body: "Selected comment",
        verb: "commented",
      },
    ];
    render(
      <WorkItemActivity
        workItemKey="OPS-17"
        workspaceId="workspace-1"
        defaultVisibility="internal"
        filter="everything"
        focusedComment="comment-deep"
        onFilterChange={() => undefined}
      />,
    );
    expect(mocks.activityRead).toHaveBeenLastCalledWith({
      key: "OPS-17",
      comment: "comment-deep",
    });
    const comment = document.getElementById("comment-comment-deep");
    expect(comment).toHaveClass("rounded-xl", "bg-card/60");
    expect(comment?.closest('[data-slot="timeline-item"]')).toHaveAttribute(
      "role",
      "listitem",
    );
    expect(comment?.closest('[data-slot="timeline"]')).toHaveAttribute(
      "role",
      "list",
    );
    const editButton = within(comment as HTMLElement).getByRole("button", {
      name: "Edit",
    });
    expect(editButton.querySelector("svg")).not.toBeNull();
    expect(editButton.textContent).toBe("");
    expect(comment).toHaveFocus();
    expect(document.getElementById("comment-comment-deep")).toHaveAttribute(
      "data-focused-comment",
      "true",
    );
  });
  it.each([undefined, false])(
    "does not offer Edit without authoritative permission (%s)",
    (canEdit) => {
      mocks.rows = [
        {
          id: "not-editable",
          kind: "comment",
          actorId: "user-1",
          actorType: "person",
          createdAt: "2026-10-08T10:00:00.000Z",
          visibility: "internal",
          body: "Visible retained comment",
          verb: "commented",
          canEdit,
        },
      ];
      renderActivity();
      expect(screen.getByText("Visible retained comment")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
      expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    },
  );
  it("offers original trash independently of Edit only for authoritative delete permission", () => {
    mocks.rows = [
      {
        id: "can-delete",
        kind: "comment",
        actorId: "user-1",
        actorType: "person",
        createdAt: "2026-10-08T10:00:00.000Z",
        visibility: "internal",
        body: "Retained before confirmation",
        verb: "commented",
        canEdit: false,
        canDelete: true,
      },
    ];
    renderActivity();
    const trash = screen.getByRole("button", {
      name: "common:actions.delete",
    });
    expect(trash.querySelector("svg")).not.toBeNull();
    expect(trash.textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(
      screen.getByText("Retained before confirmation"),
    ).toBeInTheDocument();
  });
  it("renders authoritative canonical author names for read-only viewers without mention-directory access", () => {
    mocks.permissions = {
      public: false,
      internal: false,
      checking: false,
      attach: true,
    };
    mocks.mentionCandidates = [];
    mocks.rows = [
      {
        id: "read-only-history",
        kind: "comment",
        actorId: "legacy-user",
        actorPersonId: "canonical-person",
        actorDisplayName: "Canonical history author",
        actorType: "person",
        createdAt: "2026-10-08T10:00:00.000Z",
        visibility: "internal",
        body: "Readable history",
        verb: "commented",
        canEdit: false,
      },
    ];
    renderActivity();
    expect(
      screen.getByRole("button", { name: /Canonical history author/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
  it("never guesses an ambiguous comment author from the legacy user directory", () => {
    mocks.rows = [
      {
        id: "ambiguous-history",
        kind: "comment",
        actorId: "user-1",
        actorPersonId: null,
        actorDisplayName: null,
        actorType: "person",
        createdAt: "2026-10-08T10:00:00.000Z",
        visibility: "internal",
        body: "Retained ambiguous history",
        verb: "commented",
        canEdit: false,
      },
    ];
    renderActivity();
    expect(screen.getByRole("button", { name: /Unknown/ })).toBeInTheDocument();
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
