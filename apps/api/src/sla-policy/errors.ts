export class PolicyVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super("SLA policy version conflict");
    this.name = "PolicyVersionConflictError";
  }
}
