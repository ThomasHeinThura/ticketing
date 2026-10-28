/**
 * Shared test support for the Jira / JSM adapters: fixture loading and a recorded-response
 * transport. No live call is ever made: the transport answers from `tests/fixtures/imports/jira`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JiraTransport } from "../../../../apps/api/src/imports/adapters/jira";
import type {
  AdapterConnection,
  ProposalContext,
} from "../../../../apps/api/src/imports/engine/adapter";

const root = resolve(__dirname, "../../../fixtures/imports");

export function loadFixture<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
}

export const TEST_EMAIL = "migration.bot@acme.example.test";
export const TEST_TOKEN = "ATATT3xFfGF0-fixture-token-not-a-secret";
export const TEST_CREDENTIAL = `${TEST_EMAIL}:${TEST_TOKEN}`;

export function connection(
  pluginId: "import.jira" | "import.jsm",
  config: Record<string, unknown>,
  credential: string | null = null,
): AdapterConnection {
  return { pluginId, config, credential, readOnly: true };
}

export type RecordedCall = {
  url: URL;
  authorized: boolean;
  keys: string[];
};

type RecordedOptions = {
  /** Tokens (or "first") that answer 429 `times` times before succeeding. */
  rateLimit?: { token: string; times: number; retryAfter?: string };
  /** Always answer this status for search calls. */
  searchStatus?: number;
  nearLimit?: boolean;
  pages?: Record<string, unknown>;
};

/** Answers `/myself` and `/search/jql` from the recorded fixtures; every request is a GET by type. */
export function recordedTransport(options: RecordedOptions = {}) {
  const calls: RecordedCall[] = [];
  let limited = 0;
  const pages: Record<string, unknown> = options.pages ?? {
    first: loadFixture("jira/rest-page-1.json"),
    "tok-page-2": loadFixture("jira/rest-page-2.json"),
    "tok-page-3": loadFixture("jira/rest-page-3.json"),
  };
  const transport: JiraTransport = async (request) => {
    const url = new URL(request.url);
    const expected = `Basic ${Buffer.from(TEST_CREDENTIAL).toString("base64")}`;
    calls.push({
      url,
      authorized: request.headers.authorization === expected,
      keys: Object.keys(request.headers),
    });
    if (request.headers.authorization !== expected)
      return { status: 401, headers: {}, body: "{}" };
    const headers: Record<string, string> = options.nearLimit
      ? { "x-ratelimit-nearlimit": "true" }
      : {};
    if (url.pathname === "/rest/api/3/myself")
      return {
        status: 200,
        headers,
        body: JSON.stringify(loadFixture("jira/myself.json")),
      };
    if (url.pathname === "/rest/api/3/search/jql") {
      if (options.searchStatus)
        return { status: options.searchStatus, headers: {}, body: "{}" };
      const token = url.searchParams.get("nextPageToken") ?? "first";
      if (
        options.rateLimit &&
        token === options.rateLimit.token &&
        limited < options.rateLimit.times
      ) {
        limited += 1;
        return {
          status: 429,
          headers: options.rateLimit.retryAfter
            ? { "retry-after": options.rateLimit.retryAfter }
            : {},
          body: "{}",
        };
      }
      const page = pages[token];
      if (!page) return { status: 400, headers: {}, body: "{}" };
      return { status: 200, headers, body: JSON.stringify(page) };
    }
    return { status: 404, headers: {}, body: "{}" };
  };
  return { transport, calls };
}

export function proposalContext(
  overrides: Partial<{
    types: Record<string, string>;
    people: Record<string, string>;
  }> = {},
): ProposalContext {
  return {
    workspaceId: "ws",
    projectId: "proj",
    peopleByEmail: new Map(Object.entries(overrides.people ?? {})),
    typeIdsByKey: new Map(Object.entries(overrides.types ?? {})),
  };
}

export const noSleep = async () => undefined;
