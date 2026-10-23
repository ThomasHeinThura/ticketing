/**
 * PA-12 (review round 3, M1): self-service account erasure (better-auth `POST
 * /api/auth/delete-user`, outside OpenAPI) hard-deletes every workspace only the erasing person
 * can reach, so it takes the same legal-hold fence as the pending-action workspace delete: an
 * open hold on a workspace that would be erased, on the erasing person or on their organisation
 * answers 409 `legal_hold` before anything is deleted or invalidated. Every refusal is paired
 * with a lifted-hold retry that erases, so "refused" cannot mean "nothing matched".
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const PASSWORD = "erasure-legal-hold-fixture-password";
let signInCounter = 0;

async function setupErasingOwner() {
  const { app } = createApp();
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `account-${randomUUID()}`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  const signIn = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(++signInCounter % 250) + 1}`,
    },
    body: JSON.stringify({ email: user.email, password: PASSWORD }),
  });
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  expect(cookie).toBeDefined();
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1),
    "erasing person",
  );
  return { app, user, workspace, person, cookie: cookie as string };
}

type Owner = Awaited<ReturnType<typeof setupErasingOwner>>;

function eraseAccount(owner: Owner) {
  return csrfRequest(
    owner.app,
    "/api/auth/delete-user",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    },
    owner.cookie,
  );
}

async function placeHold(scope: "organisation" | "person", scopeId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope,
        scopeId,
        placedBy: "integration-test",
        reason: "account erasure hold test",
      })
      .returning(),
    "hold",
  );
}

async function liftHold(id: string) {
  await db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "integration-test" })
    .where(eq(schema.legalHoldTable.id, id));
}

const userExists = async (userId: string) =>
  (
    await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, userId))
  ).length === 1;

const workspaceExists = async (workspaceId: string) =>
  (
    await db
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId))
  ).length === 1;

async function expectRefusedThenErased(
  owner: Owner,
  holdId: string,
): Promise<void> {
  const refused = await eraseAccount(owner);
  const text = await refused.clone().text();
  expect(refused.status, text).toBe(409);
  expect(JSON.parse(text)).toMatchObject({ code: "legal_hold" });
  // Nothing was deleted or invalidated.
  expect(await userExists(owner.user.id)).toBe(true);
  expect(await workspaceExists(owner.workspace.id)).toBe(true);
  expect(
    (
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, owner.user.id))
    ).length,
  ).toBeGreaterThan(0);

  await liftHold(holdId);
  const erased = await eraseAccount(owner);
  expect(erased.status, await erased.clone().text()).toBe(200);
  expect(await userExists(owner.user.id)).toBe(false);
  expect(await workspaceExists(owner.workspace.id)).toBe(false);
}

describe("account erasure honours legal holds (M1)", () => {
  beforeEach(() => resetTestDatabase());

  it("no hold: the account is erased together with its sole-access workspace", async () => {
    const owner = await setupErasingOwner();
    const response = await eraseAccount(owner);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await userExists(owner.user.id)).toBe(false);
    expect(await workspaceExists(owner.workspace.id)).toBe(false);
  });

  it("a hold on a person whose rows live in the workspace refuses with 409 legal_hold", async () => {
    const owner = await setupErasingOwner();
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    // A login-less stakeholder: held, but gives nobody access (so the other-access refusal
    // cannot be what answers).
    const stakeholder = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          organisationId: owner.person.organisationId,
          side: "staff",
          active: true,
          isPlaceholder: true,
        })
        .returning(),
      "stakeholder person",
    );
    await db.insert(schema.stakeholderTable).values({
      projectId: project.id,
      personId: stakeholder.id,
      role: "sponsor",
      escalationOrder: 1,
    });
    const hold = await placeHold("person", stakeholder.id);
    await expectRefusedThenErased(owner, hold.id);
  });

  it("a hold on the erasing person refuses with 409 legal_hold", async () => {
    const owner = await setupErasingOwner();
    const hold = await placeHold("person", owner.person.id);
    await expectRefusedThenErased(owner, hold.id);
  });

  it("a hold on the erasing person's organisation refuses with 409 legal_hold", async () => {
    const owner = await setupErasingOwner();
    const hold = await placeHold("organisation", owner.person.organisationId);
    await expectRefusedThenErased(owner, hold.id);
  });
});
