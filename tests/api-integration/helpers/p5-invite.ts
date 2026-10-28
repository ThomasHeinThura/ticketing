import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { runCustomerInvitationDeliveryJob } from "../../../apps/api/src/customer-invitation/delivery/worker";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { emailMock, sentWorkspaceInvitationEmails } from "../mocks/email";
import { mockAuthenticatedSession } from "./auth";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./fixtures";
import { grantSeesAll } from "./project-reach-world";
import { addMember } from "./reach-world";

export const JSON_HEADERS = { "content-type": "application/json" };
export const PORTAL_HOST = "portal.localhost:5174";
type User = Parameters<typeof mockAuthenticatedSession>[0];

/** The credential from the most recent invitation email to an address (the link fragment). */
export function credentialFor(email: string, invitationId?: string): string {
  const mails = sentWorkspaceInvitationEmails.filter(
    (mail) => mail.to === email,
  );
  const mail = mails.at(-1);
  if (!mail) throw new Error(`no invitation email sent to ${email}`);
  const link = String(mail.data.invitationLink);
  const match = /\/invite\/([^#/]+)#t=(.+)$/.exec(link);
  if (!match) throw new Error(`unexpected invitation link ${link}`);
  if (invitationId) expect(match[1]).toBe(invitationId);
  return match[2] as string;
}

export async function insertOrganisation(name = "Customer org") {
  const id = `inv-org-${randomUUID()}`;
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({ id, key: id, name, isInternal: false, portalAccess: true })
      .returning(),
    "organisation",
  );
}

export async function ensureCustomerRole() {
  const { BUILT_IN_ROLES } = await import("@taskdesk/permissions");
  await db
    .insert(schema.roleTable)
    .values({
      scope: "organisation",
      workspaceId: null,
      key: BUILT_IN_ROLES.customer.key,
      name: "Customer",
      rank: BUILT_IN_ROLES.customer.rank,
      capabilities: [...BUILT_IN_ROLES.customer.capabilities],
      isSystem: true,
      isEditable: false,
    })
    .onConflictDoNothing();
}

/** A user with a verified address and, optionally, a customer person in an organisation. */
export async function createCustomerUser(options: {
  organisationId?: string;
  email?: string;
  verified?: boolean;
  person?: boolean;
}) {
  const id = `inv-cust-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: id,
      email: (options.email ?? `${id}@example.test`).toLowerCase(),
      emailVerified: options.verified ?? true,
    })
    .returning();
  if (!user) throw new Error("user fixture missing");
  let personId: string | null = null;
  if (options.person && options.organisationId) {
    const [person] = await db
      .insert(schema.personTable)
      .values({
        userId: id,
        organisationId: options.organisationId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning();
    personId = person?.id ?? null;
  }
  return { user, personId };
}

/**
 * One workspace with an owner (member:invite), a plain member (no member:invite), a foreign
 * workspace owner, a customer organisation and a staff-side user that is NOT a customer.
 */
export async function inviteWorld() {
  await ensureCustomerRole();
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  // CP-20: inviting needs reach to the organisation; the owner holds workspace-wide reach.
  const ownerPerson = requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id))
      .limit(1),
    "owner person",
  );
  await grantSeesAll(workspaceId, ownerPerson.id);
  const member = await addMember(workspaceId, "member");
  const foreign = await createWorkspaceMember({ role: "owner" });
  const org = await insertOrganisation("Acme Customer");
  const otherOrg = await insertOrganisation("Other Customer");
  // The workspace serves both organisations: each is bound to a live project in it. The foreign
  // workspace serves neither, so it may not invite into them.
  for (const organisation of [org, otherOrg]) {
    const { project } = await createProjectFixture({ workspaceId });
    await db
      .update(schema.projectTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.projectTable.id, project.id));
  }
  const { app } = createApp();

  function call(
    user: User,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    mockAuthenticatedSession(user);
    return app.request(path, {
      method: init.method ?? "GET",
      headers: JSON_HEADERS,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }
  function portal(
    user: User,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    mockAuthenticatedSession(user, { portal: "customer" });
    return app.request(`http://${PORTAL_HOST}${path}`, {
      method: init.method ?? "GET",
      headers: { host: PORTAL_HOST, ...JSON_HEADERS },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }
  async function json<T>(response: Response, status = 200): Promise<T> {
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  }
  const base = (organisationId = org.id, ws = workspaceId) =>
    `/api/workspace/${ws}/organisations/${organisationId}/invitations`;

  type Sent = {
    id: string;
    email: string;
    status: string;
    delivered: boolean;
  };
  async function invite(email: string, organisationId = org.id) {
    const created = await json<Sent>(
      await call(owner.user, base(organisationId), {
        method: "POST",
        body: { email },
      }),
      201,
    );
    // This helper is for flows that need the link delivered. Route-only tests call `w.call`
    // directly and can assert the response commits before this durable worker runs.
    const priorEmailProvider = emailMock.configured;
    if (priorEmailProvider === null) emailMock.configured = true;
    try {
      if (emailMock.configured === true)
        await runCustomerInvitationDeliveryJob();
    } finally {
      emailMock.configured = priorEmailProvider;
    }
    return { ...created, credential: credentialFor(email, created.id) };
  }
  async function rowOf(id: string) {
    const [row] = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, id));
    return row;
  }
  return {
    owner,
    member,
    foreign,
    org,
    otherOrg,
    workspaceId,
    app,
    call,
    portal,
    json,
    base,
    invite,
    rowOf,
  };
}
export type InviteWorld = Awaited<ReturnType<typeof inviteWorld>>;
