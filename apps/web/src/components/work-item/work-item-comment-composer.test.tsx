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
  presign: vi.fn(),
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
  useWorkspacePermission: () => ({
    canCreatePublicComments: () => true,
    canCreateInternalComments: () => true,
    canCreateAttachments: () => true,
    isCheckingPermissions: false,
  }),
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
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";
import WorkItemCommentComposer from "./work-item-comment-composer";

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));

const SHARE = "activity:timeline.shareFilesWithCustomer";

function renderComposer(defaultVisibility: "public" | "internal" = "public") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkItemCommentComposer
        workItemKey="OPS-17"
        workspaceId="workspace-1"
        defaultVisibility={defaultVisibility}
      />
    </QueryClientProvider>,
  );
  const composer = screen.getByTestId("work-item-comment-composer");
  return {
    composer,
    queryClient,
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
        within(composer).getByRole("button", {
          name: `activity:timeline.${visibility}`,
        }),
      );
    },
    async send() {
      const send = within(composer).getByRole("button", {
        name: "activity:timeline.send",
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

describe("A-07 share files with the customer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWorkItemUploads();
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
