/**
 * Unit-test environment.
 *
 * `apps/api/src/auth.ts` validates TASKDESK_AUTH_SECRET at module load and
 * exits the process when it is absent or too short — deliberately, because a
 * missing secret used to fall through to better-auth's published default
 * constant. Unit tests that import the auth module therefore have to supply
 * the required bootstrap configuration, exactly as the integration setup does.
 *
 * These are test placeholders and are never real credentials.
 */
process.env.NODE_ENV ??= "test";
process.env.TASKDESK_AUTH_SECRET ??= "test-secret-with-at-least-32-chars";
process.env.TASKDESK_AGENT_URL ??= "http://localhost:5173";
process.env.KANEO_API_URL ??= "http://localhost:1337";
