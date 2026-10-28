import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), openPending: vi.fn() }));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/work-item/request-comment-deletion", () => ({
  default: mocks.request,
}));

import { WorkItemCommentDelete } from "./work-item-comment-delete";

beforeEach(() => {
  mocks.request.mockReset();
  mocks.openPending.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
describe("canonical comment deletion intent", () => {
  it("shows only authoritative delete permission and sends exactly one durable request", async () => {
    let finish!: (result: { pendingActionId: string }) => void;
    mocks.request.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(
      <WorkItemCommentDelete
        workItemKey="HELP-4"
        commentId="comment-1"
        canDelete={false}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    view.rerender(
      <WorkItemCommentDelete
        workItemKey="HELP-4"
        commentId="comment-1"
        canDelete
      />,
    );
    const button = screen.getByRole("button", {
      name: "common:actions.delete",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("comment-1");
    expect(mocks.openPending).not.toHaveBeenCalled();
    finish({ pendingActionId: "pa/one" });
    await waitFor(() =>
      expect(mocks.openPending).toHaveBeenCalledWith({
        pendingActionId: "pa/one",
      }),
    );
  });
  it.each(["route", "permission", "unmount"])(
    "never opens stale confirmation after %s changed",
    async (mode) => {
      let finish!: (result: { pendingActionId: string }) => void;
      mocks.request.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const view = render(
        <WorkItemCommentDelete
          workItemKey="HELP-4"
          commentId="comment-1"
          canDelete
        />,
      );
      fireEvent.click(screen.getByRole("button"));
      if (mode === "unmount") view.unmount();
      else
        view.rerender(
          <WorkItemCommentDelete
            workItemKey={mode === "route" ? "HELP-5" : "HELP-4"}
            commentId="comment-1"
            canDelete={mode !== "permission"}
          />,
        );
      finish({ pendingActionId: "stale" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mocks.openPending).not.toHaveBeenCalled();
    },
  );
  it("keeps the comment in place on refusal and permits a fresh request", async () => {
    mocks.request
      .mockRejectedValueOnce(new Error("stale access"))
      .mockResolvedValue({ pendingActionId: "retry" });
    render(
      <WorkItemCommentDelete
        workItemKey="HELP-4"
        commentId="comment-1"
        canDelete
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workItems:deletion.requestFailed",
    );
    expect(mocks.openPending).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(mocks.openPending).toHaveBeenCalledTimes(1));
  });
});
