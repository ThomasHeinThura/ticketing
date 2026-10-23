import { Button } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import useProjectStore from "@/store/project";
import { Route } from "./$id";

function fillTypedNameAndPassword() {
  fireEvent.change(
    screen.getByLabelText("pendingActions:registered.confirmName"),
    { target: { value: "Apollo" } },
  );
  fireEvent.change(
    screen.getByLabelText("pendingActions:dynamic.accountPassword"),
    { target: { value: "test-only-password" } },
  );
}

const mocks = vi.hoisted(() => ({
  id: "action-a",
  changed: (() => {}) as () => void,
  proof: vi.fn(),
  approve: vi.fn(),
  cancel: vi.fn(),
  clickContract: false,
  comment: false,
  malformedComment: false,
  commentDeleted: false,
  attachment: false,
  mismatchedAttachment: false,
  bulkCount: 0,
  bulkStepUp: false,
  bulkExecuted: false,
  duplicateKeys: false,
  workItem: false,
  relation: false,
  relationRedacted: false,
  loading: false,
  registered: "",
  registeredRedacted: false,
  navigate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => ({
    options,
    useParams: () => ({ id: mocks.id }),
  }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({
    pathname: "/agent/settings/profile/pending-actions/pa-1",
  }),
  Link: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === "me" && queryKey[1] === "pending-action") {
      return {
        data: mocks.loading ? undefined : actionFor(String(queryKey[2])),
        isLoading: mocks.loading,
        isError: false,
      };
    }
    if (queryKey[0] === "god-mode")
      return {
        data: { enabled: false, required: false },
        isLoading: false,
        isError: false,
      };
    return {
      data: { email: "a@example.test" },
      isLoading: false,
      isError: false,
    };
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (value: unknown) => Promise<unknown>;
  }) => ({
    isPending: false,
    mutateAsync: (value: unknown) => mutationFn(value),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: vi.fn(),
  getInstanceUser: vi.fn(),
}));
vi.mock("@/fetchers/pending-actions", () => ({
  approveOwnPendingAction: (value: unknown) => mocks.approve(value),
  cancelOwnPendingAction: (value: unknown) => mocks.cancel(value),
  createPendingActionProof: (...args: unknown[]) => mocks.proof(...args),
  getOwnPendingAction: vi.fn(),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock("@/hooks/queries/god-mode/use-instance-users", () => ({
  instanceUsersKey: ["instance-users"],
}));

function registeredActionFor(id: string) {
  const typed =
    mocks.registered === "project" || mocks.registered === "workspace";
  return {
    id,
    action: "delete",
    targetType: mocks.registered,
    summary: mocks.registeredRedacted
      ? { redacted: true, targetCount: 1 }
      : { name: "Apollo", projectName: "Platform" },
    targetIds: ["target-a"],
    approvalSupported: true,
    confirmation: typed ? "typed_name_step_up" : "click",
    state: "pending",
    origin: "web",
    expiresAt: "2026-10-12T00:00:00.000Z",
  };
}

function actionFor(id: string) {
  if (mocks.registered) return registeredActionFor(id);
  return {
    id,
    action: mocks.bulkCount ? "bulk_delete" : "delete",
    targetType: mocks.attachment
      ? "attachment"
      : mocks.comment
        ? "comment"
        : mocks.bulkCount
          ? "work_item"
          : mocks.workItem
            ? "work_item"
            : mocks.relation
              ? "relation"
              : mocks.clickContract
                ? "saved_view"
                : "user",
    summary: mocks.relationRedacted
      ? { redacted: true, targetCount: 1 }
      : mocks.attachment
        ? {
            attachmentId: "file-a",
            filename: "certificate.pdf",
            mimeType: "application/pdf",
            size: 2048,
            key: "HELP-4",
            title: "Certificate rotation",
            recoveryHours: 24,
            alreadyDeleted: false,
          }
        : mocks.comment
          ? mocks.malformedComment
            ? {
                commentId: "comment-a",
                key: "HELP-4",
                title: "Certificate rotation",
                visibility: "internal",
              }
            : {
                commentId: "comment-a",
                key: "HELP-4",
                title: "Certificate rotation",
                visibility: "internal",
                alreadyDeleted: mocks.commentDeleted,
                commentBody: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Exact internal comment to delete",
                        },
                      ],
                    },
                  ],
                },
              }
          : mocks.bulkCount
            ? {
                affectedCount: mocks.bulkCount,
                selection: {
                  kind: "keys",
                  keys: Array.from(
                    { length: mocks.bulkCount },
                    (_, i) => `HELP-${mocks.duplicateKeys ? 1 : i + 1}`,
                  ),
                },
                childrenAffected: 0,
                representativeTargets: [
                  {
                    key: "HELP-1",
                    title: "Disposable first item",
                    projectName: "Support",
                  },
                ],
                projects: [
                  { id: "proj", name: "Support", count: mocks.bulkCount },
                ],
                failed: [{ id: "MISSING-1", reason: "Work item not found" }],
                ...(mocks.bulkExecuted
                  ? {
                      result: {
                        succeeded: ["HELP-1"],
                        failed: [{ id: "HELP-2", reason: "Write failed" }],
                      },
                    }
                  : {}),
              }
            : mocks.workItem
              ? {
                  key: "HELP-4",
                  title: "Certificate rotation",
                  childrenAffected: 2,
                }
              : mocks.relation
                ? {
                    sourceKey: "HELP-4",
                    sourceTitle: "Certificate rotation",
                    targetKey: "HELP-7",
                    targetTitle: "Analytics refresh",
                    relationType: "blocks",
                  }
                : {},
    targetIds: [
      mocks.attachment
        ? mocks.mismatchedAttachment
          ? "different-file"
          : "file-a"
        : mocks.comment
          ? "comment-a"
          : "target-a",
    ],
    approvalSupported: !mocks.relationRedacted,
    confirmation: mocks.bulkCount
      ? mocks.bulkStepUp
        ? "typed_count_step_up"
        : "typed_count"
      : mocks.clickContract
        ? "click"
        : "typed_name_step_up",
    state: mocks.bulkExecuted ? "executed" : "pending",
    origin: "web",
    expiresAt: "2026-10-12T00:00:00.000Z",
  };
}

