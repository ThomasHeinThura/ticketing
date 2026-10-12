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
import { Route } from "./$id";

const mocks = vi.hoisted(() => ({
  id: "action-a",
  changed: (() => {}) as () => void,
  proof: vi.fn(),
  approve: vi.fn(),
  cancel: vi.fn(),
  clickContract: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => ({
    options,
    useParams: () => ({ id: mocks.id }),
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
        data: actionFor(String(queryKey[2])),
        isLoading: false,
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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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
vi.mock("@/hooks/queries/god-mode/use-instance-users", () => ({
  instanceUsersKey: ["instance-users"],
}));

function actionFor(id: string) {
  return {
    id,
    action: "delete",
    targetType: mocks.clickContract ? "saved_view" : "user",
    targetIds: ["target-a"],
    approvalSupported: true,
    confirmation: mocks.clickContract ? "click" : "typed_name_step_up",
    state: "pending",
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
    mocks.proof.mockReset();
    mocks.approve.mockReset().mockResolvedValue(undefined);
    mocks.cancel.mockReset().mockResolvedValue(undefined);
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
});
