import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_PROVIDER_DEADLINE_MS,
  NOTIFICATION_RENEWAL_INTERVAL_MS,
  NOTIFICATION_UNRESOLVED_BACKOFF_MS,
  notificationRetryDelayMs,
} from "../../../apps/api/src/notification/delivery-primitives";

describe("notification drain production timing defaults", () => {
  it("pins the lease, renewal cadence, provider deadline and unresolved backoff", () => {
    expect(NOTIFICATION_LEASE_MS).toBe(60_000);
    expect(NOTIFICATION_RENEWAL_INTERVAL_MS).toBe(15_000);
    expect(NOTIFICATION_PROVIDER_DEADLINE_MS).toBe(30_000);
    expect(NOTIFICATION_UNRESOLVED_BACKOFF_MS).toBe(30_000);
    expect(NOTIFICATION_UNRESOLVED_BACKOFF_MS).toBe(
      notificationRetryDelayMs(1),
    );
  });

  it("keeps a send inside its fence", () => {
    expect(NOTIFICATION_RENEWAL_INTERVAL_MS).toBeLessThan(
      NOTIFICATION_LEASE_MS / 2,
    );
    expect(NOTIFICATION_PROVIDER_DEADLINE_MS).toBeLessThan(
      NOTIFICATION_LEASE_MS,
    );
  });
});
