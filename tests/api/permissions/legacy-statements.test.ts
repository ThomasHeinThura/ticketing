import {
  CAPABILITIES,
  type Capability,
  expandCapabilities,
  isCapability,
  statement,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  applyCapabilityDeltaToLegacyStatements,
  capabilitiesFromLegacyStatements,
  capabilitiesSatisfyLegacyStatements,
  LEGACY_PAIR_CAPABILITY,
  legacyStatementsFromCapabilities,
} from "../../../apps/api/src/permissions/legacy-statements";

describe("legacy statement / capability translation", () => {
  it("maps every statement pair the legacy vocabulary defines to a registered capability", () => {
    const missing: string[] = [];
    for (const [resource, actions] of Object.entries(statement)) {
      for (const action of actions) {
        const pair = `${resource}:${action}`;
        const mapped = LEGACY_PAIR_CAPABILITY[pair];
        if (!mapped || !isCapability(mapped)) missing.push(pair);
      }
    }
    expect(missing).toEqual([]);
  });

  it("never maps a pair to an instance-tier capability", () => {
    for (const capability of Object.values(LEGACY_PAIR_CAPABILITY)) {
      expect(CAPABILITIES[capability].group).not.toBe("Instance");
    }
  });

  it("follows the route policies the legacy gates sit beside", () => {
    expect(LEGACY_PAIR_CAPABILITY["ac:update"]).toBe("workspace:manage_roles");
    expect(LEGACY_PAIR_CAPABILITY["member:create"]).toBe(
      "workspace:manage_members",
    );
    expect(LEGACY_PAIR_CAPABILITY["member:delete"]).toBe("member:remove");
    expect(LEGACY_PAIR_CAPABILITY["invitation:create"]).toBe("member:invite");
    expect(LEGACY_PAIR_CAPABILITY["organization:delete"]).toBe(
      "workspace:delete",
    );
  });

  it("translates statements to capabilities and ignores unknown pairs", () => {
    expect(
      capabilitiesFromLegacyStatements({
        work_item: ["read", "update", "bogus"],
        label: ["create", "delete"],
        fooo: ["bar"],
      }),
    ).toEqual(["label:manage", "work_item:read", "work_item:update"]);
  });

  it("a canonical-looking pair with no explicit mapping maps to itself", () => {
    expect(capabilitiesFromLegacyStatements({ comment: ["create"] })).toEqual([
      "comment:create",
    ]);
  });

  it("satisfies a legacy requirement from the expanded capability set, fail-closed on unknown pairs", () => {
    const held = expandCapabilities(["workspace:manage_roles"], {
      tier: "workspace",
    });
    expect(capabilitiesSatisfyLegacyStatements(held, { ac: ["update"] })).toBe(
      true,
    );
    // Implied by manage_roles.
    expect(capabilitiesSatisfyLegacyStatements(held, { ac: ["read"] })).toBe(
      true,
    );
    expect(
      capabilitiesSatisfyLegacyStatements(held, { project: ["create"] }),
    ).toBe(false);
    expect(capabilitiesSatisfyLegacyStatements(held, { fooo: ["bar"] })).toBe(
      false,
    );
  });

  it("derives a statement view from capabilities", () => {
    expect(legacyStatementsFromCapabilities(["work_item:update"])).toEqual({
      work_item: ["read", "update"],
    });
  });

  it("applies a capability delta to a stored statement map without touching the rest", () => {
    const stored = {
      ac: ["read", "update"],
      organization: ["update"],
      team: ["create"],
      work_item: ["read"],
    };
    expect(
      applyCapabilityDeltaToLegacyStatements(stored, {
        added: ["work_item:update"],
        removed: ["workspace:manage_roles"],
      }),
    ).toEqual({
      ac: ["read"],
      organization: ["update"],
      team: ["create"],
      work_item: ["read", "update"],
    });
  });

  it("a delta that changes nothing leaves the row identical", () => {
    const stored = { ac: ["read"], project: ["read"] };
    expect(
      applyCapabilityDeltaToLegacyStatements(stored, {
        added: [],
        removed: [],
      }),
    ).toEqual(stored);
  });

  it("is type-safe about the capability names it returns", () => {
    const out: Capability[] = capabilitiesFromLegacyStatements({
      project: ["share"],
    });
    expect(out).toEqual(["project:manage_members"]);
  });
});
