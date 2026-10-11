import { describe, expect, it } from "vitest";
import {
  decodeUserDirectoryCursor,
  encodeUserDirectoryCursor,
  escapeIlikeSubstring,
  isCurrentlySuspended,
  normalizeUserDirectoryFilters,
} from "../../apps/api/src/instance/users/directory";

describe("instance Users directory primitives", () => {
  it("normalizes and binds opaque cursors to the exact normalized filter set", () => {
    const filters = normalizeUserDirectoryFilters({
      q: "  name  ",
      side: "staff",
      active: true,
      organisationId: "org-a",
    });
    const createdAt = new Date("2026-10-05T12:00:00.000Z");
    const cursor = encodeUserDirectoryCursor(
      { createdAt, id: "user-a" },
      filters,
    );
    expect(cursor).not.toContain("user-a");
    expect(
      decodeUserDirectoryCursor(cursor, { ...filters, q: "name" }),
    ).toEqual({
      createdAt,
      id: "user-a",
    });
    expect(
      decodeUserDirectoryCursor(cursor, { ...filters, side: "customer" }),
    ).toBeNull();
    expect(decodeUserDirectoryCursor(`${cursor}=`, filters)).toBeNull();
  });

  it("rejects noncanonical, extra-field, and malformed cursor payloads", () => {
    const filters = normalizeUserDirectoryFilters({});
    const valid = JSON.stringify({
      version: 1,
      createdAt: "2026-10-05T12:00:00.000Z",
      id: "u1",
      query: "x",
    });
    const extra = Buffer.from(`${valid.slice(0, -1)},"extra":true}`).toString(
      "base64url",
    );
    expect(
      decodeUserDirectoryCursor(
        Buffer.from(valid).toString("base64url"),
        filters,
      ),
    ).toBeNull();
    expect(decodeUserDirectoryCursor(extra, filters)).toBeNull();
    expect(decodeUserDirectoryCursor("not a cursor", filters)).toBeNull();
  });

  it("escapes LIKE metacharacters and treats expired bans as inactive", () => {
    expect(escapeIlikeSubstring("a%_\\b")).toBe("a\\%\\_\\\\b");
    const now = new Date("2026-10-05T12:00:00.000Z");
    expect(isCurrentlySuspended(true, null, now)).toBe(true);
    expect(isCurrentlySuspended(true, new Date(now.getTime() + 1), now)).toBe(
      true,
    );
    expect(isCurrentlySuspended(true, new Date(now.getTime() - 1), now)).toBe(
      false,
    );
    expect(isCurrentlySuspended(false, null, now)).toBe(false);
  });
});
