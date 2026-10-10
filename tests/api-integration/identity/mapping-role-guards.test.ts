import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import {
  validateOidcMappingRole,
  validateScimMappingRole,
} from "../../../apps/api/src/identity/repository";
import { ensureInternalOrganisation } from "../../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "../helpers/database";

/**
 * IP-2 / IP-3 / IP-21 role restrictions on IdP-driven mappings. Each negative case here
 * must fail when exactly one guard in `identity/repository.ts` is removed, so every row
 * is paired with a positive control that proves the fixture is otherwise acceptable.
 */
const WORKSPACE_A = "guard-workspace-a";
const WORKSPACE_B = "guard-workspace-b";
const CUSTOMER_ORG = "guard-customer-org";
const ROLE = {
  member: "guard-role-member",
  foreign: "guard-role-foreign-workspace",
  admin: "guard-role-admin",
  owner: "guard-role-owner",
  customer: "guard-role-customer",
  notCustomer: "guard-role-not-customer",
};

async function seed() {
  const internal = await ensureInternalOrganisation();
  await db.insert(schema.workspaceTable).values([
    {
      id: WORKSPACE_A,
      organisationId: internal.id,
      name: "Guard A",
      slug: "guard-a",
      createdAt: new Date(),
    },
    {
      id: WORKSPACE_B,
      organisationId: internal.id,
      name: "Guard B",
      slug: "guard-b",
      createdAt: new Date(),
    },
  ]);
  await db.insert(schema.organisationTable).values({
    id: CUSTOMER_ORG,
    key: "guard-customer",
    name: "Guard Customer",
    isInternal: false,
    portalAccess: true,
  });
  await db.insert(schema.roleTable).values([
    {
      id: ROLE.member,
      scope: "workspace",
      workspaceId: WORKSPACE_A,
      key: "guard-member",
      name: "Guard Member",
      rank: 2,
      capabilities: [],
    },
    {
      id: ROLE.foreign,
      scope: "workspace",
      workspaceId: WORKSPACE_B,
      key: "guard-foreign",
      name: "Guard Foreign",
      rank: 2,
      capabilities: [],
    },
    {
      id: ROLE.admin,
      scope: "workspace",
      workspaceId: WORKSPACE_A,
      key: "admin",
      name: "Guard Admin",
      rank: 3,
      capabilities: [],
    },
    {
      id: ROLE.owner,
      scope: "workspace",
      workspaceId: WORKSPACE_A,
      key: "owner",
      name: "Guard Owner",
      rank: 3,
      capabilities: [],
    },
    {
      id: ROLE.customer,
      scope: "organisation",
      workspaceId: null,
      key: "customer",
      name: "Customer",
      rank: 0,
      capabilities: [],
    },
    {
      id: ROLE.notCustomer,
      scope: "organisation",
      workspaceId: null,
      key: "guard-not-customer",
      name: "Not Customer",
      rank: 0,
      capabilities: [],
    },
  ]);
}

const oidcAgent = (roleId: string) => ({
  providerType: "entra",
  portalScope: "agent",
  organisationId: null,
  maxRoleRank: 5,
  scope: "workspace" as const,
  scopeId: WORKSPACE_A,
  roleId,
});
const oidcCustomer = (roleId: string) => ({
  providerType: "entra",
  portalScope: "customer",
  organisationId: CUSTOMER_ORG,
  maxRoleRank: null,
  scope: "organisation" as const,
  scopeId: CUSTOMER_ORG,
  roleId,
});
const scimCustomer = (roleId: string) => ({
  portalScope: "customer",
  organisationId: CUSTOMER_ORG,
  maxRoleRank: null,
  scope: "organisation" as const,
  scopeId: CUSTOMER_ORG,
  roleId,
});

describe("IdP mapping role guards (IP-2, IP-3, IP-21)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await seed();
  });

  it("accepts the OIDC agent and customer positive controls", async () => {
    await db.transaction(async (tx) => {
      expect(await validateOidcMappingRole(tx, oidcAgent(ROLE.member))).toBe(
        true,
      );
      expect(
        await validateOidcMappingRole(tx, oidcCustomer(ROLE.customer)),
      ).toBe(true);
      expect(
        await validateScimMappingRole(tx, scimCustomer(ROLE.customer)),
      ).toBe(true);
    });
  });

  it("refuses an OIDC customer mapping to any role other than the global customer role", async () => {
    await db.transaction(async (tx) => {
      expect(
        await validateOidcMappingRole(tx, oidcCustomer(ROLE.notCustomer)),
      ).toBe(false);
    });
  });

  it("refuses a SCIM customer mapping to any role other than the customer role", async () => {
    await db.transaction(async (tx) => {
      expect(
        await validateScimMappingRole(tx, scimCustomer(ROLE.notCustomer)),
      ).toBe(false);
    });
  });

  it("refuses an OIDC agent mapping to a role anchored in another workspace", async () => {
    await db.transaction(async (tx) => {
      expect(await validateOidcMappingRole(tx, oidcAgent(ROLE.foreign))).toBe(
        false,
      );
    });
  });

  it("refuses an OIDC agent mapping to the admin or owner role", async () => {
    await db.transaction(async (tx) => {
      expect(await validateOidcMappingRole(tx, oidcAgent(ROLE.admin))).toBe(
        false,
      );
      expect(await validateOidcMappingRole(tx, oidcAgent(ROLE.owner))).toBe(
        false,
      );
    });
  });
});
