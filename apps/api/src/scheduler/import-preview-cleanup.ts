import { cleanupExpiredImportChunks } from "../imports/expiry-cleanup";
import { assertJobExecutionOwned, withJobLease } from "./leader-lock";

/** Redacts expired staging bytes; execution expiry itself is enforced synchronously. */
export async function runImportPreviewCleanup() {
  return withJobLease(
    "import-preview-cleanup",
    async () => {
      await assertJobExecutionOwned();
      return { scrubbed: await cleanupExpiredImportChunks(100) };
    },
    () => ({ scrubbed: 0 }),
    60_000,
  );
}
