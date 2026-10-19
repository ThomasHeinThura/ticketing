/** A cleanup/acquire race could not be resolved within the bounded DB retry budget. */
export class NotificationReservationContentionError extends Error {
  readonly retryable = true;

  constructor() {
    super(
      "Notification reservation row remained unavailable during acquisition",
    );
    this.name = "NotificationReservationContentionError";
  }
}
