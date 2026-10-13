import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import withdrawApproval from "./withdraw-approval";

const mocks = vi.hoisted(() => ({
  requesterPost: vi.fn(),
  adminPost: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    approvals: { ":id": { withdraw: { $post: mocks.requesterPost } } },
    admin: {
      approvals: { ":id": { withdraw: { $post: mocks.adminPost } } },
    },
  },
}));

const ok = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withdrawApproval", () => {
  it("AP-6 calls the requester route for a non-admin session", async () => {
    mocks.requesterPost.mockResolvedValue(ok({ id: "a1" }));
    await withdrawApproval({ id: "a1", asInstanceAdmin: false });
    expect(mocks.requesterPost).toHaveBeenCalledWith({ param: { id: "a1" } });
    expect(mocks.adminPost).not.toHaveBeenCalled();
  });

  it("AP-7 calls the admin route for an instance-admin session", async () => {
    mocks.adminPost.mockResolvedValue(ok({ id: "a1" }));
    await withdrawApproval({ id: "a1", asInstanceAdmin: true });
    expect(mocks.adminPost).toHaveBeenCalledWith({ param: { id: "a1" } });
    expect(mocks.requesterPost).not.toHaveBeenCalled();
  });

  it("preserves the 409 status for a terminal approval", async () => {
    mocks.requesterPost.mockResolvedValue({ ok: false, status: 409 });
    await expect(
      withdrawApproval({ id: "a1", asInstanceAdmin: false }),
    ).rejects.toMatchObject({ name: "HttpError", status: 409 });
    await expect(
      withdrawApproval({ id: "a1", asInstanceAdmin: false }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
