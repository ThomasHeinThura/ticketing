import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  WorkItemTransitionBlockedError,
  workItemTransitionReasonKey,
} from "@/lib/work-item-transition-reasons";
import transitionWorkItem from "./transition-work-item";

const post = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({
  client: { "work-items": { ":key": { transition: { $post: post } } } },
}));
beforeEach(() => post.mockReset());
describe("canonical board transition transport", () => {
  it("posts the offered template and optional note without guessing a state", async () => {
    post.mockResolvedValue(
      new Response(JSON.stringify({ key: "HELP-2" }), { status: 200 }),
    );
    await expect(
      transitionWorkItem({
        key: "HELP-2",
        toStateTemplateId: "template-started",
        note: "Ready",
      }),
    ).resolves.toEqual({ key: "HELP-2" });
    expect(post).toHaveBeenCalledWith({
      param: { key: "HELP-2" },
      json: { toStateTemplateId: "template-started", note: "Ready" },
    });
  });
  it("retains blockers that arose between reading offers and dropping", async () => {
    post.mockResolvedValue(
      new Response(
        JSON.stringify({
          blockedBy: [
            {
              reasonCode: "cab.pending",
              pendingApprovals: [{ approverName: "Private" }],
            },
          ],
        }),
        { status: 422 },
      ),
    );
    const error = await transitionWorkItem({
      key: "HELP-2",
      toStateTemplateId: "done",
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(WorkItemTransitionBlockedError);
    expect((error as WorkItemTransitionBlockedError).reasonCodes).toEqual([
      "cab.pending",
    ]);
    expect(JSON.stringify(error)).not.toContain("Private");
    expect(workItemTransitionReasonKey("cab.pending")).toBe(
      "workItems:journey.reasonCabPending",
    );
    expect(workItemTransitionReasonKey("untrusted")).toBe(
      "workItems:journey.reasonUnknown",
    );
  });
  it.each([403, 404, 409, 500])(
    "preserves HTTP %i without displaying arbitrary response text",
    async (status) => {
      post.mockResolvedValue(
        new Response("Private internal detail", { status }),
      );
      const error = await transitionWorkItem({
        key: "HELP-2",
        toStateTemplateId: "done",
      }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(status);
      expect((error as Error).message).not.toContain("Private");
    },
  );
  it("keeps malformed 422 responses generic", async () => {
    post.mockResolvedValue(new Response("not json", { status: 422 }));
    await expect(
      transitionWorkItem({ key: "HELP-2", toStateTemplateId: "done" }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
