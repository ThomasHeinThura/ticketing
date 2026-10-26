import { describe, expect, it } from "vitest";
import { notificationInboxQuery } from "../../../apps/api/src/notification/schema";

describe("notification inbox query", () => {
  it("defaults to the all filter and a bounded first page", () => {
    expect(notificationInboxQuery.parse({})).toEqual({
      filter: "all",
      limit: undefined,
    });
    expect(
      notificationInboxQuery.parse({ filter: "mentions", limit: "100" }),
    ).toEqual({ filter: "mentions", limit: "100" });
  });

  it("rejects unsupported filters and unbounded page sizes", () => {
    expect(
      notificationInboxQuery.safeParse({ filter: "everything" }).success,
    ).toBe(false);
    expect(notificationInboxQuery.safeParse({ limit: "0" }).success).toBe(
      false,
    );
    expect(notificationInboxQuery.safeParse({ limit: "101" }).success).toBe(
      false,
    );
    expect(
      notificationInboxQuery.safeParse({ limit: "50", otherUserId: "x" })
        .success,
    ).toBe(false);
  });
});
