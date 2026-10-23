import { describe, expect, it } from "vitest";
import { attachmentDeletionAccess } from "../../../apps/api/src/attachment/access";

describe("canonical attachment deletion affordance", () => {
  const live = {
    uploadedBy: "person-uploader",
    state: "ready",
    deletedAt: null,
  };
  it("requires canonical person ownership; auth-user IDs cannot stand in for person IDs", () => {
    expect(
      attachmentDeletionAccess(
        {
          personId: "person-uploader",
          capabilities: new Set(["attachment:delete_own"]),
        },
        live,
      ),
    ).toEqual({ mayDelete: true, canDelete: true });
    expect(
      attachmentDeletionAccess(
        {
          personId: "auth-user",
          capabilities: new Set(["attachment:delete_own"]),
        },
        live,
      ),
    ).toEqual({ mayDelete: false, canDelete: false });
  });
  it("existing delete-any permits moderation without assigning ownership", () => {
    expect(
      attachmentDeletionAccess(
        {
          personId: "person-moderator",
          capabilities: new Set(["attachment:delete_any"]),
        },
        live,
      ).canDelete,
    ).toBe(true);
  });
  it("missing authority never produces a destructive affordance", () => {
    expect(attachmentDeletionAccess(null, live).canDelete).toBe(false);
    expect(
      attachmentDeletionAccess(
        { personId: "person-uploader", capabilities: new Set() },
        live,
      ).canDelete,
    ).toBe(false);
  });
  it("tombstones allow only authorized execution no-op, never another trash control", () => {
    expect(
      attachmentDeletionAccess(
        {
          personId: "person-uploader",
          capabilities: new Set(["attachment:delete_own"]),
        },
        { ...live, state: "deleted", deletedAt: new Date() },
      ),
    ).toEqual({ mayDelete: true, canDelete: false });
  });
});
