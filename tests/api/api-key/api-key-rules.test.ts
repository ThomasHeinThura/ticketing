import {
  CAPABILITY_NAMES,
  type Capability,
  createPolicyRegistry,
  elevatedWithoutSessionOnly,
  elevationViolations,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  boundServiceKeyCapabilities,
  capabilitiesToPermissions,
  KeyCapabilityError,
  parseRequestedCapabilities,
  READ_ONLY_KEY_CAPABILITIES,
  writeCapabilitiesOf,
} from "../../../apps/api/src/api-key/capability-set";
import {
  assertKeyHasApprover,
  legacyPersonalKeyKind,
  pendingActionOriginForKey,
} from "../../../apps/api/src/api-key/credential";
import { evaluateKeyRequest } from "../../../apps/api/src/api-key/enforce";
import {
  IpAllowlistError,
  isClientIpAllowed,
  normalizeIpAllowlist,
} from "../../../apps/api/src/api-key/ip-allowlist";
import { apiKeyPolicies } from "../../../apps/api/src/api-key/policy";
import {
  classifyRequest,
  DEFAULT_MCP_BULK_CEILING_PER_MINUTE,
  DEFAULT_MCP_WRITE_CEILING_PER_MINUTE,
  effectiveLimit,
  KeyRateLimiter,
} from "../../../apps/api/src/api-key/rate-limit";
import { toApiKeySummary } from "../../../apps/api/src/api-key/summary";
import { apiKeyCapabilitySubset } from "../../../apps/api/src/utils/require-api-key-permission-scope";

const personalKey = (over: object = {}) => ({
  ...legacyPersonalKeyKind("k1"),
  ...over,
});

describe("AK-9 read-only default", () => {
  it("defaults to exactly the workspace-tier read capabilities", () => {
    expect(parseRequestedCapabilities(undefined)).toEqual(
      [...READ_ONLY_KEY_CAPABILITIES].sort(),
    );
    expect(READ_ONLY_KEY_CAPABILITIES.length).toBeGreaterThan(0);
    for (const capability of READ_ONLY_KEY_CAPABILITIES)
      expect(capability.endsWith(":read")).toBe(true);
    expect(writeCapabilitiesOf(READ_ONLY_KEY_CAPABILITIES)).toEqual([]);
  });

  it("treats anything outside the read set as the write opt-in", () => {
    expect(writeCapabilitiesOf(["work_item:read", "work_item:update"])).toEqual(
      ["work_item:update"],
    );
  });

  it("refuses an unknown capability and an empty set (AK-12)", () => {
    expect(() => parseRequestedCapabilities(["work_item:fly"])).toThrow(
      KeyCapabilityError,
    );
    expect(() => parseRequestedCapabilities([])).toThrow(KeyCapabilityError);
  });

  it("round-trips through the permissions shape the request path reads", () => {
    const requested = parseRequestedCapabilities([
      "work_item:read",
      "work_item:update",
      "project:read",
    ]);
    const permissions = capabilitiesToPermissions(requested);
    expect(permissions).toEqual({
      project: ["read"],
      work_item: ["read", "update"],
    });
    expect([...apiKeyCapabilitySubset({ permissions })].sort()).toEqual(
      [...requested].sort(),
    );
  });

  it("every registered capability has exactly one colon (lossless split)", () => {
    for (const name of CAPABILITY_NAMES)
      expect(name.split(":")).toHaveLength(2);
  });
});

describe("AK-7 service key is bounded by the creator at creation", () => {
  const held = new Set<Capability>(["work_item:read", "work_item:update"]);

  it("stores the expanded closure when the creator holds every capability", () => {
    expect(boundServiceKeyCapabilities(["work_item:read"], held)).toContain(
      "work_item:read",
    );
  });

  it("refuses a capability the creator lacks, naming it", () => {
    try {
      boundServiceKeyCapabilities(["work_item:delete"], held);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeyCapabilityError);
      expect((error as KeyCapabilityError).code).toBe("beyond_creator");
      expect((error as KeyCapabilityError).capabilities).toContain(
        "work_item:delete",
      );
    }
  });

  it("refuses instance-tier capabilities outright, even for a creator holding them", () => {
    const everything = new Set(CAPABILITY_NAMES);
    expect(() =>
      boundServiceKeyCapabilities(["instance:admin"], everything),
    ).toThrow(KeyCapabilityError);
  });
});

