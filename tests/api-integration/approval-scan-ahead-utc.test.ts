import { defineApprovalScanTimeZoneSuite } from "./helpers/approval-single-use-suite";

/**
 * The approval reminder scan compares `timestamp without time zone` UTC columns with the
 * database clock; it must not depend on the zone. Process and database session are both in
 * Asia/Yangon, set before any `Date` use and before the pool opens.
 */
process.env.TZ = "Asia/Yangon";
process.env.PGOPTIONS = "-c timezone=Asia/Yangon";

defineApprovalScanTimeZoneSuite("TZ=Asia/Yangon");
