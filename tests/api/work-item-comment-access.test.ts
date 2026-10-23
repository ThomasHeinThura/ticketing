import type { Capability } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { commentAccess } from "../../apps/api/src/work-item/comment-access";

const now = Date.UTC(2026, 9, 22, 12);
const own = {
  personId: "person-author",
  capabilities: new Set<Capability>([
    "comment:update_own",
    "comment:delete_own",
  ]),
};
describe("CA17/CA18 canonical comment affordances", () => {
  it("honours the exact own edit window and distinguishes deletion from editing", () => {
    expect(
      commentAccess(
        own,
        "person-author",
        { createdAt: new Date(now - 15 * 60_000), deletedAt: null },
        now,
      ),
    ).toMatchObject({ canEdit: true, canDelete: true });
    expect(
      commentAccess(
        own,
        "person-author",
        { createdAt: new Date(now - 15 * 60_000 - 1), deletedAt: null },
        now,
      ),
    ).toMatchObject({ canEdit: false, canDelete: true });
    expect(
      commentAccess(
        own,
        "person-author",
        { createdAt: new Date(now + 1), deletedAt: null },
        now,
      ).canEdit,
    ).toBe(false);
  });
  it("never promotes unknown or another person's history into ownership", () => {
    const row = { createdAt: new Date(now), deletedAt: null };
    expect(commentAccess(own, null, row, now)).toMatchObject({
      canEdit: false,
      canDelete: false,
    });
    expect(commentAccess(own, "another-person", row, now)).toMatchObject({
      canEdit: false,
      canDelete: false,
    });
    expect(commentAccess(null, "person-author", row, now)).toMatchObject({
      canEdit: false,
      canDelete: false,
    });
  });
  it("allows explicit moderation beyond the own window and hides tombstone controls", () => {
    const moderator = {
      personId: "moderator",
      capabilities: new Set<Capability>([
        "comment:update_any",
        "comment:delete_any",
      ]),
    };
    expect(
      commentAccess(
        moderator,
        "person-author",
        { createdAt: new Date(0), deletedAt: null },
        now,
      ),
    ).toMatchObject({ canEdit: true, canDelete: true });
    expect(
      commentAccess(
        moderator,
        "person-author",
        { createdAt: new Date(0), deletedAt: new Date(now) },
        now,
      ),
    ).toEqual({ canEdit: false, canDelete: false, mayDelete: true });
  });
});
