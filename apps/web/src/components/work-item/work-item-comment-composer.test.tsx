vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
    isError: false,
  }),
}));
vi.mock("@/fetchers/canned-response/list-canned-responses", () => ({
  default: async () => [],
}));
vi.mock("@/fetchers/work-item/get-comment-mention-candidates", () => ({
  default: async () => [],
}));
vi.mock("@/fetchers/work-item/preflight-comment-mentions", () => ({
  default: async () => ({ reachablePersonIds: [], unreachablePersonIds: [] }),
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
import WorkItemCommentComposer from "./work-item-comment-composer";

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
        workItemKey="OPS-17"
        workspaceId="workspace-1"
        projectId={nextOptions.projectId}
        defaultVisibility={nextDefault}
        isCustomerVisible={nextOptions.isCustomerVisible}
        isCustomerVisibilityPending={nextOptions.isCustomerVisibilityPending}
      />
    </QueryClientProvider>
  );
  const view = render(buildTree(defaultVisibility, options));
  const composer = screen.getByTestId("work-item-comment-composer");
  return {
    composer,
    container: view.container,
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
});
