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

/** The adapter could have accepted before its transport failed; retain the lease. */
export class NotificationProviderOutcomeAmbiguous extends Error {
  constructor() {
    super("Notification provider outcome ambiguous");
  }
}
