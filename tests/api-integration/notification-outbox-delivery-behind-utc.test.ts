import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import db from "../../apps/api/src/database";
import { defineNotificationOutboxSuite } from "./helpers/notification-outbox-suite";

/**
 * The outbox delivery suite with BOTH the Node process and the database session in
 * America/New_York (behind UTC). Lease expiries and back-offs are `timestamp without time zone`
 * columns holding a UTC wall clock; a bare `Date` bound into them is serialised in the
 * process zone, so this run fails if any outbox write regresses to that. Mirrors
 * `session-cleanup-server-behind-utc.test.ts`. The process zone must be set before any
 * `Date` use and the session zone before the pool opens its first connection.
 */
process.env.TZ = "America/New_York";
process.env.PGOPTIONS = "-c timezone=America/New_York";

vi.mock(
  "../../apps/api/src/database/repositories/notification-delivery.repository",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/database/repositories/notification-delivery.repository")
      >();
    const faults = () =>
      (
        globalThis as {
          __outboxFaults?: { renewal?: boolean; contention?: boolean };
        }
      ).__outboxFaults;
    return {
      ...actual,
      renewNotificationReservation: (
        ...args: Parameters<typeof actual.renewNotificationReservation>
      ) => {
        if (faults()?.renewal) throw new Error("injected renewal failure");
        return actual.renewNotificationReservation(...args);
      },
      acquireNotificationReservation: (
        ...args: Parameters<typeof actual.acquireNotificationReservation>
      ) => {
        if (faults()?.contention)
          throw new actual.NotificationReservationContentionError();
        return actual.acquireNotificationReservation(...args);
      },
    };
  },
);

describe("time zone is really non-UTC for this file", () => {
  it("moves the Node process and the database session off UTC", async () => {
    expect(new Date().getTimezoneOffset()).not.toBe(0);
    const result = await db.execute<{ timezone: string }>(
      sql`SELECT current_setting('TimeZone') AS timezone`,
    );
    expect(result.rows[0]?.timezone).toBe("America/New_York");
  });
});

defineNotificationOutboxSuite("TZ=America/New_York");
