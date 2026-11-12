vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A-07 / AT-3 / AT-4: the composer's "Share these files with the customer" Switch. The real
 * upload queue and attachment fetcher run; only the typed API client's presign call is replaced,
 * so the assertions read the exact presign body the browser would send.
 */
const mocks = vi.hoisted(() => ({
  createComment: vi.fn(),
  createCommentState: { isError: false },
  listCannedResponses: vi.fn(),
  getMentionCandidates: vi.fn(),
  preflightMentions: vi.fn(),
  presign: vi.fn(),
  permissionCalls: [] as Array<[string | undefined, string | undefined]>,
  permissions: {
    public: true,
    internal: true,
    attach: true,
    checking: false,
  },
  // Stable identities, as the real hooks give: a fresh object per render re-runs effects.
  translation: { t: (key: string) => key },
  auth: { user: { id: "user-1" } },
  workspace: { data: { id: "workspace-1" } },
  members: { data: { members: [] } },
}));

vi.mock("@taskdesk/libs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@taskdesk/libs")>();
  const workItems = {
    ":key": {
      attachments: {
        $get: vi.fn(),
        presign: { $post: mocks.presign },
      },
    },
  };
  return {
    ...actual,
    client: new Proxy(actual.client, {
      get: (target, property, receiver) =>
        property === "work-items"
          ? workItems
          : Reflect.get(target, property, receiver),
    }),
  };
});
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => mocks.translation };
});
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => mocks.auth,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (workspaceId?: string, projectId?: string) => {
    mocks.permissionCalls.push([workspaceId, projectId]);
    return {
      canCreatePublicComments: () => mocks.permissions.public,
      canCreateInternalComments: () => mocks.permissions.internal,
      canCreateAttachments: () => mocks.permissions.attach,
      isCheckingPermissions: mocks.permissions.checking,
    };
  },
}));
vi.mock("@/hooks/mutations/work-item/use-create-work-item-comment", () => ({
  default: () => ({
    mutateAsync: mocks.createComment,
    isPending: false,
    isError: mocks.createCommentState.isError,
  }),
}));
vi.mock("@/fetchers/canned-response/list-canned-responses", () => ({
  default: (key: string) => mocks.listCannedResponses(key),
}));
vi.mock("@/fetchers/work-item/get-comment-mention-candidates", () => ({
  default: (input: unknown) => mocks.getMentionCandidates(input),
}));
vi.mock("@/fetchers/work-item/preflight-comment-mentions", () => ({
  default: (input: unknown) => mocks.preflightMentions(input),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => mocks.workspace,
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => mocks.members }),
);
vi.mock("@/hooks/use-shiki-highlighter-for-code", () => ({
  useShikiHighlighterForCode: () => null,
}));

import { resetWorkItemUploads } from "@/fetchers/attachment/work-item-upload-queue";
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";
import WorkItemCommentComposer from "./work-item-comment-composer";

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));

const SHARE = "activity:timeline.shareFilesWithCustomer";
const TAB_NAME = {
  public: "activity:timeline.replyToCustomer",
  internal: "activity:timeline.internalNote",
} as const;
const SEND_BUTTON_PATTERN =
  /^activity:timeline\.(sendToCustomer|addInternalNote)$/;