describe("AK-4 IP allowlist", () => {
  it("normalises addresses and ranges and rejects malformed entries", () => {
    expect(
      normalizeIpAllowlist(["10.0.0.1", "10.0.0.0/8", "10.0.0.1"]),
    ).toEqual(["10.0.0.1", "10.0.0.0/8"]);
    expect(normalizeIpAllowlist([])).toBeNull();
    for (const bad of ["nope", "10.0.0.1/33", "10.0.0.1/8/8", "::1/129", ""])
      expect(() => normalizeIpAllowlist([bad])).toThrow(IpAllowlistError);
  });

  it("allows everything when no allowlist is set", () => {
    expect(isClientIpAllowed(null, "8.8.8.8")).toBe(true);
    expect(isClientIpAllowed([], null)).toBe(true);
  });

  it("matches v4 and v6 ranges and fails closed on an unknown client", () => {
    const list = ["10.0.0.0/8", "203.0.113.7", "2001:db8::/32"];
    expect(isClientIpAllowed(list, "10.1.2.3")).toBe(true);
    expect(isClientIpAllowed(list, "203.0.113.7")).toBe(true);
    expect(isClientIpAllowed(list, "203.0.113.8")).toBe(false);
    expect(isClientIpAllowed(list, "2001:db8::1")).toBe(true);
    expect(isClientIpAllowed(list, "2001:db9::1")).toBe(false);
    expect(isClientIpAllowed(list, null)).toBe(false);
    expect(isClientIpAllowed(list, "not-an-ip")).toBe(false);
  });
});

