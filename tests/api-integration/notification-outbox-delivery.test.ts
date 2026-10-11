import { vi } from "vitest";
import { defineNotificationOutboxSuite } from "./helpers/notification-outbox-suite";

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

defineNotificationOutboxSuite("TZ=UTC");
