import { describe, expect, it, vi } from "vitest";
import {
  callNotificationProvider,
  NOTIFICATION_ATTEMPT_LIMIT,
  NotificationProviderDeadlineExceeded,
  notificationDedupeKey,
  notificationReservationKey,
  notificationRetryDelayMs,
} from "../../../apps/api/src/notification/delivery-primitives";

describe("notification delivery contract primitives", () => {
  it("NO-11: hashes exact UTF-8 length-prefixed event tuple bytes", () => {
    const base = {
      eventKind: "work_item.assigned",
      resourceType: "work_item",
      resourceId: "é",
      personId: "person_1",
      channel: "notify.email",
    };
    expect(notificationDedupeKey(base)).toBe(
      "notification:v1:c646521c1150ae3fdb3934f8aa72cebc8a30112ea0ad129d7906d41068bd07a6",
    );
    expect(notificationDedupeKey({ ...base, resourceId: "e\u0301" })).not.toBe(
      notificationDedupeKey(base),
    );
    expect(
      notificationDedupeKey({ ...base, resourceId: "", personId: "éperson_1" }),
    ).not.toBe(notificationDedupeKey(base));
  });

  it("NO-11: creates a fixed 32-byte reservation digest from its exact tuple", () => {
    const tuple = {
      recipientPersonId: "person_1",
      channel: "notify.email",
      dedupeKey: "notification:v1:abc",
    };
    const key = notificationReservationKey(tuple);
    expect(key).toHaveLength(32);
    expect(key.toString("hex")).toBe(
      "0b0f74c581ae960231870dc2791422bfc89f589ac66fa139d9ff93c0318efce7",
    );
    expect(
      notificationReservationKey({ ...tuple, channel: "notify.webhook" }),
    ).not.toEqual(key);
  });

  it("NO-9: applies the documented backoff by durable attempt and stops at six", () => {
    expect(NOTIFICATION_ATTEMPT_LIMIT).toBe(6);
    expect([1, 2, 3, 4, 5, 6].map(notificationRetryDelayMs)).toEqual([
      30_000,
      120_000,
      600_000,
      3_600_000,
      21_600_000,
      null,
    ]);
    expect(() => notificationRetryDelayMs(0)).toThrow(RangeError);
    expect(() => notificationRetryDelayMs(7)).toThrow(RangeError);
  });

  it("NO-11: deadline requests cancellation and stops awaiting an adapter that ignores it", async () => {
    const signalState: boolean[] = [];
    const startedAt = Date.now();
    await expect(
      callNotificationProvider(
        (signal) => {
          signal.addEventListener("abort", () =>
            signalState.push(signal.aborted),
          );
          return new Promise<never>(() => undefined);
        },
        { deadlineMs: 20 },
      ),
    ).rejects.toBeInstanceOf(NotificationProviderDeadlineExceeded);
    expect(signalState).toEqual([true]);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("NO-11: forwards caller cancellation to the adapter", async () => {
    const caller = new AbortController();
    const aborted = vi.fn();
    const sending = callNotificationProvider(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted();
            reject(signal.reason);
          });
        }),
      { deadlineMs: 500, signal: caller.signal },
    );
    await Promise.resolve();
    caller.abort(new Error("shutdown"));
    await expect(sending).rejects.toThrow("shutdown");
    expect(aborted).toHaveBeenCalledOnce();
  });
});
