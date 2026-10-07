import { vi } from "vitest";
import { configureSeedTestOrigins } from "../../apps/api/scripts/seed-test-origins";

vi.mock("dotenv-mono", () => ({ config: () => {} }));

process.env.NODE_ENV = "test";
process.env.TASKDESK_AUTH_SECRET = "seed-test-secret-with-at-least-32-chars";
configureSeedTestOrigins(process.env);