function renderComposer(
  defaultVisibility: "public" | "internal" = "public",
  options: {
    workItemKey?: string;
    projectId?: string;
    isCustomerVisible?: boolean;
    isCustomerVisibilityPending?: boolean;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const buildTree = (
    nextDefault: "public" | "internal",
    nextOptions: typeof options,
  ) => (
    <QueryClientProvider client={queryClient}>
      <WorkItemCommentComposer
        workItemKey={nextOptions.workItemKey ?? "OPS-17"}
        workspaceId="workspace-1"
        projectId={nextOptions.projectId}
        defaultVisibility={nextDefault}
        isCustomerVisible={nextOptions.isCustomerVisible ?? true}
        isCustomerVisibilityPending={nextOptions.isCustomerVisibilityPending}
      />
    </QueryClientProvider>
  );
  const view = render(buildTree(defaultVisibility, options));
  const composer = screen.getByTestId("work-item-comment-composer");
  return {
    composer,
    container: view.container,
    queryClient,
    rerender(
      nextDefault: "public" | "internal" = defaultVisibility,
      nextOptions: typeof options = options,
    ) {
      view.rerender(buildTree(nextDefault, nextOptions));
    },
    async editor() {
      return waitFor(() => {
        const node = view.container.querySelector<HTMLElement>(
          '.ProseMirror[contenteditable="true"]',
        );
        expect(node).not.toBeNull();
        return node as HTMLElement;
      });
    },
    async type(text: string) {
      const node = await this.editor();
      const paragraph = node.querySelector("p");
      if (paragraph) {
        paragraph.textContent = text;
      } else {
        node.textContent = text;
      }
      fireEvent.input(node, { inputType: "insertText", data: text });
      await waitFor(() =>
        expect(
          within(composer).getByRole("button", { name: SEND_BUTTON_PATTERN }),
        ).toBeEnabled(),
      );
      return node;
    },
    stage(name: string) {
      const picker =
        view.container.querySelector<HTMLInputElement>('input[type="file"]');
      if (!picker) throw new Error("The composer has no file input");
      fireEvent.change(picker, {
        target: {
          files: [new File(["%PDF-1.4"], name, { type: "application/pdf" })],
        },
      });
    },
    choose(visibility: "public" | "internal") {
      fireEvent.click(
        within(composer).getByRole("tab", {
          name: TAB_NAME[visibility],
        }),
      );
    },
    async pickCanned(optionLabel: string) {
      const trigger = await within(composer).findByRole("button", {
        name: "activity:timeline.cannedResponses",
      });
      await waitFor(() => expect(trigger).toBeEnabled());
      fireEvent.click(trigger);
      fireEvent.click(await screen.findByRole("button", { name: optionLabel }));
    },
    async send() {
      const send = within(composer).getByRole("button", {
        name: SEND_BUTTON_PATTERN,
      });
      await waitFor(() => expect(send).toBeEnabled());
      fireEvent.click(send);
    },
  };
}

/** The `json` body of each presign call, in order. */
function presignBodies() {
  return mocks.presign.mock.calls.map(
    (call) => (call[0] as { json: Record<string, unknown> }).json,
  );
}

function resetPermissionState() {
  mocks.permissionCalls = [];
  mocks.createCommentState.isError = false;
  mocks.listCannedResponses.mockReset().mockResolvedValue([]);
  mocks.getMentionCandidates.mockReset().mockResolvedValue([]);
  mocks.preflightMentions
    .mockReset()
    .mockResolvedValue({ reachablePersonIds: [], unreachablePersonIds: [] });
  mocks.permissions = {
    public: true,
    internal: true,
    attach: true,
    checking: false,
  };
}

describe("A-07 share files with the customer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWorkItemUploads();
    resetPermissionState();
    mocks.createComment
      .mockReset()
      .mockResolvedValueOnce({ id: "comment-1" })
      .mockResolvedValueOnce({ id: "comment-2" });
    // The presign is refused, so the queue stops after recording the body under test.
    mocks.presign
      .mockReset()
      .mockResolvedValue(new Response("refused", { status: 500 }));
  });

  afterEach(() => {
    cleanup();
    resetWorkItemUploads();
    window.localStorage.clear();
  });

  it("refreshes activity once after adding a comment and again for another person's comment", async () => {
    class Socket {
      static OPEN = 1;
      static current: Socket;
      readyState = 1;
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      constructor() {
        Socket.current = this;
      }
      send() {}
      close() {}
      frame(frame: unknown) {
        this.onmessage?.({ data: JSON.stringify(frame) });
      }
    }
    vi.stubGlobal("WebSocket", Socket);
    try {
      const ui = renderComposer("internal");
      const activity = vi.fn(async () => []);
      function Probe() {
        useQuery({
          queryKey: ["work-items", "activity", "OPS-17"],
          queryFn: activity,
        });
        useNativeWorkItemRealtime(["work_item:OPS-17"]);
        return null;
      }
      render(
        <QueryClientProvider client={ui.queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(activity).toHaveBeenCalledTimes(1));
      act(() => {
        Socket.current.onopen?.();
        Socket.current.frame({ type: "subscribed", topic: "work_item:OPS-17" });
      });
      ui.stage("note.pdf");
      await ui.send();
      await waitFor(() => expect(activity).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(activity).toHaveBeenCalledTimes(2);
      act(() =>
        Socket.current.frame({
          type: "work_item.commented",
          topic: "work_item:OPS-17",
          eventId: "other",
          payload: { key: "OPS-17" },
        }),
      );
      await waitFor(() => expect(activity).toHaveBeenCalledTimes(3));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the Switch only for a public comment with staged files, off by default, and resets it for Internal", async () => {
    const ui = renderComposer("public");
    expect(within(ui.composer).queryByRole("switch", { name: SHARE })).toBe(
      null,
    );

    ui.stage("guide.pdf");
    expect(await screen.findByText("guide.pdf")).toBeVisible();
    const share = within(ui.composer).getByRole("switch", { name: SHARE });
    expect(share).toBeVisible();
    expect(share).not.toBeChecked();

    fireEvent.click(share);
    expect(share).toBeChecked();

    // AT-4: an internal comment's files are never shared, so the choice is not offered...
    ui.choose("internal");
    expect(within(ui.composer).queryByRole("switch", { name: SHARE })).toBe(
      null,
    );
    // ...and it does not come back switched on.
    ui.choose("public");
    expect(
      within(ui.composer).getByRole("switch", { name: SHARE }),
    ).not.toBeChecked();
  });

  it("sends customerVisible only while the Switch is on, and starts the next comment with it off", async () => {
    const ui = renderComposer("public");
    ui.stage("guide.pdf");
    fireEvent.click(
      await within(ui.composer).findByRole("switch", { name: SHARE }),
    );
    await ui.send();
    await waitFor(() => expect(mocks.presign).toHaveBeenCalledTimes(1));
    expect(presignBodies()[0]).toEqual({
      filename: "guide.pdf",
      contentType: "application/pdf",
      size: 8,
      commentId: "comment-1",
      customerVisible: true,
    });

    // After sending, the next comment's files start unshared.
    ui.stage("notes.pdf");
    expect(
      await within(ui.composer).findByRole("switch", { name: SHARE }),
    ).not.toBeChecked();
    await ui.send();
    await waitFor(() => expect(mocks.presign).toHaveBeenCalledTimes(2));
    expect(presignBodies()[1]).toEqual({
      filename: "notes.pdf",
      contentType: "application/pdf",
      size: 8,
      commentId: "comment-2",
    });
    expect(presignBodies()[1]).not.toHaveProperty("customerVisible");
  });

  it("never sends customerVisible for an internal comment's files", async () => {
    const ui = renderComposer("internal");
    ui.stage("internal.pdf");
    expect(await screen.findByText("internal.pdf")).toBeVisible();
    expect(within(ui.composer).queryByRole("switch", { name: SHARE })).toBe(
      null,
    );
    await ui.send();
    await waitFor(() => expect(mocks.presign).toHaveBeenCalledTimes(1));
    expect(presignBodies()[0]).not.toHaveProperty("customerVisible");
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "internal" }),
    );
  });
});

describe("CA-2 default visibility versus CA-16 drafts", () => {
  const DRAFT_KEY = "taskdesk:comment-draft:user-1:OPS-17";
  const shownVisibility = (composer: HTMLElement) =>
    composer
      .querySelector("[data-visibility]")
      ?.getAttribute("data-visibility");

  beforeEach(() => {
    window.localStorage.clear();
    resetWorkItemUploads();
    resetPermissionState();
    mocks.createComment.mockReset().mockResolvedValue({ id: "comment-1" });
    mocks.presign
      .mockReset()
      .mockResolvedValue(new Response("refused", { status: 500 }));
  });

  afterEach(() => {
    cleanup();
    resetWorkItemUploads();
    window.localStorage.clear();
  });

  it("does not remember Public for an empty composer across a reload", async () => {
    const ui = renderComposer("internal");
    await waitFor(() => expect(shownVisibility(ui.composer)).toBe("internal"));
    ui.choose("public");
    expect(shownVisibility(ui.composer)).toBe("public");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();

    cleanup();
    const reloaded = renderComposer("internal");
    await waitFor(() =>
      expect(shownVisibility(reloaded.composer)).toBe("internal"),
    );
  });

  it("ignores the visibility of an empty saved draft but keeps it with draft text", async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ text: "", document: null, visibility: "public" }),
    );
    const empty = renderComposer("internal");
    await waitFor(() =>
      expect(shownVisibility(empty.composer)).toBe("internal"),
    );

    cleanup();
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ text: "Half written", visibility: "public" }),
    );
    const drafted = renderComposer("internal");
    await waitFor(() =>
      expect(shownVisibility(drafted.composer)).toBe("public"),
    );
  });

  it("starts the next comment on the project default after posting", async () => {
    const ui = renderComposer("internal");
    ui.choose("public");
    ui.stage("guide.pdf");
    expect(await screen.findByText("guide.pdf")).toBeVisible();
    await ui.send();
    await waitFor(() =>
      expect(mocks.createComment).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: "public" }),
      ),
    );
    await waitFor(() => expect(shownVisibility(ui.composer)).toBe("internal"));
  });
});

