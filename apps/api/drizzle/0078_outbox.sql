CREATE TABLE "outbox" (
  "event_id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "dedupe_key" text,
  "workspace_id" text NOT NULL,
  "organisation_id" text,
  "state" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamptz DEFAULT now() NOT NULL,
  "last_error" text,
  CONSTRAINT "outbox_state_check" CHECK ("state" IN ('pending', 'delivered', 'dead')),
  CONSTRAINT "outbox_attempts_nonnegative" CHECK ("attempts" >= 0)
);

CREATE INDEX "outbox_state_next_attempt_idx"
  ON "outbox" ("state", "next_attempt_at") WHERE "state" = 'pending';
CREATE INDEX "outbox_workspace_state_idx"
  ON "outbox" ("workspace_id", "state");
CREATE INDEX "outbox_dedupe_key_idx"
  ON "outbox" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
