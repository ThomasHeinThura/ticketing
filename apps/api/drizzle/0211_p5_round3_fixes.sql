-- 0211_p5_round3_fixes: P5 round-3 review (P5-R3-04). Hand-written and idempotent.
-- The "export ready" email (RP-10) was claimed by setting notified_at before the send, so a crash
-- after the claim and before the send left the export marked notified and the email was never
-- sent. A worker now takes a lease in notify_claimed_at; notified_at is set only once the outcome
-- is decided (sent, or deliberately not sent). A claim older than the lease is taken over by the
-- next run of the report-export job.
ALTER TABLE report_export
  ADD COLUMN IF NOT EXISTS notify_claimed_at timestamptz;