describe("F-11 unmistakable customer reply vs internal note composer", () => {
  const shownCard = (composer: HTMLElement) =>
    composer.querySelector<HTMLElement>("[data-visibility]");

  beforeEach(() => {
    window.localStorage.clear();
    resetWorkItemUploads();
    resetPermissionState();
    mocks.createComment.mockReset().mockResolvedValue({ id: "comment-1" });
    mocks.presign
      .mockReset()
      .mockResolvedValue(new Response("refused", { status: 500 }));
  });

  afterEach(() => {
    cleanup();
    resetWorkItemUploads();
    window.localStorage.clear();
  });

  it("shows segmented Reply to customer / Internal note tabs, mode-specific submit text, audience copy, and warning surface tint in internal mode", () => {
    const ui = renderComposer("internal", { projectId: "project-9" });
    expect(mocks.permissionCalls).toContainEqual(["workspace-1", "project-9"]);

    const tablist = within(ui.composer).getByRole("tablist", {
      name: "activity:timeline.visibilityLabel",
    });
    const publicTab = within(tablist).getByRole("tab", {
      name: "activity:timeline.replyToCustomer",
    });
    const internalTab = within(tablist).getByRole("tab", {
      name: "activity:timeline.internalNote",
    });
    expect(internalTab).toHaveAttribute("aria-selected", "true");
    expect(publicTab).toHaveAttribute("aria-selected", "false");

    const card = shownCard(ui.composer);
    expect(card).toHaveAttribute("data-visibility", "internal");
    expect(card).toHaveClass("border-warning/32", "bg-warning/4");
    expect(
      within(ui.composer).getByTestId("comment-audience-notice"),
    ).toHaveTextContent("activity:timeline.onlyTeamSeesThis");
    expect(
      within(ui.composer).getByRole("button", {
        name: "activity:timeline.addInternalNote",
      }),
    ).toBeInTheDocument();

    ui.choose("public");
    expect(publicTab).toHaveAttribute("aria-selected", "true");
    expect(internalTab).toHaveAttribute("aria-selected", "false");
    expect(card).toHaveAttribute("data-visibility", "public");
    expect(card).toHaveClass("border-border/80", "bg-card/70");
    expect(card).not.toHaveClass("bg-warning/4");
    expect(
      within(ui.composer).getByTestId("comment-audience-notice"),
    ).toHaveTextContent("activity:timeline.visibleToCustomer");
    expect(
      within(ui.composer).getByRole("button", {
        name: "activity:timeline.sendToCustomer",
      }),
    ).toBeInTheDocument();
  });

  it("shows only the single allowed mode when capabilities are limited, and hides when neither mode is allowed", () => {
    mocks.permissions.internal = false;
    mocks.permissions.public = true;
    const publicOnly = renderComposer("internal");
    expect(within(publicOnly.composer).queryByRole("tablist")).toBeNull();
    expect(
      within(publicOnly.composer).getByText(
        "activity:timeline.replyToCustomer",
      ),
    ).toBeVisible();
    expect(
      within(publicOnly.composer).queryByText("activity:timeline.internalNote"),
    ).toBeNull();
    expect(
      within(publicOnly.composer).getByRole("button", {
        name: "activity:timeline.sendToCustomer",
      }),
    ).toBeInTheDocument();
    cleanup();

    mocks.permissions.internal = true;
    mocks.permissions.public = false;
    const internalOnly = renderComposer("public");
    expect(within(internalOnly.composer).queryByRole("tablist")).toBeNull();
    expect(
      within(internalOnly.composer).getByText("activity:timeline.internalNote"),
    ).toBeVisible();
    expect(
      within(internalOnly.composer).queryByText(
        "activity:timeline.replyToCustomer",
      ),
    ).toBeNull();
    expect(shownCard(internalOnly.composer)).toHaveClass(
      "border-warning/32",
      "bg-warning/4",
    );
    expect(
      within(internalOnly.composer).getByRole("button", {
        name: "activity:timeline.addInternalNote",
      }),
    ).toBeInTheDocument();
    cleanup();

    mocks.permissions.internal = false;
    mocks.permissions.public = false;
    const none = renderComposer("internal");
    expect(none.composer).toHaveAttribute("hidden");
  });

  it("offers no public mode at all on items that are not customer-visible", () => {
    const ui = renderComposer("public", { isCustomerVisible: false });
    expect(within(ui.composer).queryByRole("tablist")).toBeNull();
    expect(
      within(ui.composer).queryByText("activity:timeline.replyToCustomer"),
    ).toBeNull();
    expect(
      within(ui.composer).getByText("activity:timeline.internalNote"),
    ).toBeVisible();
    expect(shownCard(ui.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    expect(shownCard(ui.composer)).toHaveClass(
      "border-warning/32",
      "bg-warning/4",
    );
    expect(
      within(ui.composer).getByRole("button", {
        name: "activity:timeline.addInternalNote",
      }),
    ).toBeInTheDocument();
    cleanup();

    // A public-only caller has no permitted mode on a non-customer-visible item.
    mocks.permissions.public = true;
    mocks.permissions.internal = false;
    const publicOnlyOnInternalItem = renderComposer("public", {
      isCustomerVisible: false,
    });
    expect(publicOnlyOnInternalItem.composer).toHaveAttribute("hidden");
  });

  it("never submits when switching mode, keeps draft text, and submits in the current visible mode on Ctrl+Enter and Cmd+Enter", async () => {
    mocks.createComment
      .mockReset()
      .mockResolvedValueOnce({ id: "comment-internal" })
      .mockResolvedValueOnce({ id: "comment-public" });
    const ui = renderComposer("internal");
    const editorNode = await ui.type("Investigating root cause");

    ui.choose("public");
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(editorNode.textContent).toContain("Investigating root cause");

    ui.choose("internal");
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(editorNode.textContent).toContain("Investigating root cause");

    fireEvent.keyDown(editorNode, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ visibility: "internal" }),
    );

    const nextEditor = await ui.type("Fix deployed, please retry");
    ui.choose("public");
    expect(mocks.createComment).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(nextEditor, { key: "Enter", metaKey: true });
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(2));
    expect(mocks.createComment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ visibility: "public" }),
    );
  });

  it("never silently changes mode when project defaultVisibility changes during a refetch while typing", async () => {
    const ui = renderComposer("internal");
    await ui.type("Internal triage notes");
    expect(shownCard(ui.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );

    // Simulate a background refetch where the project's default visibility changed to public.
    ui.rerender("public");
    expect(shownCard(ui.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );

    await ui.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "internal" }),
    );
  });

  it("falls back to Internal note, resets file sharing, and announces the fallback if the item stops being customer-visible while typing", async () => {
    const ui = renderComposer("public", { isCustomerVisible: true });
    const editorNode = await ui.type("Drafting customer answer");
    ui.stage("diagnostic.pdf");
    const share = await within(ui.composer).findByRole("switch", {
      name: SHARE,
    });
    fireEvent.click(share);
    expect(share).toBeChecked();
    expect(shownCard(ui.composer)).toHaveAttribute("data-visibility", "public");

    // Item loses customer visibility mid-composition (e.g. requester cleared or moved to internal project).
    ui.rerender("public", { isCustomerVisible: false });

    await waitFor(() =>
      expect(shownCard(ui.composer)).toHaveAttribute(
        "data-visibility",
        "internal",
      ),
    );
    const notice = within(ui.composer).getByTestId(
      "comment-visibility-fallback-notice",
    );
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent(
      "activity:timeline.customerVisibilityLostFallback",
    );
    expect(within(ui.composer).queryByRole("tablist")).toBeNull();
    expect(within(ui.composer).queryByRole("switch", { name: SHARE })).toBe(
      null,
    );
    expect(editorNode.textContent).toContain("Drafting customer answer");

    await ui.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "internal" }),
    );
    await waitFor(() => expect(mocks.presign).toHaveBeenCalledTimes(1));
    expect(presignBodies()[0]).not.toHaveProperty("customerVisible");
  });

  it("fails closed to internal mode when isCustomerVisible is omitted", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkItemCommentComposer
          workItemKey="OPS-17"
          workspaceId="workspace-1"
          defaultVisibility="public"
        />
      </QueryClientProvider>,
    );
    const composer = screen.getByTestId("work-item-comment-composer");
    expect(within(composer).queryByRole("tablist")).toBeNull();
    expect(shownCard(composer)).toHaveAttribute("data-visibility", "internal");
  });

  it("aborts public submission, prevents duplicate submits, and retains draft and staged files when customer visibility is lost during deferred mention preflight", async () => {
    const mentionDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Looping in " },
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
      JSON.stringify({
        text: "Looping in @Reachable teammate",
        document: mentionDocument,
        visibility: "public",
      }),
    );

    const ui = renderComposer("public", { isCustomerVisible: true });
    await waitFor(() =>
      expect(mocks.preflightMentions).toHaveBeenCalledTimes(1),
    );
    const editorNode = await ui.editor();
    ui.stage("report.pdf");
    const share = await within(ui.composer).findByRole("switch", {
      name: SHARE,
    });
    fireEvent.click(share);
    expect(share).toBeChecked();

    let resolveSubmitPreflight: (value: {
      reachablePersonIds: string[];
      unreachablePersonIds: string[];
    }) => void = () => undefined;
    mocks.preflightMentions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmitPreflight = resolve;
        }),
    );

    await ui.send();
    await waitFor(() =>
      expect(mocks.preflightMentions).toHaveBeenCalledTimes(2),
    );

    const sendingButton = within(ui.composer).getByRole("button", {
      name: "activity:timeline.sending",
    });
    expect(sendingButton).toBeDisabled();
    expect(sendingButton).toHaveAttribute("aria-busy", "true");

    // Second submit via click or keyboard shortcuts while in-flight is impossible.
    fireEvent.click(sendingButton);
    fireEvent.keyDown(editorNode, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(editorNode, { key: "Enter", metaKey: true });
    expect(mocks.preflightMentions).toHaveBeenCalledTimes(2);
    expect(mocks.createComment).not.toHaveBeenCalled();

    // Work item refetch removes customer visibility before mention preflight resolves.
    ui.rerender("public", { isCustomerVisible: false });
    await waitFor(() =>
      expect(shownCard(ui.composer)).toHaveAttribute(
        "data-visibility",
        "internal",
      ),
    );
    expect(
      within(ui.composer).getByTestId("comment-visibility-fallback-notice"),
    ).toHaveAttribute("role", "status");

    // Resolving preflight must NOT post publicly (or at all) and must keep the draft + files.
    resolveSubmitPreflight({
      reachablePersonIds: ["person-mention"],
      unreachablePersonIds: [],
    });
    await waitFor(() =>
      expect(
        within(ui.composer).getByRole("button", {
          name: "activity:timeline.addInternalNote",
        }),
      ).toBeEnabled(),
    );
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();
    expect(screen.getByText("report.pdf")).toBeVisible();
    expect(
      JSON.parse(
        window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17") ??
          "{}",
      ),
    ).toMatchObject({
      text: expect.stringContaining("Looping in"),
      visibility: "internal",
    });

    // Only an explicit send in the new visible mode posts an internal note.
    await ui.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "internal" }),
    );
    await waitFor(() => expect(mocks.presign).toHaveBeenCalledTimes(1));
    expect(presignBodies()[0]).not.toHaveProperty("customerVisible");
  });

  it("aborts submission during deferred mention preflight if public capability is revoked or the item changes, and blocks duplicate submits during mutateAsync", async () => {
    const mentionDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ping " },
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
      JSON.stringify({
        text: "Ping @Reachable teammate",
        document: mentionDocument,
        visibility: "public",
      }),
    );

    const ui = renderComposer("public", { isCustomerVisible: true });
    await waitFor(() =>
      expect(mocks.preflightMentions).toHaveBeenCalledTimes(1),
    );

    let resolveSubmitPreflight: (value: {
      reachablePersonIds: string[];
      unreachablePersonIds: string[];
    }) => void = () => undefined;
    mocks.preflightMentions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmitPreflight = resolve;
        }),
    );

    await ui.send();
    await waitFor(() =>
      expect(mocks.preflightMentions).toHaveBeenCalledTimes(2),
    );

    // Revoke public capability while preflight is still awaiting.
    mocks.permissions.public = false;
    ui.rerender("public", { isCustomerVisible: true });

    resolveSubmitPreflight({
      reachablePersonIds: ["person-mention"],
      unreachablePersonIds: [],
    });
    await waitFor(() =>
      expect(
        within(ui.composer).getByTestId(
          "comment-visibility-unavailable-notice",
        ),
      ).toHaveAttribute("role", "status"),
    );
    expect(mocks.createComment).not.toHaveBeenCalled();

    // Explicitly switch to internal note, then verify createComment in-flight lock.
    let resolveCreate: (value: { id: string }) => void = () => undefined;
    mocks.createComment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    fireEvent.click(
      within(ui.composer).getByRole("button", {
        name: "activity:timeline.keepAsInternalNote",
      }),
    );
    expect(shownCard(ui.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );

    const editorNode = await ui.editor();
    await ui.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(editorNode, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(editorNode, { key: "Enter", metaKey: true });
    expect(mocks.createComment).toHaveBeenCalledTimes(1);

    resolveCreate({ id: "comment-internal" });
    await waitFor(() =>
      expect(
        within(ui.composer).getByRole("button", {
          name: "activity:timeline.addInternalNote",
        }),
      ).toBeDisabled(),
    );
  });

  it("blocks sending and requires an explicit choice with status notice when internal capability is revoked mid-draft (text or attachments) or when restoring an internal draft under public-only permission", async () => {
    const ui = renderComposer("internal");
    const editorNode = await ui.type("Confidential incident details");
    expect(shownCard(ui.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );

    // Capability refresh removes internal note permission while retaining public reply permission.
    mocks.permissions.internal = false;
    mocks.permissions.public = true;
    ui.rerender("internal");

    // Audience intent stays internal (tinted); composer never silently flips to public.
    expect(shownCard(ui.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    expect(shownCard(ui.composer)).toHaveClass(
      "border-warning/32",
      "bg-warning/4",
    );
    const notice = within(ui.composer).getByTestId(
      "comment-visibility-unavailable-notice",
    );
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent(
      "activity:timeline.internalVisibilityUnavailableCanReply",
    );

    const disabledSend = within(ui.composer).getByRole("button", {
      name: "activity:timeline.addInternalNote",
    });
    expect(disabledSend).toBeDisabled();
    fireEvent.keyDown(editorNode, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(editorNode, { key: "Enter", metaKey: true });
    expect(mocks.createComment).not.toHaveBeenCalled();

    // Explicit choice unlocks sending as a public reply.
    fireEvent.click(
      within(notice).getByRole("button", {
        name: "activity:timeline.switchToReplyToCustomer",
      }),
    );
    expect(
      within(ui.composer).queryByTestId(
        "comment-visibility-unavailable-notice",
      ),
    ).toBeNull();
    expect(shownCard(ui.composer)).toHaveAttribute("data-visibility", "public");
    await ui.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "public" }),
    );
    cleanup();
    window.localStorage.clear();
    mocks.createComment.mockReset().mockResolvedValue({ id: "comment-2" });

    // Attachments-only internal draft also stays internal and blocks sending if internal capability is revoked.
    resetPermissionState();
    const attachDraft = renderComposer("internal");
    attachDraft.stage("internal-logs.pdf");
    expect(await screen.findByText("internal-logs.pdf")).toBeVisible();
    mocks.permissions.internal = false;
    mocks.permissions.public = true;
    attachDraft.rerender("internal");
    expect(shownCard(attachDraft.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    expect(
      within(attachDraft.composer).getByTestId(
        "comment-visibility-unavailable-notice",
      ),
    ).toHaveAttribute("role", "status");
    expect(
      within(attachDraft.composer).getByRole("button", {
        name: "activity:timeline.addInternalNote",
      }),
    ).toBeDisabled();
    cleanup();
    window.localStorage.clear();

    // Restoring a saved internal draft for a public-only caller preserves internal intent and blocks send until chosen.
    resetPermissionState();
    mocks.permissions.public = true;
    mocks.permissions.internal = false;
    window.localStorage.setItem(
      "taskdesk:comment-draft:user-1:OPS-17",
      JSON.stringify({
        text: "Saved staff-only note",
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Saved staff-only note" }],
            },
          ],
        },
        visibility: "internal",
      }),
    );
    const restored = renderComposer("public");
    const restoredEditor = await restored.editor();
    expect(shownCard(restored.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    const restoredNotice = within(restored.composer).getByTestId(
      "comment-visibility-unavailable-notice",
    );
    expect(restoredNotice).toHaveAttribute("role", "status");
    expect(restoredNotice).toHaveTextContent(
      "activity:timeline.internalVisibilityUnavailableCanReply",
    );
    expect(
      within(restored.composer).getByRole("button", {
        name: "activity:timeline.addInternalNote",
      }),
    ).toBeDisabled();
    fireEvent.keyDown(restoredEditor, { key: "Enter", ctrlKey: true });
    expect(mocks.createComment).not.toHaveBeenCalled();

    fireEvent.click(
      within(restoredNotice).getByRole("button", {
        name: "activity:timeline.switchToReplyToCustomer",
      }),
    );
    expect(shownCard(restored.composer)).toHaveAttribute(
      "data-visibility",
      "public",
    );
    await restored.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "public" }),
    );
    cleanup();
    window.localStorage.clear();

    // Revoking both capabilities mid-draft keeps the draft visible and blocks sending.
    resetPermissionState();
    const bothRevoked = renderComposer("internal");
    await bothRevoked.type("Do not lose my work");
    mocks.permissions.public = false;
    mocks.permissions.internal = false;
    bothRevoked.rerender("internal");
    expect(bothRevoked.composer).not.toHaveAttribute("hidden");
    expect(
      within(bothRevoked.composer).getByTestId(
        "comment-visibility-unavailable-notice",
      ),
    ).toHaveTextContent("activity:timeline.commentVisibilityUnavailableNone");
    expect(
      within(bothRevoked.composer).getByRole("button", {
        name: "activity:timeline.addInternalNote",
      }),
    ).toBeDisabled();
  });

  it("preserves mode on canned-response insertion for any in-progress draft (text or staged attachments) in both directions, announces empty-composer changes, and supports retry after insertion or send errors", async () => {
    const doc = (text: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const templates = [
      {
        id: "tpl-public",
        name: "Public greeting",
        body: doc("Hello from support"),
        visibilityDefault: "public",
      },
      {
        id: "tpl-internal",
        name: "Internal checklist",
        body: doc("Escalation checklist"),
        visibilityDefault: "internal",
      },
    ];
    mocks.listCannedResponses.mockResolvedValue(templates);

    // 1. Internal attachments-only draft + public template -> stays internal, no silent upgrade.
    const internalAttach = renderComposer("internal");
    internalAttach.stage("diagnostics.pdf");
    expect(await screen.findByText("diagnostics.pdf")).toBeVisible();
    await internalAttach.pickCanned("Public greeting");
    await waitFor(() =>
      expect(internalAttach.container.textContent).toContain(
        "Hello from support",
      ),
    );
    expect(shownCard(internalAttach.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    expect(
      within(internalAttach.composer).queryByTestId(
        "comment-canned-visibility-notice",
      ),
    ).toBeNull();
    cleanup();
    window.localStorage.clear();

    // 2. Public attachments-only draft + internal template -> stays public, no silent downgrade.
    resetPermissionState();
    mocks.listCannedResponses.mockResolvedValue(templates);
    const publicAttach = renderComposer("public");
    publicAttach.stage("invoice.pdf");
    expect(await screen.findByText("invoice.pdf")).toBeVisible();
    await publicAttach.pickCanned("Internal checklist");
    await waitFor(() =>
      expect(publicAttach.container.textContent).toContain(
        "Escalation checklist",
      ),
    );
    expect(shownCard(publicAttach.composer)).toHaveAttribute(
      "data-visibility",
      "public",
    );
    expect(
      within(publicAttach.composer).queryByTestId(
        "comment-canned-visibility-notice",
      ),
    ).toBeNull();
    cleanup();
    window.localStorage.clear();

    // 3. Public text draft + internal template -> stays public, no silent flip.
    resetPermissionState();
    mocks.listCannedResponses.mockResolvedValue(templates);
    const publicText = renderComposer("public");
    await publicText.type("Initial reply");
    await publicText.pickCanned("Internal checklist");
    await waitFor(() =>
      expect(publicText.container.textContent).toContain(
        "Escalation checklist",
      ),
    );
    expect(shownCard(publicText.composer)).toHaveAttribute(
      "data-visibility",
      "public",
    );
    cleanup();
    window.localStorage.clear();

    // 4. Internal text draft + public template -> stays internal, plus retry after insertion and send failures.
    resetPermissionState();
    mocks.listCannedResponses
      .mockResolvedValueOnce(templates)
      .mockRejectedValueOnce(new Error("Temporary network error"))
      .mockResolvedValue(templates);
    const retryFlow = renderComposer("internal");
    await retryFlow.type("Draft before error");

    await retryFlow.pickCanned("Public greeting");
    expect(
      await within(retryFlow.composer).findByRole("alert"),
    ).toHaveTextContent("activity:timeline.cannedResponseInsertFailed");
    expect(shownCard(retryFlow.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    expect(retryFlow.container.textContent).toContain("Draft before error");

    // Retry insertion succeeds and preserves internal mode.
    await retryFlow.pickCanned("Public greeting");
    await waitFor(() =>
      expect(retryFlow.container.textContent).toContain("Hello from support"),
    );
    expect(within(retryFlow.composer).queryByRole("alert")).toBeNull();
    expect(shownCard(retryFlow.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );

    // Send fails once -> draft and internal mode stay intact -> retry succeeds.
    mocks.createComment
      .mockReset()
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce({ id: "comment-recovered" });
    mocks.createCommentState.isError = true;
    await retryFlow.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(shownCard(retryFlow.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    expect(retryFlow.container.textContent).toContain("Hello from support");

    mocks.createCommentState.isError = false;
    retryFlow.rerender("internal");
    await retryFlow.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(2));
    expect(mocks.createComment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ visibility: "internal" }),
    );
    cleanup();
    window.localStorage.clear();

    // 5. Empty composer: internal template on public composer announces downgrade; public template on internal composer stays internal and offers explicit switch.
    resetPermissionState();
    mocks.listCannedResponses.mockResolvedValue(templates);
    const emptyPublic = renderComposer("public");
    await emptyPublic.pickCanned("Internal checklist");
    await waitFor(() =>
      expect(shownCard(emptyPublic.composer)).toHaveAttribute(
        "data-visibility",
        "internal",
      ),
    );
    const downgradeNotice = within(emptyPublic.composer).getByTestId(
      "comment-canned-visibility-notice",
    );
    expect(downgradeNotice).toHaveAttribute("role", "status");
    expect(downgradeNotice).toHaveTextContent(
      "activity:timeline.cannedResponseSwitchedToInternal",
    );
    cleanup();
    window.localStorage.clear();

    resetPermissionState();
    mocks.listCannedResponses.mockResolvedValue(templates);
    const emptyInternal = renderComposer("internal");
    await emptyInternal.pickCanned("Public greeting");
    await waitFor(() =>
      expect(emptyInternal.container.textContent).toContain(
        "Hello from support",
      ),
    );
    expect(shownCard(emptyInternal.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    const choiceNotice = within(emptyInternal.composer).getByTestId(
      "comment-canned-visibility-notice",
    );
    expect(choiceNotice).toHaveAttribute("role", "status");
    expect(choiceNotice).toHaveTextContent(
      "activity:timeline.cannedResponsePublicChoiceNotice",
    );
    fireEvent.click(
      within(choiceNotice).getByRole("button", {
        name: "activity:timeline.switchToReplyToCustomer",
      }),
    );
    expect(shownCard(emptyInternal.composer)).toHaveAttribute(
      "data-visibility",
      "public",
    );
    expect(
      within(emptyInternal.composer).queryByTestId(
        "comment-canned-visibility-notice",
      ),
    ).toBeNull();
  });

  it("stays hidden across permission-loading and customer-visibility-loading transitions and supports keyboard/focus navigation on the audience segmented control", async () => {
    mocks.permissions.checking = true;
    const loading = renderComposer("public", {
      isCustomerVisible: false,
      isCustomerVisibilityPending: true,
    });
    expect(loading.composer).toHaveAttribute("hidden");

    // Permissions settle first while project customer-visibility is still loading -> still hidden.
    mocks.permissions.checking = false;
    loading.rerender("public", {
      isCustomerVisible: false,
      isCustomerVisibilityPending: true,
    });
    expect(loading.composer).toHaveAttribute("hidden");

    // Project resolves as internal-only -> initializes directly into internal mode with no fallback warning.
    loading.rerender("public", {
      isCustomerVisible: false,
      isCustomerVisibilityPending: false,
    });
    await waitFor(() => expect(loading.composer).not.toHaveAttribute("hidden"));
    expect(shownCard(loading.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );
    expect(
      within(loading.composer).queryByTestId(
        "comment-visibility-fallback-notice",
      ),
    ).toBeNull();
    cleanup();
    window.localStorage.clear();

    // Keyboard & focus navigation across the two-option segmented control:
    // Arrow/Home/End move focus without accidentally flipping to public; Space activates the focused tab without submitting.
    resetPermissionState();
    const kb = renderComposer("internal", { isCustomerVisible: true });
    await kb.type("Keyboard navigation check");

    const publicTab = within(kb.composer).getByRole("tab", {
      name: "activity:timeline.replyToCustomer",
    });
    const internalTab = within(kb.composer).getByRole("tab", {
      name: "activity:timeline.internalNote",
    });

    internalTab.focus();
    expect(internalTab).toHaveFocus();
    expect(internalTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(internalTab, { key: "ArrowLeft" });
    await waitFor(() => expect(publicTab).toHaveFocus());
    expect(publicTab).toHaveAttribute("aria-selected", "false");
    expect(shownCard(kb.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );

    fireEvent.keyDown(publicTab, { key: " " });
    expect(publicTab).toHaveAttribute("aria-selected", "true");
    expect(shownCard(kb.composer)).toHaveAttribute("data-visibility", "public");

    fireEvent.keyDown(publicTab, { key: "ArrowRight" });
    await waitFor(() => expect(internalTab).toHaveFocus());
    expect(internalTab).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(internalTab, { key: " " });
    expect(internalTab).toHaveAttribute("aria-selected", "true");
    expect(shownCard(kb.composer)).toHaveAttribute(
      "data-visibility",
      "internal",
    );

    fireEvent.keyDown(internalTab, { key: "Home" });
    await waitFor(() => expect(publicTab).toHaveFocus());

    fireEvent.keyDown(publicTab, { key: "End" });
    await waitFor(() => expect(internalTab).toHaveFocus());

    // Navigating or activating tabs via keyboard never submits the comment.
    fireEvent.keyDown(internalTab, { key: "Enter" });
    fireEvent.keyUp(internalTab, { key: "Enter" });
    fireEvent.keyDown(internalTab, { key: " " });
    fireEvent.keyUp(internalTab, { key: " " });
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("presents only internal chrome with an unavailable-draft status notice and blocks submit until Keep as internal note when an internal-only caller restores a saved public draft", async () => {
    const savedBody = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Customer follow-up draft" }],
        },
      ],
    };
    const assertInternalChromeAndBlockedPublicDraft = async (
      ui: ReturnType<typeof renderComposer>,
    ) => {
      const editorNode = await ui.editor();
      expect(editorNode.textContent).toContain("Customer follow-up draft");

      const card = shownCard(ui.composer);
      expect(card).toHaveAttribute("data-visibility", "internal");
      expect(card).toHaveClass("border-warning/32", "bg-warning/4");
      expect(within(ui.composer).queryByRole("tablist")).toBeNull();
      expect(
        within(ui.composer).getByText("activity:timeline.internalNote"),
      ).toBeVisible();
      expect(
        within(ui.composer).getByTestId("comment-audience-notice"),
      ).toHaveTextContent("activity:timeline.onlyTeamSeesThis");

      const sendButton = within(ui.composer).getByRole("button", {
        name: "activity:timeline.addInternalNote",
      });
      expect(sendButton).toBeDisabled();

      // No public header, button label, or customer-visibility claim anywhere in the composer.
      expect(
        within(ui.composer).queryByText("activity:timeline.replyToCustomer"),
      ).toBeNull();
      expect(
        within(ui.composer).queryByText("activity:timeline.sendToCustomer"),
      ).toBeNull();
      expect(
        within(ui.composer).queryByText("activity:timeline.visibleToCustomer"),
      ).toBeNull();
      expect(
        within(ui.composer).queryByText(
          "activity:timeline.shareFilesWithCustomer",
        ),
      ).toBeNull();

      const notice = within(ui.composer).getByTestId(
        "comment-visibility-unavailable-notice",
      );
      expect(notice).toHaveAttribute("role", "status");
      expect(notice).toHaveTextContent(
        "activity:timeline.publicVisibilityUnavailableCanNote",
      );
      const noticeButtons = within(notice).getAllByRole("button");
      expect(noticeButtons).toHaveLength(1);
      expect(noticeButtons[0]).toHaveAccessibleName(
        "activity:timeline.keepAsInternalNote",
      );

      // Submit is blocked via button click, Ctrl+Enter, and Cmd+Enter.
      fireEvent.click(sendButton);
      fireEvent.keyDown(editorNode, { key: "Enter", ctrlKey: true });
      fireEvent.keyDown(editorNode, { key: "Enter", metaKey: true });
      expect(mocks.createComment).not.toHaveBeenCalled();

      return { editorNode, notice };
    };

    // 1. Capabilities already settled as internal-only when the saved public draft restores.
    mocks.permissions.public = false;
    mocks.permissions.internal = true;
    window.localStorage.setItem(
      "taskdesk:comment-draft:user-1:OPS-17",
      JSON.stringify({
        text: "Customer follow-up draft",
        document: savedBody,
        visibility: "public",
      }),
    );

    const restored = renderComposer("public", { isCustomerVisible: true });
    restored.stage("triage-notes.pdf");
    expect(await screen.findByText("triage-notes.pdf")).toBeVisible();
    const { editorNode, notice } =
      await assertInternalChromeAndBlockedPublicDraft(restored);

    fireEvent.click(
      within(notice).getByRole("button", {
        name: "activity:timeline.keepAsInternalNote",
      }),
    );
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(
      within(restored.composer).queryByTestId(
        "comment-visibility-unavailable-notice",
      ),
    ).toBeNull();
    const keptNotice = within(restored.composer).getByTestId(
      "comment-kept-internal-notice",
    );
    expect(keptNotice).toHaveAttribute("role", "status");
    expect(keptNotice).toHaveTextContent(
      "activity:timeline.draftKeptAsInternalNote",
    );
    expect(editorNode.textContent).toContain("Customer follow-up draft");
    expect(screen.getByText("triage-notes.pdf")).toBeVisible();
    expect(
      JSON.parse(
        window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17") ??
          "{}",
      ),
    ).toMatchObject({
      text: "Customer follow-up draft",
      visibility: "internal",
    });

    await restored.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenCalledWith({
      key: "OPS-17",
      body: savedBody,
      visibility: "internal",
    });
    await waitFor(() => expect(mocks.presign).toHaveBeenCalledTimes(1));
    expect(presignBodies()[0]).not.toHaveProperty("customerVisible");
    cleanup();
    window.localStorage.clear();
    mocks.createComment.mockReset().mockResolvedValue({ id: "comment-2" });
    mocks.presign
      .mockReset()
      .mockResolvedValue(new Response("refused", { status: 500 }));

    // 2. Capabilities finish loading as internal-only after mount with a saved public draft.
    resetPermissionState();
    mocks.permissions.checking = true;
    mocks.permissions.public = false;
    mocks.permissions.internal = true;
    window.localStorage.setItem(
      "taskdesk:comment-draft:user-1:OPS-17",
      JSON.stringify({
        text: "Customer follow-up draft",
        document: savedBody,
        visibility: "public",
      }),
    );

    const delayed = renderComposer("public", { isCustomerVisible: true });
    expect(delayed.composer).toHaveAttribute("hidden");
    expect(
      within(delayed.composer).queryByText("activity:timeline.replyToCustomer"),
    ).toBeNull();
    expect(
      within(delayed.composer).queryByText("activity:timeline.sendToCustomer"),
    ).toBeNull();
    expect(
      within(delayed.composer).queryByText(
        "activity:timeline.visibleToCustomer",
      ),
    ).toBeNull();

    mocks.permissions.checking = false;
    delayed.rerender("public", { isCustomerVisible: true });
    await waitFor(() => expect(delayed.composer).not.toHaveAttribute("hidden"));
    const { notice: delayedNotice } =
      await assertInternalChromeAndBlockedPublicDraft(delayed);

    fireEvent.click(
      within(delayedNotice).getByRole("button", {
        name: "activity:timeline.keepAsInternalNote",
      }),
    );
    await delayed.send();
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenCalledWith({
      key: "OPS-17",
      body: savedBody,
      visibility: "internal",
    });
  });

  it("presents only internal chrome, preserves body and staged files, and blocks submit until Keep as internal note when public capability is revoked mid-draft", async () => {
    const ui = renderComposer("public", { isCustomerVisible: true });
    const editorNode = await ui.type("Drafted while customer reply allowed");
    ui.stage("customer-pack.pdf");
    const shareSwitch = await within(ui.composer).findByRole("switch", {
      name: SHARE,
    });
    fireEvent.click(shareSwitch);
    expect(shareSwitch).toBeChecked();

    const bodyBeforeRevocation = JSON.parse(
      window.localStorage.getItem("taskdesk:comment-draft:user-1:OPS-17") ??
        "{}",
    ).document;
    expect(bodyBeforeRevocation).toBeTruthy();

    // Public capability is revoked while the public draft is open (including a permission re-check).
    mocks.permissions.checking = true;
    ui.rerender("public", { isCustomerVisible: true });
    expect(ui.composer).toHaveAttribute("hidden");

    mocks.permissions.checking = false;
    mocks.permissions.public = false;
    mocks.permissions.internal = true;
    ui.rerender("public", { isCustomerVisible: true });
    expect(ui.composer).not.toHaveAttribute("hidden");

    const card = shownCard(ui.composer);
    expect(card).toHaveAttribute("data-visibility", "internal");
    expect(card).toHaveClass("border-warning/32", "bg-warning/4");
    expect(within(ui.composer).queryByRole("tablist")).toBeNull();
    expect(
      within(ui.composer).getByText("activity:timeline.internalNote"),
    ).toBeVisible();
    expect(
      within(ui.composer).getByTestId("comment-audience-notice"),
    ).toHaveTextContent("activity:timeline.onlyTeamSeesThis");

    const sendButton = within(ui.composer).getByRole("button", {
      name: "activity:timeline.addInternalNote",
    });
    expect(sendButton).toBeDisabled();

    // No public mode chrome or customer-visibility claim anywhere in the composer.
    expect(
      within(ui.composer).queryByText("activity:timeline.replyToCustomer"),
    ).toBeNull();
    expect(
      within(ui.composer).queryByText("activity:timeline.sendToCustomer"),
    ).toBeNull();
    expect(
      within(ui.composer).queryByText("activity:timeline.visibleToCustomer"),
    ).toBeNull();
    expect(within(ui.composer).queryByRole("switch", { name: SHARE })).toBe(
      null,
    );
    expect(
      within(ui.composer).queryByText(
        "activity:timeline.shareFilesWithCustomer",
      ),
    ).toBeNull();
    expect(screen.getByText("customer-pack.pdf")).toBeVisible();

    const notice = within(ui.composer).getByTestId(
      "comment-visibility-unavailable-notice",
    );
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent(
      "activity:timeline.publicVisibilityUnavailableCanNote",
    );
    const noticeButtons = within(notice).getAllByRole("button");
    expect(noticeButtons).toHaveLength(1);
    expect(noticeButtons[0]).toHaveAccessibleName(
      "activity:timeline.keepAsInternalNote",
    );

    // Submit stays blocked by button and by Ctrl/Cmd+Enter until Keep as internal note is pressed.
    fireEvent.click(sendButton);
    fireEvent.keyDown(editorNode, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(editorNode, { key: "Enter", metaKey: true });
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();

    fireEvent.click(noticeButtons[0]);
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(
      within(ui.composer).queryByTestId(
        "comment-visibility-unavailable-notice",
      ),
    ).toBeNull();
    const keptNotice = within(ui.composer).getByTestId(
      "comment-kept-internal-notice",
    );
    expect(keptNotice).toHaveAttribute("role", "status");
    expect(keptNotice).toHaveTextContent(
      "activity:timeline.draftKeptAsInternalNote",
    );
    expect(editorNode.textContent).toContain(
      "Drafted while customer reply allowed",
    );
    expect(screen.getByText("customer-pack.pdf")).toBeVisible();
    expect(sendButton).toBeEnabled();

    fireEvent.keyDown(editorNode, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(mocks.createComment).toHaveBeenCalledTimes(1));
    expect(mocks.createComment).toHaveBeenCalledWith({
      key: "OPS-17",
      body: bodyBeforeRevocation,
      visibility: "internal",
    });
    await waitFor(() => expect(mocks.presign).toHaveBeenCalledTimes(1));
    expect(presignBodies()[0]).not.toHaveProperty("customerVisible");
  });
});