describe("per-request key rules (AK-6, AK-4, MC-14)", () => {
  it("refuses a disabled key with a plain 401", () => {
    expect(
      evaluateKeyRequest({
        key: personalKey({ disabledAt: new Date() }),
        clientIp: "10.0.0.1",
        mcpFeatureEnabled: true,
      }),
    ).toEqual({ ok: false, status: 401, message: "Unauthorized" });
  });

  it("answers 404 for an is_mcp key when feature.mcp is off, not for another key", () => {
    const off = evaluateKeyRequest({
      key: personalKey({ isMcp: true }),
      clientIp: null,
      mcpFeatureEnabled: false,
    });
    expect(off).toMatchObject({ ok: false, status: 404 });
    expect(
      evaluateKeyRequest({
        key: personalKey(),
        clientIp: null,
        mcpFeatureEnabled: false,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a client outside the allowlist with 403", () => {
    expect(
      evaluateKeyRequest({
        key: personalKey({ ipAllowlist: ["10.0.0.0/8"] }),
        clientIp: "8.8.8.8",
        mcpFeatureEnabled: true,
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });
});

describe("PA-5a / F13 credential rules", () => {
  it("a service key has no approver", () => {
    expect(() =>
      assertKeyHasApprover({ kind: "service" }),
    ).toThrowErrorMatchingInlineSnapshot(
      "[Error: no_approver: a workspace service key has no person to approve a deletion]",
    );
    expect(() => assertKeyHasApprover({ kind: "personal" })).not.toThrow();
  });

  it("derives the pending-action origin from is_mcp only", () => {
    expect(pendingActionOriginForKey({ isMcp: true })).toBe("mcp");
    expect(pendingActionOriginForKey({ isMcp: false })).toBe("api");
    expect(pendingActionOriginForKey(legacyPersonalKeyKind("legacy"))).toBe(
      "api",
    );
  });
});

describe("MC-10 / MC-22 rate limits", () => {
  it("applies the MCP write ceiling only to MCP writes", () => {
    const mcp = { isMcp: true, keyLimitPerMinute: null };
    expect(effectiveLimit(mcp, "read")).toBe(100);
    expect(effectiveLimit(mcp, "write")).toBe(
      DEFAULT_MCP_WRITE_CEILING_PER_MINUTE,
    );
    expect(effectiveLimit(mcp, "bulk")).toBe(
      DEFAULT_MCP_BULK_CEILING_PER_MINUTE,
    );
    expect(effectiveLimit({ ...mcp, keyLimitPerMinute: 10 }, "write")).toBe(10);
    expect(
      effectiveLimit({ isMcp: false, keyLimitPerMinute: null }, "write"),
    ).toBe(100);
  });

  it("classifies methods", () => {
    expect(classifyRequest("get")).toBe("read");
    expect(classifyRequest("POST")).toBe("write");
    expect(classifyRequest("POST", { bulk: true })).toBe("bulk");
    // A search is a POST that reads: it must not eat the MCP write ceiling.
    expect(classifyRequest("POST", { path: "/api/work-items/search" })).toBe(
      "read",
    );
    expect(
      classifyRequest("POST", { path: "/api/work-items/PROJ-1/assign" }),
    ).toBe("write");
  });

  it("limits per key and class, and resets after the window", () => {
    const limiter = new KeyRateLimiter();
    expect(limiter.check("a", "write", 2, 0).allowed).toBe(true);
    expect(limiter.check("a", "write", 2, 1).allowed).toBe(true);
    const refused = limiter.check("a", "write", 2, 2);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(limiter.check("a", "read", 2, 2).allowed).toBe(true);
    expect(limiter.check("b", "write", 2, 2).allowed).toBe(true);
    expect(limiter.check("a", "write", 2, 60_001).allowed).toBe(true);
  });
});

describe("key summary", () => {
  const base = {
    id: "k",
    name: "ci",
    prefix: "tdk_",
    start: "tdk_ab",
    enabled: true,
    permissions: null,
    expiresAt: null,
    createdAt: new Date("2026-10-23T00:00:00Z"),
    isMcp: false,
    workspaceId: null,
    personId: "p",
    capabilities: null,
    ipAllowlist: null,
    rateLimitPerMinute: null,
    lastUsedAt: null,
    lastUsedIp: null,
    disabledAt: null,
    disabledReason: null,
    creatorActive: null,
  };

  it("reads a personal key's subset from permissions and flags writes", () => {
    const readOnly = toApiKeySummary({
      ...base,
      permissions: JSON.stringify({ work_item: ["read"] }),
    });
    expect(readOnly.capabilities).toEqual(["work_item:read"]);
    expect(readOnly.writesEnabled).toBe(false);
    const writer = toApiKeySummary({
      ...base,
      permissions: JSON.stringify({ work_item: ["read", "update"] }),
    });
    expect(writer.writesEnabled).toBe(true);
  });

  it("a null or malformed permissions column holds nothing (fail closed)", () => {
    expect(toApiKeySummary(base).capabilities).toEqual([]);
    expect(
      toApiKeySummary({ ...base, permissions: "{not json" }).capabilities,
    ).toEqual([]);
  });

  it("shows a service key owned by admins once its creator is gone", () => {
    const service = toApiKeySummary({
      ...base,
      workspaceId: "w",
      personId: null,
      capabilities: ["work_item:read", "bogus:cap"],
      creatorActive: false,
    });
    expect(service.kind).toBe("service");
    expect(service.capabilities).toEqual(["work_item:read"]);
    expect(service.createdByFormerMember).toBe(true);
    expect(
      toApiKeySummary({
        ...base,
        workspaceId: "w",
        personId: null,
        capabilities: [],
        creatorActive: true,
      }).createdByFormerMember,
    ).toBe(false);
  });

  it("a disabled key reads as not enabled", () => {
    expect(toApiKeySummary({ ...base, disabledAt: new Date() }).enabled).toBe(
      false,
    );
  });
});

describe("api-key route policies", () => {
  const registry = createPolicyRegistry([
    { name: "apps/api/src/api-key/policy.ts", policies: apiKeyPolicies },
  ]);

  it("is a valid policy map with no elevation violations", () => {
    expect(elevationViolations(registry)).toEqual([]);
    expect(elevatedWithoutSessionOnly(registry)).toEqual([]);
  });

  it("creating and deleting a service key is elevated and session-only; a key cannot do either", () => {
    for (const key of [
      "POST /api/workspaces/{id}/api-keys",
      "DELETE /api/workspaces/{id}/api-keys/{keyId}",
    ]) {
      const policy = apiKeyPolicies[key as keyof typeof apiKeyPolicies];
      expect(policy).toMatchObject({ elevated: true, sessionOnly: true });
    }
  });

  it("creating a personal key is session-only; revoking your own is not (AK-6, AK-9)", () => {
    expect(apiKeyPolicies["POST /api/me/api-keys"]).toMatchObject({
      sessionOnly: true,
    });
    expect(
      "sessionOnly" in apiKeyPolicies["POST /api/me/api-keys/{id}/revoke"],
    ).toBe(false);
  });
});
