import { describe, expect, it, vi } from "vitest";
import getNotifications from "@/fetchers/notification/get-notifications";
import { notificationInboxOptions } from "./notification-inbox-options";

vi.mock("@/fetchers/notification/get-notifications", () => ({
  default: vi.fn(),
}));

describe("notification loader options", () => {
  it("shares the inbox filter key and forwards the cursor", async () => {
    const options = notificationInboxOptions("unread");
    expect(options.queryKey).toEqual(["notifications", "inbox", "unread"]);
    expect(options.initialPageParam).toBeUndefined();
    await options.queryFn({ pageParam: "next-page" });
    expect(getNotifications).toHaveBeenCalledWith("unread", "next-page");
  });

  it("ends pagination when the server has no next cursor", () => {
    const options = notificationInboxOptions();
    expect(options.queryKey).toEqual(["notifications", "inbox", "all"]);
    expect(
      options.getNextPageParam({
        data: [],
        unreadCount: 0,
        hasMore: false,
        nextCursor: null,
      }),
    ).toBeUndefined();
    expect(
      options.getNextPageParam({
        data: [],
        unreadCount: 0,
        hasMore: false,
        nextCursor: "next",
      }),
    ).toBe("next");
  });
});
