-- 0157_p4_carries: AK-2 Argon2id key storage. A salted hash cannot be found by equality, so the
-- visible 12-character selector kept in apikey.start narrows the candidates that are verified
-- in constant time. Idempotent.
CREATE INDEX IF NOT EXISTS "apikey_start_idx" ON "apikey" USING btree ("start");
