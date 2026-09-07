import {
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  CAPABILITY_NAMES,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { documentedRoles, resolveRoleCapabilities } from "./rbac-doc";

/**
 * "This table is the seed data and the permission-matrix fixture — a change here is a change
 * to both, and shows up in review as a diff."
 *
 * So the table is parsed, not transcribed. Widening a role in the document without widening it
 * in the code — or the reverse — fails here.
 */

const documented = documentedRoles();

/** The document writes roles in terms of each other, so resolve them in table order. */
const resolved = new Map<string, readonly string[]>();
for (const role of documented) {
  resolved.set(
    role.key,
    resolveRoleCapabilities(
      role.capabilityExpression,
      CAPABILITY_NAMES,
      resolved,
    ),
  );
}

describe("the built-in roles match rbac.md", () => {
  it("declares the workspace ladder the document declares", () => {
    // instance_admin is documented in prose ("Instance scope has one system role"), not in the
    // table, so it is not expected here.
    const documentedKeys = documented.map((role) => role.key).sort();
    const declaredKeys = Object.keys(BUILT_IN_ROLES)
      .filter((key) => key !== "instance_admin")
      .sort();
    expect(declaredKeys).toEqual(documentedKeys);
  });

  it("gives each role the rank the document gives it", () => {
    for (const role of documented) {
      expect(BUILT_IN_ROLES[role.key as BuiltInRoleKey].rank, role.key).toBe(
        role.rank,
      );
    }
  });

  it("gives each role exactly the capabilities the document gives it", () => {
    for (const role of documented) {
      const declared = [
        ...BUILT_IN_ROLES[role.key as BuiltInRoleKey].capabilities,
      ].sort();
      const expected = [...(resolved.get(role.key) ?? [])].sort();
      expect(declared, role.key).toEqual(expected);
    }
  });

  it("keeps the instance system role holding instance:* and nothing else", () => {
    // "Instance scope has one system role: instance_admin, holding instance:*."
    expect([...BUILT_IN_ROLES.instance_admin.capabilities].sort()).toEqual(
      CAPABILITY_NAMES.filter((name) => name.startsWith("instance:")).sort(),
    );
  });
});
