import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requesterPost: vi.fn(),
  adminPost: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    approvals: {
      ":id": { withdraw: { $post: mocks.requesterPost } },
    },
    admin: {
      approvals: {
        ":id": { withdraw: { $post: mocks.adminPost } },
      },
    },
  },
}));

import withdrawApproval from "./withdraw-approval";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requesterPost.mockResolvedValue(
    new Response(JSON.stringify({ state: "withdrawn" }), { status: 200 }),
  );
  mocks.adminPost.mockResolvedValue(
    new Response(JSON.stringify({ state: "withdrawn" }), { status: 200 }),
  );
});

describe("withdrawApproval", () => {
  it("uses the requester endpoint for ordinary sessions and scoped keys", async () => {
    await withdrawApproval({ id: "approval-1", asInstanceAdmin: false });

    expect(mocks.requesterPost).toHaveBeenCalledWith({
      param: { id: "approval-1" },
    });
    expect(mocks.adminPost).not.toHaveBeenCalled();
  });

  it("uses the session-only admin endpoint for instance-admin sessions", async () => {
    await withdrawApproval({ id: "approval-2", asInstanceAdmin: true });

    expect(mocks.adminPost).toHaveBeenCalledWith({
      param: { id: "approval-2" },
    });
    expect(mocks.requesterPost).not.toHaveBeenCalled();
  });
});
