export class IdentityGrantClosureChangedError extends Error {
  constructor() {
    super("IP-22 closure changed while locking; retry from a fresh snapshot");
  }
}

export class ScimGroupWriteError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    readonly code: "invalidValue" | "notFound" | "uniqueness" | "configuration",
  ) {
    super("SCIM group write rejected");
  }
}
