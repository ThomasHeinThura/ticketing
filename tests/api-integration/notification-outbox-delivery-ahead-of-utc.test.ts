import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db from "../../apps/api/src/database";
import { setTestDatabaseTimezone } from "./helpers/database-timezone";
import { defineNotificationOutboxSuite } from "./helpers/notification-outbox-suite";

/**
 * The outbox delivery suite with BOTH the Node process and the database session in
 * Asia/Yangon (ahead UTC). Lease expiries and back-offs are `timestamp without time zone`
 * columns holding a UTC wall clock; a bare `Date` bound into them is serialised in the
 * process zone, so this run fails if any outbox write regresses to that. Mirrors
 * The process zone is set before test execution and a session-local PostgreSQL timezone
 * is applied after the production pool pins new connections to UTC.
 */
const previousProcessTimezone = process.env.TZ;
process.env.TZ = "Asia/Yangon";
let restoreDatabaseTimezone: (() => Promise<void>) | undefined;

beforeEach(async () => {
  restoreDatabaseTimezone = await setTestDatabaseTimezone("Asia/Yangon");
});
afterEach(async () => {
  await restoreDatabaseTimezone?.();
  restoreDatabaseTimezone = undefined;
});
afterAll(() => {
  if (previousProcessTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = previousProcessTimezone;
});

vi.mock(
  "../../apps/api/src/database/repositories/notification-delivery.repository",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/database/repositories/notification-delivery.repository")
      >();
    const { NotificationReservationContentionError } = await import(
      "../../apps/api/src/notification/delivery-errors"
    );
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
          throw new NotificationReservationContentionError();
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
    expect(result.rows[0]?.timezone).toBe("Asia/Yangon");
  });
});

defineNotificationOutboxSuite("TZ=Asia/Yangon");
