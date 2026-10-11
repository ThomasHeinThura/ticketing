import { defineApprovalGateTimeZoneSuite } from "./helpers/approval-single-use-suite";

/**
 * Approval single use compares an approval's creation with the activity row of the
 * transition; both are bound as UTC, so the result must not depend on the zone. Process
 * and database session are both in America/New_York. Set before any `Date` use and before the pool opens.
 */
process.env.TZ = "America/New_York";
process.env.PGOPTIONS = "-c timezone=America/New_York";

defineApprovalGateTimeZoneSuite("TZ=America/New_York");
