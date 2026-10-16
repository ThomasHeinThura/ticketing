import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import en from "@i18n/en-US.json";
import { describe, expect, it } from "vitest";

const namespace = (en as Record<string, Record<string, unknown>>)
  .identityConnections as Record<string, unknown>;

function has(key: string): boolean {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      namespace,
    );
  return typeof value === "string";
}

const root = path.resolve(__dirname, "../..");
const sources = [
  ...readdirSync(__dirname)
    .filter((file) => /^(?!.*\.test\.).*\.tsx$/u.test(file))
    .map((file) => path.join(__dirname, file)),
  path.join(
    root,
    "routes/agent/_layout/_authenticated/agent/god-mode/authentication.tsx",
  ),
  path.join(
    root,
    "routes/agent/_layout/_authenticated/agent/god-mode/authentication/$id.tsx",
  ),
];

describe("identityConnections copy coverage", () => {
  it("defines every literal key the identity screens request", () => {
    const missing: string[] = [];
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/gu)) {
        if (!has(match[1] as string))
          missing.push(`${path.basename(file)}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("defines every key built from a closed set", () => {
    const keys = [
      ...[
        "denied",
        "step_up",
        "conflict",
        "conflictVersion",
        "duplicate",
        "not_found",
        "invalid",
        "rate_limited",
        "unavailable",
        "unknown",
        "factor_required",
      ].map((kind) => `errors.${kind}`),
      ...[
        "displayName",
        "tenantId",
        "clientId",
        "clientSecret",
        "domains",
        "requiredAppRole",
        "maxRoleRank",
        "defaultWorkspaceId",
        "defaultRoleId",
      ].map((field) => `editor.errors.${field}`),
      ...["unknown", "healthy", "degraded", "invalid"].map(
        (state) => `editor.health.${state}`,
      ),
      ...["off", "claim", "static"].map((mode) => `editor.mfa.${mode}`),
      ...[
        "userCreated",
        "userUpdated",
        "userDeactivated",
        "userReactivated",
        "groupDirectoryChanged",
        "groupMappingChanged",
        "groupMemberAdded",
        "groupMemberRemoved",
        "requestDenied",
        "authFailed",
        "tokenRotated",
        "tokenRevoked",
        "connectionChanged",
        "syncFailed",
      ].map((kind) => `events.kinds.${kind}`),
      ...["succeeded", "denied", "failed"].map(
        (outcome) => `events.outcomes.${outcome}`,
      ),
      ...["person", "scim", "oidc"].map((actor) => `events.actors.${actor}`),
      ...[
        "settings",
        "profile",
        "enabled",
        "disabled",
        "mappingCreated",
        "mappingUpdated",
        "rotated",
        "revoked",
      ].map((notice) => `scim.notice.${notice}`),
      ...["name", "email", "jobTitle", "locale"].map(
        (field) => `scim.profile.${field}`,
      ),
    ];
    expect(keys.filter((key) => !has(key))).toEqual([]);
  });
});
