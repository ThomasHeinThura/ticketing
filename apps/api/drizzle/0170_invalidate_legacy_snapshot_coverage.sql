-- Existing coverage predates source invalidation and may already be stale.
-- Keep source records and aggregates; the hourly job rebuilds trusted day coverage.
DELETE FROM metric_snapshot_day;
