export class ServiceCalendarVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `Version mismatch: expected version ${assertedVersion}, but the calendar is now at version ${currentVersion}`,
    );
    this.name = "ServiceCalendarVersionConflictError";
  }
}
