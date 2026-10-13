import { defineApprovalScanTimeZoneSuite } from "./helpers/approval-single-use-suite";

/**
 * The approval reminder scan compares `timestamp without time zone` UTC columns with the
 * database clock; it must not depend on the zone. Process and database session are both in
 * America/New_York, set before any `Date` use and before the pool opens.
 */
process.env.TZ = "America/New_York";
process.env.PGOPTIONS = "-c timezone=America/New_York";

defineApprovalScanTimeZoneSuite("TZ=America/New_York");
