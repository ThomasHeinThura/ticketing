export class WorkItemVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super("The work item version changed");
    this.name = "WorkItemVersionConflictError";
  }
}
