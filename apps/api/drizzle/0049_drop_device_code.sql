-- Issue #6 — drop the OAuth device-flow state table.
--
-- mcp-server.md MC-3 puts an OAuth device flow explicitly out of scope: "a
-- whole authentication mechanism". kaneo's deviceAuthorization() plugin also
-- laundered an API key into a session token that OUTLIVED the key's own
-- revocation, so revoking the key did not revoke what it had produced.
--
-- As with 0048: dropping this table is NOT revocation. Sessions the device flow
-- already issued live in `session`. Issue #17 covers revoking them.
DROP TABLE IF EXISTS "device_code" CASCADE;