function Harness() {
  const [, rerender] = useState(0);
  mocks.changed = () => rerender((value) => value + 1);
  const RouteComponent = Route.options.component;
  if (!RouteComponent)
    throw new Error("Pending-action detail route component is missing");
  return <RouteComponent />;
}

function RoutedHarness() {
  const [mounted, setMounted] = useState(true);
  return mounted ? (
    <>
      <Harness />
      <Button type="button" onClick={() => setMounted(false)}>
        leave
      </Button>
    </>
  ) : null;
}

async function flushContext() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("pending action detail intent lifecycle", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    mocks.id = "action-a";
    mocks.clickContract = false;
    mocks.comment = false;
    mocks.malformedComment = false;
    mocks.commentDeleted = false;
    mocks.attachment = false;
    mocks.mismatchedAttachment = false;
    mocks.bulkCount = 0;
    mocks.bulkStepUp = false;
    mocks.bulkExecuted = false;
    mocks.duplicateKeys = false;
    mocks.workItem = false;
    mocks.relation = false;
    mocks.relationRedacted = false;
    mocks.loading = false;
    mocks.registered = "";
    mocks.registeredRedacted = false;
    mocks.proof.mockReset();
    mocks.approve.mockReset().mockResolvedValue(undefined);
    mocks.cancel.mockReset().mockResolvedValue(undefined);
    mocks.navigate.mockReset().mockResolvedValue(undefined);
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
  });

  it("renders the loading skeleton in a full-width main so it is visible inside the flex shell", () => {
    // Real-browser measurement (#670 r3): the loading <main> sat in a flex row
    // and shrank to its padding (64px wide), giving the w-full skeleton width 0.
    mocks.loading = true;
    render(<Harness />);
    // The shell's inset is the page's <main>; the page renders a busy div root inside it.
    const main = document.querySelector('[aria-busy="true"]');
    expect(main?.className).toMatch(/\bw-full\b/u);
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it("does not approve after A→B→A while the proof request is pending", async () => {
    let finishProof: ((value: string) => void) | undefined;
    mocks.proof.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishProof = resolve;
        }),
    );
    render(<Harness />);
    fireEvent.change(
      screen.getByLabelText("pendingActions:copy.c65f42061785"),
      { target: { value: "a@example.test" } },
    );
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "first-secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pendingActions:copy.a2b52d875e8b" }),
    );
    await waitFor(() => expect(mocks.proof).toHaveBeenCalledOnce());

    act(() => {
      mocks.id = "action-b";
      mocks.changed();
    });
    await flushContext();
    act(() => {
      mocks.id = "action-a";
      mocks.changed();
    });
    await flushContext();
    await act(async () => finishProof?.("proof-from-abandoned-a"));

    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("keeps fresh form values and suppresses a stale proof error", async () => {
    let rejectProof: ((error: Error) => void) | undefined;
    mocks.proof.mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectProof = reject;
        }),
    );
    render(<Harness />);
    fireEvent.change(
      screen.getByLabelText("pendingActions:copy.c65f42061785"),
      { target: { value: "a@example.test" } },
    );
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "old-secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pendingActions:copy.a2b52d875e8b" }),
    );
    await waitFor(() => expect(mocks.proof).toHaveBeenCalledOnce());
    act(() => {
      mocks.id = "action-b";
      mocks.changed();
    });
    await flushContext();
    expect(
      screen.getByLabelText("pendingActions:copy.c65f42061785"),
    ).toHaveValue("");
    expect(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
    ).toHaveValue("");
    act(() => {
      mocks.id = "action-a";
      mocks.changed();
    });
    await flushContext();
    fireEvent.change(
      screen.getByLabelText("pendingActions:copy.c65f42061785"),
      { target: { value: "a@example.test" } },
    );
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "fresh-secret" } },
    );
    await act(async () => rejectProof?.(new Error("stale proof failure")));
    expect(
      screen.queryByRole("alert", {
        name: "pendingActions:dynamic.approvalFailed",
      }),
    ).toBeNull();
    expect(
      screen.getByLabelText("pendingActions:copy.c65f42061785"),
    ).toHaveValue("a@example.test");
    expect(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
    ).toHaveValue("fresh-secret");
  });

  it("does not publish a submitted approval completion into a returned detail context", async () => {
    let finishProof: ((value: string) => void) | undefined;
    let finishApproval: (() => void) | undefined;
    mocks.proof.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishProof = resolve;
        }),
    );
    mocks.approve.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishApproval = resolve;
        }),
    );
    render(<Harness />);
    fireEvent.change(
      screen.getByLabelText("pendingActions:copy.c65f42061785"),
      { target: { value: "a@example.test" } },
    );
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "old-secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pendingActions:copy.a2b52d875e8b" }),
    );
    await waitFor(() => expect(mocks.proof).toHaveBeenCalledOnce());
    await act(async () => finishProof?.("proof-for-submitted-a"));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledOnce());
    act(() => {
      mocks.id = "action-b";
      mocks.changed();
    });
    await flushContext();
    act(() => {
      mocks.id = "action-a";
      mocks.changed();
    });
    await flushContext();
    fireEvent.change(
      screen.getByLabelText("pendingActions:copy.c65f42061785"),
      { target: { value: "a@example.test" } },
    );
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "fresh-secret" } },
    );
    await act(async () => finishApproval?.());
    expect(
      screen.queryByText("pendingActions:dynamic.deactivationApproved"),
    ).toBeNull();
    expect(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
    ).toHaveValue("fresh-secret");
  });

  it("does not publish a delayed cancellation result after changing action id", async () => {
    let finishCancel: (() => void) | undefined;
    mocks.cancel.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "pendingActions:copy.84837a216817" }),
    );
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
    act(() => {
      mocks.id = "action-b";
      mocks.changed();
    });
    await flushContext();
    await act(async () => finishCancel?.());
    expect(screen.queryByText("pendingActions:dynamic.cancelled")).toBeNull();
  });

  it("does not submit a pending-action approval after the detail route unmounts", async () => {
    let finishProof: ((value: string) => void) | undefined;
    mocks.proof.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishProof = resolve;
        }),
    );
    render(<RoutedHarness />);
    fireEvent.change(
      screen.getByLabelText("pendingActions:copy.c65f42061785"),
      { target: { value: "a@example.test" } },
    );
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "route-secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pendingActions:copy.a2b52d875e8b" }),
    );
    await waitFor(() => expect(mocks.proof).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "leave" }));
    await act(async () => finishProof?.("proof-after-unmount"));
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("shows both relation endpoints and approves through the pending-action contract", async () => {
    mocks.clickContract = true;
    mocks.relation = true;
    render(<Harness />);
    expect(screen.getByText(/HELP-4 · Certificate rotation/)).toHaveTextContent(
      "HELP-7 · Analytics refresh",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:relations.removeRelation" }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({ id: "action-a" }),
    );
    expect(mocks.proof).not.toHaveBeenCalled();
  });

  it("hides endpoint details and removal when current access is redacted", () => {
    mocks.clickContract = true;
    mocks.relation = true;
    mocks.relationRedacted = true;
    render(<Harness />);
    expect(screen.getByText("workItems:relations.hidden")).toBeInTheDocument();
    expect(screen.queryByText(/HELP-4|HELP-7/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tasks:relations.removeRelation" }),
    ).not.toBeInTheDocument();
  });

  it("shows the frozen item and child warning before confirming deletion", async () => {
    mocks.clickContract = true;
    mocks.workItem = true;
    render(<Harness />);
    expect(
      screen.getByText("HELP-4 · Certificate rotation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workItems:deletion.childrenAffected"),
    ).toBeInTheDocument();
    expect(screen.queryByText("target-a")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({ id: "action-a" }),
    );
    expect(mocks.proof).not.toHaveBeenCalled();
  });

  it("keeps a redacted work-item target anonymous and unapprovable", () => {
    mocks.clickContract = true;
    mocks.workItem = true;
    mocks.relationRedacted = true;
    render(<Harness />);
    expect(screen.getByText("workItems:deletion.hidden")).toBeInTheDocument();
    expect(
      screen.queryByText(/HELP-4|Certificate rotation|target-a/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "common:actions.delete" }),
    ).not.toBeInTheDocument();
  });

  it("requires the exact frozen count before confirming a bulk deletion", async () => {
    mocks.bulkCount = 2;
    render(<Harness />);
    const approve = screen.getByRole("button", {
      name: "common:actions.delete",
    });
    expect(approve).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("pendingActions:bulk.confirmCount"),
      { target: { value: "1" } },
    );
    expect(approve).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("pendingActions:bulk.confirmCount"),
      { target: { value: "2" } },
    );
    fireEvent.click(approve);
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        id: "action-a",
        typedCount: "2",
      }),
    );
    expect(mocks.proof).not.toHaveBeenCalled();
  });

  it("requires fresh authentication for a batch above fifty and binds the proof to that action", async () => {
    mocks.bulkCount = 51;
    mocks.bulkStepUp = true;
    mocks.proof.mockResolvedValue("proof-for-batch");
    render(<Harness />);
    fireEvent.change(
      screen.getByLabelText("pendingActions:bulk.confirmCount"),
      { target: { value: "51" } },
    );
    const approve = screen.getByRole("button", {
      name: "common:actions.delete",
    });
    expect(approve).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "test-only-password" } },
    );
    fireEvent.click(approve);
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        id: "action-a",
        typedCount: "51",
        stepUpToken: "proof-for-batch",
      }),
    );
    expect(mocks.proof).toHaveBeenCalledWith({
      pendingActionId: "action-a",
      method: "password",
      secret: "test-only-password",
    });
  });

  it("does not expose or confirm a redacted batch", () => {
    mocks.bulkCount = 2;
    mocks.relationRedacted = true;
    render(<Harness />);
    expect(screen.getByText("workItems:deletion.hidden")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("pendingActions:bulk.confirmCount"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("target-a")).not.toBeInTheDocument();
  });

  it("shows persisted per-item results after execution, including failures", () => {
    mocks.bulkCount = 2;
    mocks.bulkExecuted = true;
    render(<Harness />);
    expect(
      screen.getByRole("status", { name: "pendingActions:bulk.result" }),
    ).toHaveTextContent("HELP-1");
    expect(
      screen.getByRole("status", { name: "pendingActions:bulk.result" }),
    ).toHaveTextContent("HELP-2 · Write failed");
    expect(
      screen.getByText("MISSING-1 · Work item not found"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("HELP-1 · Disposable first item"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("pendingActions:bulk.confirmCount"),
    ).not.toBeInTheDocument();
  });

  it("refuses a malformed batch containing duplicate keys", () => {
    mocks.bulkCount = 2;
    mocks.duplicateKeys = true;
    render(<Harness />);
    expect(screen.getByText("workItems:deletion.hidden")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("pendingActions:bulk.confirmCount"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("MISSING-1 · Work item not found"),
    ).not.toBeInTheDocument();
  });

  it("preserves the empty-body click-confirmation contract", async () => {
    mocks.clickContract = true;
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({ id: "action-a" }),
    );
    expect(mocks.proof).not.toHaveBeenCalled();
  });

  it("requires the exact name and fresh authentication before a project deletion", async () => {
    mocks.registered = "project";
    mocks.proof.mockResolvedValue("proof-for-project");
    render(<Harness />);
    const approve = screen.getByRole("button", {
      name: "common:actions.delete",
    });
    expect(approve).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("pendingActions:registered.confirmName"),
      {
        target: { value: "apollo" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "test-only-password" } },
    );
    expect(approve).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("pendingActions:registered.confirmName"),
      {
        target: { value: "Apollo" },
      },
    );
    fireEvent.click(approve);
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        id: "action-a",
        typedName: "Apollo",
        stepUpToken: "proof-for-project",
      }),
    );
    expect(mocks.proof).toHaveBeenCalledWith({
      pendingActionId: "action-a",
      method: "password",
      secret: "test-only-password",
    });
  });

  it("requires the exact name and fresh authentication before a workspace deletion", async () => {
    mocks.registered = "workspace";
    mocks.proof.mockResolvedValue("proof-for-workspace");
    render(<Harness />);
    fireEvent.change(
      screen.getByLabelText("pendingActions:registered.confirmName"),
      {
        target: { value: "Apollo" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("pendingActions:dynamic.accountPassword"),
      { target: { value: "test-only-password" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        id: "action-a",
        typedName: "Apollo",
        stepUpToken: "proof-for-workspace",
      }),
    );
  });

  it.each([
    "label",
    "project_label",
    "column",
    "canned_response",
    "milestone",
    "prerequisite",
    "document_link",
    "workspace_role",
    "invitation",
  ])(
    "approves a %s deletion with the empty-body click contract",
    async (type) => {
      mocks.registered = type;
      render(<Harness />);
      expect(screen.getByText("Apollo · Platform")).toBeInTheDocument();
      expect(
        screen.queryByLabelText("pendingActions:registered.confirmName"),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "common:actions.delete" }),
      );
      await waitFor(() =>
        expect(mocks.approve).toHaveBeenCalledWith({ id: "action-a" }),
      );
      expect(mocks.proof).not.toHaveBeenCalled();
      // The approval makes every registered-target cache stale, and refetches them all.
      await waitFor(() => {
        const invalidated = mocks.invalidate.mock.calls.map(
          ([filters]) =>
            filters as { queryKey: string[]; refetchType?: string },
        );
        for (const key of [
          "projects",
          "workspaces",
          "workspace",
          "workspace-roles",
          "workspace-invites",
          "workspace-users",
          "active-workspace-users",
          "labels",
          "project-labels",
          "columns",
          "canned-responses",
          "tasks",
        ])
          expect(invalidated).toContainEqual({
            queryKey: [key],
            refetchType: "all",
          });
        expect(invalidated).toContainEqual({
          queryKey: ["me", "pending-actions"],
        });
      });
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it("leaves a deleted workspace for the dashboard, as the old flow did", async () => {
    mocks.registered = "workspace";
    mocks.proof.mockResolvedValue("proof");
    mocks.approve.mockResolvedValue({ id: "action-a", state: "executed" });
    useProjectStore.setState({ project: { id: "p" } as never });
    render(<Harness />);
    fillTypedNameAndPassword();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard" }),
    );
    expect(useProjectStore.getState().project).toBeUndefined();
  });

  it("leaves a deleted project for its workspace and clears the active project", async () => {
    mocks.registered = "project";
    mocks.proof.mockResolvedValue("proof");
    mocks.approve.mockResolvedValue({ id: "action-a", state: "executed" });
    useProjectStore.setState({ project: { id: "p" } as never });
    render(<Harness />);
    fillTypedNameAndPassword();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: "workspace-1" },
      }),
    );
    expect(useProjectStore.getState().project).toBeUndefined();
  });

  it("stays put when the approval did not reach executed", async () => {
    mocks.registered = "project";
    mocks.proof.mockResolvedValue("proof");
    mocks.approve.mockResolvedValue({ id: "action-a", state: "expired" });
    useProjectStore.setState({ project: { id: "p" } as never });
    render(<Harness />);
    fillTypedNameAndPassword();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() => expect(mocks.approve).toHaveBeenCalled());
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project).toEqual({ id: "p" });
  });

  it.each([
    [429, "step_up_attempt_limit", "pendingActions:stepUp.attemptLimit"],
    [403, "step_up_unavailable", "pendingActions:stepUp.proofRejected"],
    [403, "Forbidden", "pendingActions:stepUp.forbidden"],
    [409, "Pending action unavailable", "pendingActions:staleApproval"],
    [500, "boom", "pendingActions:approvalFailed"],
  ])(
    "explains a %i %s refusal of the fresh-authentication step",
    async (status, message, key) => {
      mocks.registered = "project";
      mocks.proof.mockRejectedValue(new HttpError(status, message));
      render(<Harness />);
      fillTypedNameAndPassword();
      fireEvent.click(
        screen.getByRole("button", { name: "common:actions.delete" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(key);
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );

  it("keeps a redacted registered deletion unapprovable", () => {
    mocks.registered = "project";
    mocks.registeredRedacted = true;
    render(<Harness />);
    expect(
      screen.getByText("pendingActions:registered.hidden"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "common:actions.delete" }),
    ).toBeNull();
  });

  it("shows the exact comment, parent and visibility before click approval", async () => {
    mocks.comment = true;
    mocks.clickContract = true;
    render(<Harness />);
    expect(
      screen.getByText("HELP-4 · Certificate rotation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Exact internal comment to delete"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("pendingActions:comment.internal"),
    ).toBeInTheDocument();
    expect(screen.getByText("pendingActions:comment.open")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({ id: "action-a" }),
    );
    expect(mocks.proof).not.toHaveBeenCalled();
  });
  it.each(["redacted", "malformed"])(
    "does not approve or reveal a %s comment",
    (kind) => {
      mocks.comment = true;
      mocks.clickContract = true;
      mocks.relationRedacted = kind === "redacted";
      mocks.malformedComment = kind === "malformed";
      render(<Harness />);
      expect(
        screen.getByText("pendingActions:comment.hidden"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Exact internal comment to delete"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("comment-a")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "common:actions.delete" }),
      ).not.toBeInTheDocument();
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );
  it("shows the exact attachment and parent before click approval", async () => {
    mocks.attachment = true;
    mocks.clickContract = true;
    render(<Harness />);
    expect(screen.getByText("certificate.pdf")).toBeInTheDocument();
    expect(
      screen.getByText("HELP-4 · Certificate rotation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("pendingActions:attachment.open"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({ id: "action-a" }),
    );
    expect(mocks.proof).not.toHaveBeenCalled();
  });
  it.each(["redacted", "wrong-target"])(
    "refuses %s attachment confirmation",
    (kind) => {
      mocks.attachment = true;
      mocks.clickContract = true;
      mocks.relationRedacted = kind === "redacted";
      mocks.mismatchedAttachment = kind === "wrong-target";
      render(<Harness />);
      expect(
        screen.getByText("pendingActions:attachment.hidden"),
      ).toBeInTheDocument();
      expect(screen.queryByText("certificate.pdf")).not.toBeInTheDocument();
      expect(screen.queryByText("file-a")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "common:actions.delete" }),
      ).not.toBeInTheDocument();
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );
  it("never renders the former body when a comment is already deleted", () => {
    mocks.comment = true;
    mocks.commentDeleted = true;
    mocks.clickContract = true;
    render(<Harness />);
    expect(
      screen.getByText("pendingActions:comment.alreadyDeleted"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Exact internal comment to delete"),
    ).not.toBeInTheDocument();
  });
});
