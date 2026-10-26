/** Safe internal marker for a reserved probe key that already exists. */
export class StorageProbeCollisionError extends Error {
  constructor() {
    super("Storage probe key already exists.");
    this.name = "StorageProbeCollisionError";
  }
}
