/**
 * U-12 / A-03, A-07, A-08: the portal request conversation.
 *
 * - A request raised by staff (`direct`, D6) opens in the portal at `/api/portal/requests/{ref}`
 *   under the case list's reach rule (requester, participant, organisation-visible colleague) and
 *   answers the constant 404 to anyone else, including another organisation (`CP-2`, `CP-16`).
 * - Only public, live comments and customer-visible files reach the portal (`CP-3`, `AT-3`,
 *   `AT-4`); the requester alone replies and sees files (`CP-16`).
 * - A reply is a public comment that notifies staff and asks for a reopen when resolved (`WF-21`).
 * - Staff share a file by attaching it to a public comment as customer-visible (A-07), on a
 *   direct request and on an accepted submission alike.
 * - The requester uploads on an accepted submission (A-08), end to end through the portal host.
 *
 * CP-19 (Thomas, 3 November 2026): on the filesystem storage driver the portal host serves a
 * work-item file only through a portal-bound signed link the portal routes mint after their own
 * check. The link binds the object key, the customer person and a five-minute expiry, and the
 * portal session must be that person. These tests prove byte-identical upload and download on
 * the filesystem driver and refuse another customer, another organisation, an expired link, a
 * tampered key, an internal-comment file and every agent-signed link on the portal host.
 *
 * On the S3 driver the signed URLs point at the bucket. Presigning and signing a download run
 * locally (no network); only `complete` reads the object, so the S3 case writes the bytes with
 * the filesystem driver and completes on it.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeSubmissionAttachment } from "../../apps/api/src/attachment/controllers/complete-submission-attachment";
import { presignSubmissionAttachment } from "../../apps/api/src/attachment/controllers/presign-submission-attachment";
import {
  findReachableSubmissionAttachment,
  findSubmissionAttachmentContent,
  listPortalSubmissionAttachments,
} from "../../apps/api/src/attachment/repository";
import db, { schema } from "../../apps/api/src/database";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { putAttachmentObject } from "../../apps/api/src/storage/filesystem";
import {
  addCustomer,
  buildTenant,
  PORTAL_HOST,
  portalRequest,
  type Tenant,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { grantWorkItemProjectAccess, requireRow } from "./helpers/fixtures";

type Customer = Awaited<ReturnType<typeof addCustomer>>;
type PortalRequestPage = {
  ref: string;
  source: string;
  title: string;
  description: string;
  customerStatus: string;
  canReply: boolean;
  canViewAttachments: boolean;
  canUpload: boolean;
  messages: Array<{
    id: string;
    actorType: string;
    authorName: string | null;
    mine: boolean;
    body: string;
  }>;
};
type PortalFile = {
  id: string;
  filename: string;
  state: string;
  mine: boolean;
  downloadable: boolean;
};

const PDF_BYTES = Buffer.from("%PDF-1.4\n%portal conversation\n%%EOF\n");
const json = { "content-type": "application/json" };
/** Storage settings a test switches; each is restored after every test. */
const STORAGE_ENV = [
  "TASKDESK_STORAGE_FILESYSTEM_ROOT",
  "TASKDESK_STORAGE_DRIVER",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_KEY_PREFIX",
] as const;

/**
 * The S3 driver with a fake, unreachable endpoint and keys generated per run: presigning and
 * download signing are local computations, so nothing is sent anywhere.
 */
function useS3Driver() {
  const endpoint = `https://s3-${randomUUID()}.example.test`;
  process.env.TASKDESK_STORAGE_DRIVER = "s3";
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_BUCKET = `bucket-${randomUUID()}`;
  process.env.S3_ACCESS_KEY_ID = randomUUID();
  process.env.S3_SECRET_ACCESS_KEY = randomUUID();
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
  delete process.env.S3_KEY_PREFIX;
  return new URL(endpoint).host;
}

function useFilesystemDriver() {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
  delete process.env.TASKDESK_STORAGE_DRIVER;
}

function doc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, into);
  else if (value && typeof value === "object")
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      keysDeep(nested, into);
    }
  return into;
}

async function enable(workspaceId: string) {
  for (const featureKey of ["feature.intake", "feature.sla"]) {
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey, enabled: true, locked: false })
      .onConflictDoNothing();
    await db
      .insert(schema.workspaceFeatureFlagTable)
      .values({ workspaceId, featureKey, enabled: true })
      .onConflictDoNothing();
  }
  invalidateFeatureFlagCache();
}

async function workItem(
  tenant: Tenant,
  title: string,
  patch: Partial<typeof schema.workItemTable.$inferInsert> = {},
) {
  mockAuthenticatedSession(tenant.requester.user);
  const response = await tenant.app.request(
    `/api/projects/${tenant.project.id}/work-items`,
    {
      method: "POST",
      headers: json,
      body: JSON.stringify({ typeId: tenant.type.id, title }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const { id } = (await response.json()) as { id: string };
  if (Object.keys(patch).length)
    await db
      .update(schema.workItemTable)
      .set(patch)
      .where(eq(schema.workItemTable.id, id));
  return requireRow(
    await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, id))
      .limit(1),
    "work item",
  );
}

async function staffComment(
  tenant: Tenant,
  workItemId: string,
  text: string,
  visibility: "public" | "internal",
) {
  return requireRow(
    await db
      .insert(schema.commentTable)
      .values({
        workspaceId: tenant.workspaceId,
        workItemId,
        authorId: tenant.requesterPerson.id,
        actorType: "person",
        body: doc(text),
        visibility,
      })
      .returning(),
    "comment",
  );
}

/** A staff upload that is presigned but never completed: it stays `pending`. */
async function staffPendingUpload(
  tenant: Tenant,
  key: string,
  filename: string,
  commentId: string,
) {
  mockAuthenticatedSession(tenant.requester.user);
  const presign = await tenant.app.request(
    `/api/work-items/${key}/attachments/presign`,
    {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        filename,
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        commentId,
        customerVisible: true,
      }),
    },
  );
  expect(presign.status, await presign.clone().text()).toBe(200);
  return ((await presign.json()) as { attachmentId: string }).attachmentId;
}

async function downloadAudits(attachmentId: string) {
  return db
    .select({ actorId: schema.auditLogTable.actorId })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.entityId, attachmentId),
        eq(schema.auditLogTable.action, "attachment.downloaded"),
      ),
    );
}

/** Staff upload through the agent API: on the item, or on one of the staff member's comments. */
async function staffUpload(
  tenant: Tenant,
  key: string,
  filename: string,
  target: { commentId?: string; customerVisible?: boolean } = {},
) {
  mockAuthenticatedSession(tenant.requester.user);
  const presign = await tenant.app.request(
    `/api/work-items/${key}/attachments/presign`,
    {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        filename,
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        ...target,
      }),
    },
  );
  expect(presign.status, await presign.clone().text()).toBe(200);
  const signed = (await presign.json()) as {
    attachmentId: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  };
  const put = await tenant.app.request(signed.uploadUrl, {
    method: "PUT",
    headers: signed.uploadHeaders,
    body: PDF_BYTES,
  });
  expect(put.status).toBe(204);
  mockAuthenticatedSession(tenant.requester.user);
  const complete = await tenant.app.request(
    `/api/attachments/${signed.attachmentId}/complete`,
    { method: "POST" },
  );
  expect(complete.status, await complete.clone().text()).toBe(200);
  return signed.attachmentId;
}

/** A signed filesystem storage URL requested on the portal host, as the customer's browser does. */
async function portalHostStorage(
  tenant: Tenant,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: Buffer },
) {
  const target = new URL(url, `http://${PORTAL_HOST}`);
  return tenant.app.request(
    `http://${PORTAL_HOST}${target.pathname}${target.search}`,
    {
      method: init.method,
      headers: { ...(init.headers ?? {}), host: PORTAL_HOST },
      ...(init.body ? { body: new Uint8Array(init.body) } : {}),
    },
  );
}

/** The bytes behind a portal download route: its 302, then the signed URL on the portal host. */
async function portalDownloadBytes(
  tenant: Tenant,
  who: Customer,
  path: string,
) {
  const redirect = await portalRequest(tenant, who, path);
  expect(redirect.status, await redirect.clone().text()).toBe(302);
  const location = redirect.headers.get("location") ?? "";
  const bytes = await portalHostStorage(tenant, location, { method: "GET" });
  expect(bytes.status, "portal-host download").toBe(200);
  return { location, body: Buffer.from(await bytes.arrayBuffer()) };
}

/** A staff download through the agent API: the agent-signed URL and its bytes. */
async function staffDownload(tenant: Tenant, attachmentId: string) {
  mockAuthenticatedSession(tenant.requester.user);
  const redirect = await tenant.app.request(`/api/attachments/${attachmentId}`);
  expect(redirect.status, await redirect.clone().text()).toBe(302);
  const location = redirect.headers.get("location") ?? "";
  const target = new URL(location, "http://localhost");
  const bytes = await tenant.app.request(`${target.pathname}${target.search}`);
  expect(bytes.status).toBe(200);
  return { location, body: Buffer.from(await bytes.arrayBuffer()) };
}

/** The same signed URL with one query parameter swapped (a tampered link). */
function withParam(url: string, name: string, value: string) {
  const target = new URL(url, `http://${PORTAL_HOST}`);
  target.searchParams.set(name, value);
  return target.toString();
}

/** Run `call` with the clock moved past every signed link's five-minute lifetime. */
async function afterExpiry<T>(call: () => Promise<T>) {
  const later = Date.now() + 10 * 60 * 1000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(later);
  try {
    return await call();
  } finally {
    clock.mockRestore();
  }
}

async function objectKeyOf(attachmentId: string) {
  return requireRow(
    await db
      .select({ objectKey: schema.attachmentTable.objectKey })
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, attachmentId))
      .limit(1),
    "attachment",
  ).objectKey;
}

/** A customer upload through a portal presign path, then the bytes, then completion. */
async function customerUpload(
  tenant: Tenant,
  who: Customer,
  base: string,
  body: Record<string, unknown>,
  bytes: Buffer = PDF_BYTES,
) {
  const presign = await portalRequest(
    tenant,
    who,
    `${base}/attachments/presign`,
    { method: "POST", body },
  );
  if (presign.status !== 200) return { presign };
  const signed = (await presign.json()) as {
    attachmentId: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  };
  // The browser's PUT goes to the URL presign minted: the portal origin.
  expect(new URL(signed.uploadUrl).host).toBe(PORTAL_HOST);
  const put = await portalHostStorage(tenant, signed.uploadUrl, {
    method: "PUT",
    headers: signed.uploadHeaders,
    body: bytes,
  });
  expect(put.status, "portal-host upload").toBe(204);
  const complete = await portalRequest(
    tenant,
    who,
    `${base}/attachments/${signed.attachmentId}/complete`,
    { method: "POST" },
  );
  return { presign, complete, id: signed.attachmentId };
}

async function seed() {
  const contoso = await buildTenant("conv-contoso");
  const fabrikam = await buildTenant("conv-fabrikam");
  const alice = await addCustomer(contoso);
  const bob = await addCustomer(contoso);
  const carol = await addCustomer(contoso);
  const frank = await addCustomer(fabrikam);
  await db
    .update(schema.personTable)
    .set({ displayName: "Sam Support" })
    .where(eq(schema.personTable.id, contoso.requesterPerson.id));
  for (const [tenant, slug] of [
    [contoso, "CONTOSO"],
    [fabrikam, "FABRIKAM"],
  ] as const) {
    await enable(tenant.workspaceId);
    await db
      .update(schema.projectTable)
      .set({ slug })
      .where(eq(schema.projectTable.id, tenant.project.id));
    // Staff work the item: comment, upload and share files.
    await grantWorkItemProjectAccess(
      tenant.requester.user.id,
      tenant.project.id,
    );
  }

  // Raised by staff for Alice, private, assigned to the staff member.
  const privateItem = await workItem(contoso, "Staff raised for Alice", {
    requesterId: alice.person.id,
    customerVisibility: "private",
    description: doc("Please confirm the new VPN profile works."),
    assigneeId: contoso.requesterPerson.id,
    priority: "high",
  });
  // Carol is an explicit participant on Alice's private request.
  await db.insert(schema.requestParticipantTable).values({
    workItemId: privateItem.id,
    personId: carol.person.id,
    addedBy: contoso.requesterPerson.id,
  });
  // Raised by staff for Alice, organisation-visible: Bob reads it.
  const sharedItem = await workItem(contoso, "Shared outage notice", {
    requesterId: alice.person.id,
    customerVisibility: "organisation",
    assigneeId: contoso.requesterPerson.id,
  });
  // Fabrikam's own staff-raised request.
  const fabrikamItem = await workItem(fabrikam, "Fabrikam only", {
    requesterId: frank.person.id,
    customerVisibility: "organisation",
  });
  await staffComment(
    contoso,
    privateItem.id,
    "Can you test it today?",
    "public",
  );
  await staffComment(contoso, privateItem.id, "INTERNAL-ONLY-NOTE", "internal");
  return {
    contoso,
    fabrikam,
    alice,
    bob,
    carol,
    frank,
    privateItem,
    sharedItem,
    fabrikamItem,
  };
}

/** Alice's submission, accepted and converted into a work item she requests. */
async function acceptedSubmission(s: Awaited<ReturnType<typeof seed>>) {
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: s.contoso.workspaceId,
        key: `conv-${randomUUID()}`,
        name: "Support",
        group: "General",
        workItemTypeId: s.contoso.type.id,
        formSchema: { fields: [] },
        published: true,
        customerVisible: true,
      })
      .returning(),
    "request type",
  );
  const version = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: s.contoso.workspaceId,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: { fields: [] },
        workItemTypeId: s.contoso.type.id,
      })
      .returning(),
    "version",
  );
  const accepted = await workItem(s.contoso, "Accepted item", {
    requesterId: s.alice.person.id,
  });
  const submission = requireRow(
    await db
      .insert(schema.submissionTable)
      .values({
        organisationId: s.alice.orgId,
        requesterId: s.alice.person.id,
        requestTypeId: requestType.id,
        requestTypeVersionId: version.id,
        formData: {},
        state: "accepted",
        submittedAt: new Date(),
        customerVisibility: "private",
        workItemId: accepted.id,
      })
      .returning(),
    "submission",
  );
  return { accepted, submission, ref: `SUB-${submission.number}` };
}

describe("portal request conversation (U-12, A-03, A-07, A-08)", () => {
  let root: string;
  const originalEnv = Object.fromEntries(
    STORAGE_ENV.map((name) => [name, process.env[name]]),
  );

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-portal-conv-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    useFilesystemDriver();
  });

  afterEach(async () => {
    for (const name of STORAGE_ENV) {
      const original = originalEnv[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("opens a staff-raised request for its readers with the public conversation only", async () => {
    const s = await seed();
    const base = `/api/portal/requests/${s.privateItem.key}`;
    const response = await portalRequest(s.contoso, s.alice, base);
    expect(response.status, await response.clone().text()).toBe(200);
    const page = (await response.json()) as PortalRequestPage;
    expect(page).toMatchObject({
      ref: s.privateItem.key,
      source: "direct",
      title: "Staff raised for Alice",
      description: "Please confirm the new VPN profile works.",
      canReply: true,
      canViewAttachments: true,
      // A-08: reply files, through a portal-bound signed link on the filesystem driver (CP-19).
      canUpload: true,
    });
    expect(page.messages).toEqual([
      expect.objectContaining({
        actorType: "triager",
        authorName: "Sam Support",
        mine: false,
        body: "Can you test it today?",
      }),
    ]);
    const raw = JSON.stringify(page);
    expect(raw).not.toContain("INTERNAL-ONLY-NOTE");
    const keys = keysDeep(page);
    for (const forbidden of [
      "assignee",
      "assigneeId",
      "claimedBy",
      "workItemId",
      "projectId",
      "authorId",
      "visibility",
    ])
      expect(keys.has(forbidden), forbidden).toBe(false);

    // A participant reads it, read-only, without files (CP-16).
    const carol = await portalRequest(s.contoso, s.carol, base);
    expect(carol.status).toBe(200);
    expect(await carol.json()).toMatchObject({
      canReply: false,
      canViewAttachments: false,
      canUpload: false,
    });

    // On S3 the signed URL points at the bucket: uploads are offered there too.
    useS3Driver();
    const onS3 = await portalRequest(s.contoso, s.alice, base);
    expect(onS3.status).toBe(200);
    expect(await onS3.json()).toMatchObject({ canUpload: true });
  });

  it("answers the constant 404 outside the reach rule and across organisations", async () => {
    const s = await seed();
    const notFound = async (who: Customer, ref: string) => {
      const response = await portalRequest(
        who === s.frank ? s.fabrikam : s.contoso,
        who,
        `/api/portal/requests/${ref}`,
      );
      expect(response.status, `${ref}`).toBe(404);
      return response.text();
    };
    // Bob is a colleague but the request is private and he is not a participant.
    const privateMiss = await notFound(s.bob, s.privateItem.key);
    // Frank is in another organisation.
    const crossOrg = await notFound(s.frank, s.privateItem.key);
    const missing = await notFound(s.alice, "NOPE-999");
    expect(crossOrg).toEqual(privateMiss);
    expect(missing).toEqual(privateMiss);
    // Alice cannot open Fabrikam's request, even though it is organisation-visible there.
    await notFound(s.alice, s.fabrikamItem.key);
    // A submission reference is not a direct request.
    await notFound(s.alice, "SUB-1");

    // Bob reads the organisation-visible request but cannot reply or see its files.
    const shared = await portalRequest(
      s.contoso,
      s.bob,
      `/api/portal/requests/${s.sharedItem.key}`,
    );
    expect(shared.status).toBe(200);
    expect(await shared.json()).toMatchObject({ canReply: false });
    const bobReply = await portalRequest(
      s.contoso,
      s.bob,
      `/api/portal/requests/${s.sharedItem.key}/comments`,
      { method: "POST", body: { body: "Me too" } },
    );
    expect(bobReply.status).toBe(404);
    const bobFiles = await portalRequest(
      s.contoso,
      s.bob,
      `/api/portal/requests/${s.sharedItem.key}/attachments`,
    );
    expect(bobFiles.status).toBe(404);
    const frankReply = await portalRequest(
      s.fabrikam,
      s.frank,
      `/api/portal/requests/${s.privateItem.key}/comments`,
      { method: "POST", body: { body: "Hello" } },
    );
    expect(frankReply.status).toBe(404);

    // The static case routes still answer under the same prefix.
    for (const pathName of [
      "/api/portal/requests/backlog",
      "/api/portal/requests/export.csv",
    ]) {
      const response = await portalRequest(s.contoso, s.alice, pathName);
      expect(response.status, pathName).toBe(200);
    }
  });

  it("posts the requester's reply as a public comment, notifies staff and asks for a reopen when resolved", async () => {
    const s = await seed();
    await db
      .update(schema.workItemTable)
      .set({ resolvedAt: new Date() })
      .where(eq(schema.workItemTable.id, s.privateItem.id));
    const response = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests/${s.privateItem.key}/comments`,
      { method: "POST", body: { body: "Tested, it works." } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const posted = (await response.json()) as {
      message: { id: string; mine: boolean; actorType: string };
    };
    expect(posted.message).toMatchObject({ mine: true, actorType: "customer" });

    const comment = requireRow(
      await db
        .select()
        .from(schema.commentTable)
        .where(eq(schema.commentTable.id, posted.message.id))
        .limit(1),
      "reply comment",
    );
    expect(comment).toMatchObject({
      workItemId: s.privateItem.id,
      authorId: s.alice.person.id,
      visibility: "public",
    });
    // The assignee (staff) is notified; the customer is not notified of their own reply.
    const notified = await db
      .select({ userId: schema.notificationTable.userId })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.resourceId, comment.id));
    expect(notified.map((row) => row.userId)).toContain(
      s.contoso.requester.user.id,
    );
    expect(notified.map((row) => row.userId)).not.toContain(s.alice.user.id);
    // WF-21: the reply to a resolved request is recorded as a reopen request.
    const reopen = await db
      .select({ verb: schema.activityTable.verb })
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, s.privateItem.id),
          eq(schema.activityTable.verb, "reopen_received"),
        ),
      );
    expect(reopen).toHaveLength(1);
    // The audit row is attributed to the customer.
    const audit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, comment.id));
    expect(audit.map((row) => row.action)).toContain("work_item.commented");

    // The reply shows in the portal conversation as the requester's own.
    const page = (await (
      await portalRequest(
        s.contoso,
        s.alice,
        `/api/portal/requests/${s.privateItem.key}`,
      )
    ).json()) as PortalRequestPage;
    expect(page.messages.at(-1)).toMatchObject({
      body: "Tested, it works.",
      mine: true,
      actorType: "customer",
      authorName: null,
    });

    // An empty reply is refused.
    const empty = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests/${s.privateItem.key}/comments`,
      { method: "POST", body: { body: "   " } },
    );
    expect(empty.status).toBe(400);
  });

  it("tells the staff member who asked when the customer replies on an unassigned request (NO-21)", async () => {
    const s = await seed();
    // Unassigned, and nobody watches it: the NO-19 audience alone is empty.
    const item = await workItem(s.contoso, "Unassigned question", {
      requesterId: s.alice.person.id,
      customerVisibility: "private",
    });
    await db
      .delete(schema.watcherTable)
      .where(eq(schema.watcherTable.workItemId, item.id));
    await staffComment(
      s.contoso,
      item.id,
      "Which office are you in?",
      "public",
    );
    const response = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests/${item.key}/comments`,
      { method: "POST", body: { body: "The Berlin office." } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const { message } = (await response.json()) as { message: { id: string } };
    const notified = await db
      .select({ userId: schema.notificationTable.userId })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.resourceId, message.id));
    expect(notified.map((row) => row.userId)).toEqual([
      s.contoso.requester.user.id,
    ]);
  });

  it("links a staff public comment on a direct request into the customer's portal inbox (U-12)", async () => {
    const s = await seed();
    mockAuthenticatedSession(s.contoso.requester.user);
    const comment = await s.contoso.app.request(
      `/api/work-items/${encodeURIComponent(s.privateItem.key)}/comments`,
      {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          visibility: "public",
          body: doc("Please send the error message."),
        }),
      },
    );
    expect(comment.status, await comment.clone().text()).toBe(200);
    const { id: commentId } = (await comment.json()) as { id: string };

    const inbox = await portalRequest(
      s.contoso,
      s.alice,
      "/api/portal/notification/inbox",
    );
    expect(inbox.status, await inbox.clone().text()).toBe(200);
    const page = (await inbox.json()) as {
      unreadCount: number;
      data: Array<{
        kind: string;
        isRead: boolean;
        targetKind: string;
        requestRef: string | null;
        commentId: string | null;
      }>;
    };
    expect(page.data).toEqual([
      expect.objectContaining({
        kind: "work_item.commented",
        targetKind: "request",
        requestRef: s.privateItem.key,
        commentId,
      }),
    ]);
    // The bell counts exactly the unread rows the inbox lists.
    expect(page.unreadCount).toBe(
      page.data.filter((row) => !row.isRead).length,
    );

    // Once the customer loses reach (another requester, private), the row is neither listed
    // nor counted.
    await db
      .update(schema.workItemTable)
      .set({ requesterId: s.bob.person.id })
      .where(eq(schema.workItemTable.id, s.privateItem.id));
    await db
      .delete(schema.requestParticipantTable)
      .where(eq(schema.requestParticipantTable.workItemId, s.privateItem.id));
    const lost = (await (
      await portalRequest(s.contoso, s.alice, "/api/portal/notification/inbox")
    ).json()) as { unreadCount: number; data: unknown[] };
    expect(lost).toMatchObject({ unreadCount: 0, data: [] });
  });

  it("tells only the direct requester, and never about an internal comment (U-12)", async () => {
    const s = await seed();
    const post = async (key: string, visibility: "public" | "internal") => {
      mockAuthenticatedSession(s.contoso.requester.user);
      const response = await s.contoso.app.request(
        `/api/work-items/${encodeURIComponent(key)}/comments`,
        {
          method: "POST",
          headers: json,
          body: JSON.stringify({ visibility, body: doc("Staff note") }),
        },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      return ((await response.json()) as { id: string }).id;
    };
    const internal = await post(s.privateItem.key, "internal");
    // Organisation-visible: Bob reads it in the portal but does not own it.
    const shared = await post(s.sharedItem.key, "public");
    const rowsFor = (resourceId: string) =>
      db
        .select({ userId: schema.notificationTable.userId })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.resourceId, resourceId));
    const customerUsers = [s.alice, s.bob, s.carol, s.frank].map(
      (customer) => customer.user.id,
    );
    const internalRows = (await rowsFor(internal)).map((row) => row.userId);
    for (const userId of customerUsers)
      expect(internalRows).not.toContain(userId);
    const sharedRows = (await rowsFor(shared)).map((row) => row.userId);
    expect(sharedRows).toContain(s.alice.user.id);
    for (const other of [s.bob, s.carol, s.frank])
      expect(sharedRows).not.toContain(other.user.id);
    for (const other of [s.bob, s.frank]) {
      const inbox = await portalRequest(
        other === s.frank ? s.fabrikam : s.contoso,
        other,
        "/api/portal/notification/inbox",
      );
      expect(inbox.status).toBe(200);
      expect(await inbox.json()).toMatchObject({ unreadCount: 0, data: [] });
    }
  });

  it("shares only customer-visible files on the item or a public comment (A-07)", async () => {
    const s = await seed();
    const key = s.privateItem.key;
    await staffUpload(s.contoso, key, "internal.pdf");
    const sharedFile = await staffUpload(s.contoso, key, "shared.pdf", {
      customerVisible: true,
    });
    const publicComment = await staffComment(
      s.contoso,
      s.privateItem.id,
      "Here is the guide",
      "public",
    );
    const guide = await staffUpload(s.contoso, key, "guide.pdf", {
      commentId: publicComment.id,
      customerVisible: true,
    });
    const internalComment = await staffComment(
      s.contoso,
      s.privateItem.id,
      "Internal file",
      "internal",
    );
    // AT-4: an internal comment's file stays internal whatever the request says.
    await staffUpload(s.contoso, key, "forced.pdf", {
      commentId: internalComment.id,
      customerVisible: true,
    });
    // A public comment's file without the explicit flag stays internal (AT-3 default).
    await staffUpload(s.contoso, key, "default.pdf", {
      commentId: publicComment.id,
    });

    const list = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests/${key}/attachments`,
    );
    expect(list.status, await list.clone().text()).toBe(200);
    const files = (await list.json()) as PortalFile[];
    expect(files.map((file) => file.filename).sort()).toEqual([
      "guide.pdf",
      "shared.pdf",
    ]);
    expect(files.every((file) => file.mine === false)).toBe(true);
    // CP-19: every ready file the customer may see is downloadable in the portal.
    expect(files.every((file) => file.downloadable === true)).toBe(true);
    const download = await portalDownloadBytes(
      s.contoso,
      s.alice,
      `/api/portal/requests/${key}/attachments/${guide}`,
    );
    // A portal-bound link on the portal origin, never the agent's generic storage route.
    const signed = new URL(download.location);
    expect(signed.host).toBe(PORTAL_HOST);
    expect(signed.pathname).toBe("/api/storage/portal-download");
    expect(download.body.equals(PDF_BYTES)).toBe(true);
    // AT-6: one audit row, attributed to the customer person.
    expect(await downloadAudits(guide)).toEqual([
      { actorId: s.alice.person.id },
    ]);
    // Deleting the public comment withdraws its file from the portal.
    await db
      .update(schema.commentTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.commentTable.id, publicComment.id));
    const afterDelete = (await (
      await portalRequest(
        s.contoso,
        s.alice,
        `/api/portal/requests/${key}/attachments`,
      )
    ).json()) as PortalFile[];
    expect(afterDelete.map((file) => file.id)).toEqual([sharedFile]);
  });

  it("refuses a portal download link for anyone else, after expiry, for another key and from the agent (CP-19)", async () => {
    const s = await seed();
    const key = s.privateItem.key;
    const base = `/api/portal/requests/${key}`;
    const shared = await staffUpload(s.contoso, key, "shared.pdf", {
      customerVisible: true,
    });
    const publicComment = await staffComment(
      s.contoso,
      s.privateItem.id,
      "Here is the guide",
      "public",
    );
    const guide = await staffUpload(s.contoso, key, "guide.pdf", {
      commentId: publicComment.id,
      customerVisible: true,
    });
    const internalComment = await staffComment(
      s.contoso,
      s.privateItem.id,
      "Internal file",
      "internal",
    );
    const internalFile = await staffUpload(s.contoso, key, "internal.pdf", {
      commentId: internalComment.id,
      customerVisible: true,
    });
    const { location } = await portalDownloadBytes(
      s.contoso,
      s.alice,
      `${base}/attachments/${guide}`,
    );
    const replay = (url: string, who: Customer | null = s.alice) => {
      if (who) mockAuthenticatedSession(who.user, { portal: "customer" });
      return portalHostStorage(s.contoso, url, { method: "GET" });
    };

    // Another customer of the same organisation, and one of another organisation, replaying
    // Alice's link under their own session.
    expect((await replay(location, s.bob)).status).toBe(400);
    expect((await replay(location, s.frank)).status).toBe(400);
    // Expired.
    expect((await afterExpiry(() => replay(location))).status).toBe(400);
    // The token is bound to the guide's key: another file Alice may see, and an internal file.
    for (const other of [shared, internalFile])
      expect(
        (await replay(withParam(location, "key", await objectKeyOf(other))))
          .status,
        other,
      ).toBe(400);
    // A forged token; a key outside the work-item attachment shape is refused by host.
    expect(
      (await replay(withParam(location, "token", "x".repeat(43)))).status,
    ).toBe(400);
    expect(
      (await replay(withParam(location, "key", "workspace/x/other/secret.pdf")))
        .status,
    ).toBe(404);

    // The internal-comment file is never offered, redirected or audited by the portal route.
    const refused = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/attachments/${internalFile}`,
    );
    expect(refused.status).toBe(404);
    expect(await downloadAudits(internalFile)).toEqual([]);

    // Agent-signed links for work-item keys are refused on the portal host, as they are on the
    // generic route, and an agent token is not a portal token.
    for (const id of [internalFile, guide]) {
      const agent = await staffDownload(s.contoso, id);
      expect(agent.body.equals(PDF_BYTES)).toBe(true);
      expect((await replay(agent.location)).status, id).toBe(404);
      const moved = new URL(agent.location, "http://localhost");
      moved.pathname = "/api/storage/portal-download";
      expect((await replay(moved.toString())).status, id).toBe(400);
    }
    // The portal-bound route is the portal host's only: the agent host does not serve it.
    const onAgent = new URL(location);
    mockAuthenticatedSession(s.alice.user, { portal: "customer" });
    const agentHost = await s.contoso.app.request(
      `${onAgent.pathname}${onAgent.search}`,
    );
    expect(agentHost.status).toBe(404);

    // Alice's own link still works for Alice.
    const again = await replay(location);
    expect(again.status).toBe(200);
    expect(Buffer.from(await again.arrayBuffer()).equals(PDF_BYTES)).toBe(true);
  });

  it("on S3, downloads a shared file with an audit row and refuses every other file and reader (A-07, AT-5, AT-6)", async () => {
    const s = await seed();
    const key = s.privateItem.key;
    const base = `/api/portal/requests/${key}`;
    // Staff upload on the filesystem driver, which the test app can take end to end.
    const internalFile = await staffUpload(s.contoso, key, "internal.pdf");
    const publicComment = await staffComment(
      s.contoso,
      s.privateItem.id,
      "Here is the guide",
      "public",
    );
    const guide = await staffUpload(s.contoso, key, "guide.pdf", {
      commentId: publicComment.id,
      customerVisible: true,
    });
    const internalComment = await staffComment(
      s.contoso,
      s.privateItem.id,
      "Internal file",
      "internal",
    );
    const forcedInternal = await staffUpload(s.contoso, key, "forced.pdf", {
      commentId: internalComment.id,
      customerVisible: true,
    });
    const defaultInternal = await staffUpload(s.contoso, key, "default.pdf", {
      commentId: publicComment.id,
    });
    const pending = await staffPendingUpload(
      s.contoso,
      key,
      "draft.pdf",
      publicComment.id,
    );

    const bucketHost = useS3Driver();
    const download = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/attachments/${guide}`,
    );
    expect(download.status, await download.clone().text()).toBe(302);
    expect(new URL(download.headers.get("location") ?? "").host).toBe(
      bucketHost,
    );
    // AT-6: one audit row, attributed to the customer person.
    expect(await downloadAudits(guide)).toEqual([
      { actorId: s.alice.person.id },
    ]);

    // AT-3/AT-4: internal, forced-internal, default-internal and pending files are never served.
    for (const hidden of [
      internalFile,
      forcedInternal,
      defaultInternal,
      pending,
    ]) {
      const refused = await portalRequest(
        s.contoso,
        s.alice,
        `${base}/attachments/${hidden}`,
      );
      expect(refused.status, hidden).toBe(404);
      expect(await downloadAudits(hidden)).toEqual([]);
    }
    // CP-16: a participant reads the request but not its files; CP-2: another organisation
    // never reaches it. Neither writes an audit row.
    const carol = await portalRequest(
      s.contoso,
      s.carol,
      `${base}/attachments/${guide}`,
    );
    expect(carol.status).toBe(404);
    const frank = await portalRequest(
      s.fabrikam,
      s.frank,
      `${base}/attachments/${guide}`,
    );
    expect(frank.status).toBe(404);
    expect(await downloadAudits(guide)).toHaveLength(1);
  });

  it("on S3, takes the requester's reply file and only hers (A-08, CP-16)", async () => {
    const s = await seed();
    const key = s.privateItem.key;
    const base = `/api/portal/requests/${key}`;
    const staffPublic = await staffComment(
      s.contoso,
      s.privateItem.id,
      "Staff public",
      "public",
    );
    const staffInternal = await staffComment(
      s.contoso,
      s.privateItem.id,
      "Staff internal",
      "internal",
    );
    const staffPending = await staffPendingUpload(
      s.contoso,
      key,
      "staff-draft.pdf",
      staffPublic.id,
    );
    const reply = await portalRequest(s.contoso, s.alice, `${base}/comments`, {
      method: "POST",
      body: { body: "Screenshot attached" },
    });
    expect(reply.status).toBe(200);
    const { message } = (await reply.json()) as { message: { id: string } };

    useS3Driver();
    const file = {
      filename: "screen.pdf",
      contentType: "application/pdf",
      size: PDF_BYTES.length,
    };
    // Only her own live public reply takes a file.
    for (const commentId of [staffPublic.id, staffInternal.id]) {
      const refused = await portalRequest(
        s.contoso,
        s.alice,
        `${base}/attachments/presign`,
        { method: "POST", body: { ...file, commentId } },
      );
      expect(refused.status, commentId).toBe(404);
    }
    const presign = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/attachments/presign`,
      { method: "POST", body: { ...file, commentId: message.id } },
    );
    expect(presign.status, await presign.clone().text()).toBe(200);
    const { attachmentId } = (await presign.json()) as {
      attachmentId: string;
    };
    const row = requireRow(
      await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, attachmentId))
        .limit(1),
      "reply file",
    );
    // A comment's file hangs off the comment (AT-1), which belongs to this request.
    expect(row).toMatchObject({
      workItemId: null,
      commentId: message.id,
      customerVisible: true,
      uploadedBy: s.alice.person.id,
      state: "pending",
    });

    // The bytes land where the object key points; completion reads them on the filesystem driver.
    useFilesystemDriver();
    await putAttachmentObject({
      key: row.objectKey,
      bytes: PDF_BYTES,
      maxBytes: PDF_BYTES.length,
    });
    const complete = (who: Customer, id: string) =>
      portalRequest(s.contoso, who, `${base}/attachments/${id}/complete`, {
        method: "POST",
      });
    expect((await complete(s.carol, attachmentId)).status).toBe(404);
    expect((await complete(s.alice, staffPending)).status).toBe(404);
    const done = await complete(s.alice, attachmentId);
    expect(done.status, await done.clone().text()).toBe(200);
    expect(await done.json()).toMatchObject({
      id: attachmentId,
      state: "ready",
      mine: true,
    });

    useS3Driver();
    const listed = (await (
      await portalRequest(s.contoso, s.alice, `${base}/attachments`)
    ).json()) as PortalFile[];
    expect(
      listed.map((entry) => [entry.id, entry.mine, entry.downloadable]),
    ).toEqual([[attachmentId, true, true]]);
    // A reply turned internal by staff takes its file out of the portal.
    await db
      .update(schema.commentTable)
      .set({ visibility: "internal" })
      .where(eq(schema.commentTable.id, message.id));
    const afterInternal = (await (
      await portalRequest(s.contoso, s.alice, `${base}/attachments`)
    ).json()) as PortalFile[];
    expect(afterInternal).toEqual([]);
  });

  it("keeps RT-5 on the server and takes a file field's files after creation (A-08)", async () => {
    const s = await seed();
    const requestTypeWith = async (required: boolean) => {
      const formSchema = {
        fields: [
          { key: "summary", type: "text", label: "Summary", required: true },
          { key: "evidence", type: "file", label: "Evidence", required },
        ],
      };
      const requestType = requireRow(
        await db
          .insert(schema.requestTypeTable)
          .values({
            workspaceId: s.contoso.workspaceId,
            key: `evidence-${randomUUID()}`,
            name: "Evidence",
            group: "General",
            workItemTypeId: s.contoso.type.id,
            formSchema,
            published: true,
            customerVisible: true,
          })
          .returning(),
        "request type",
      );
      await db.insert(schema.requestTypeVersionTable).values({
        workspaceId: s.contoso.workspaceId,
        requestTypeId: requestType.id,
        number: 1,
        formSchema,
        workItemTypeId: s.contoso.type.id,
      });
      await db.insert(schema.organisationRequestTypeTable).values({
        organisationId: s.alice.orgId,
        requestTypeId: requestType.id,
      });
      return requestType;
    };
    // RT-5 is retained: a required, visible field without an answer is refused by the create
    // route for every caller, a file field included (publishing refuses a required file field).
    const strict = await requestTypeWith(true);
    const refused = await portalRequest(
      s.contoso,
      s.alice,
      "/api/portal/submissions",
      {
        method: "POST",
        body: { key: strict.key, formData: { summary: "Logs" } },
      },
    );
    expect(refused.status).toBe(422);

    // An optional file field's files upload to the request once it exists, by field key.
    const optional = await requestTypeWith(false);
    const missingSummary = await portalRequest(
      s.contoso,
      s.alice,
      "/api/portal/submissions",
      { method: "POST", body: { key: optional.key, formData: {} } },
    );
    expect(missingSummary.status).toBe(422);
    const created = await portalRequest(
      s.contoso,
      s.alice,
      "/api/portal/submissions",
      {
        method: "POST",
        body: { key: optional.key, formData: { summary: "Logs" } },
      },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const { ref } = (await created.json()) as { ref: string };
    const uploaded = await customerUpload(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}`,
      {
        filename: "logs.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        fieldKey: "evidence",
      },
    );
    expect(uploaded.complete?.status, await uploaded.complete?.text()).toBe(
      200,
    );
    // Before acceptance a reply is a submission message, not a comment: no reply files.
    const early = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}/attachments/presign`,
      {
        method: "POST",
        body: {
          filename: "early.pdf",
          contentType: "application/pdf",
          size: PDF_BYTES.length,
          commentId: "not-a-reply",
        },
      },
    );
    expect(early.status).toBe(400);
  });

  it("takes the requester's reply file on a direct request byte for byte and refuses replayed upload links (A-08, CP-19)", async () => {
    const s = await seed();
    const base = `/api/portal/requests/${s.privateItem.key}`;
    const reply = await portalRequest(s.contoso, s.alice, `${base}/comments`, {
      method: "POST",
      body: { body: "Screenshot attached" },
    });
    expect(reply.status).toBe(200);
    const { message } = (await reply.json()) as { message: { id: string } };
    const page = (await (
      await portalRequest(s.contoso, s.alice, base)
    ).json()) as PortalRequestPage;
    expect(page.canUpload).toBe(true);
    const presign = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/attachments/presign`,
      {
        method: "POST",
        body: {
          filename: "screen.pdf",
          contentType: "application/pdf",
          size: PDF_BYTES.length,
          commentId: message.id,
        },
      },
    );
    expect(presign.status, await presign.clone().text()).toBe(200);
    const signed = (await presign.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    const uploadUrl = new URL(signed.uploadUrl);
    expect(uploadUrl.host).toBe(PORTAL_HOST);
    expect(uploadUrl.pathname).toBe("/api/storage/portal-attachment-upload");
    // A fresh key under this work item.
    const pendingKey = await objectKeyOf(signed.attachmentId);
    expect(pendingKey).toContain(`/work-item/${s.privateItem.id}/attachment/`);
    const put = (url: string, who: Customer | null = s.alice) => {
      if (who) mockAuthenticatedSession(who.user, { portal: "customer" });
      return portalHostStorage(s.contoso, url, {
        method: "PUT",
        headers: signed.uploadHeaders,
        body: PDF_BYTES,
      });
    };
    // Another customer, another organisation, an expired link, a tampered key or token.
    expect((await put(signed.uploadUrl, s.bob)).status).toBe(400);
    expect((await put(signed.uploadUrl, s.frank)).status).toBe(400);
    expect((await afterExpiry(() => put(signed.uploadUrl))).status).toBe(400);
    const otherKey = pendingKey.replace(
      `/attachment/${signed.attachmentId}/`,
      "/attachment/forged/",
    );
    expect(
      (await put(withParam(signed.uploadUrl, "key", otherKey))).status,
    ).toBe(400);
    expect(
      (await put(withParam(signed.uploadUrl, "maxBytes", "999999999"))).status,
    ).toBe(400);
    // The agent's generic upload route stays closed to work-item keys on the portal host.
    const generic = new URL(signed.uploadUrl);
    generic.pathname = "/api/storage/filesystem-attachment-upload";
    expect((await put(generic.toString())).status).toBe(404);
    // Nor does the agent host take the portal-bound PUT.
    mockAuthenticatedSession(s.alice.user, { portal: "customer" });
    const onAgent = await s.contoso.app.request(
      `${uploadUrl.pathname}${uploadUrl.search}`,
      {
        method: "PUT",
        headers: signed.uploadHeaders,
        body: new Uint8Array(PDF_BYTES),
      },
    );
    expect(onAgent.status).toBe(404);

    // The requester's own PUT, completion, list and byte-identical download.
    expect((await put(signed.uploadUrl)).status).toBe(204);
    const complete = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/attachments/${signed.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(complete.status, await complete.clone().text()).toBe(200);
    expect(await complete.json()).toMatchObject({
      id: signed.attachmentId,
      state: "ready",
      mine: true,
      downloadable: true,
    });
    const files = (await (
      await portalRequest(s.contoso, s.alice, `${base}/attachments`)
    ).json()) as PortalFile[];
    expect(
      files.map((file) => [file.id, file.mine, file.downloadable]),
    ).toEqual([[signed.attachmentId, true, true]]);
    const own = await portalDownloadBytes(
      s.contoso,
      s.alice,
      `${base}/attachments/${signed.attachmentId}`,
    );
    expect(own.body.equals(PDF_BYTES)).toBe(true);
    // Staff see the reply file on the work item, with the same bytes.
    const staff = await staffDownload(s.contoso, signed.attachmentId);
    expect(staff.body.equals(PDF_BYTES)).toBe(true);
    const row = requireRow(
      await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, signed.attachmentId))
        .limit(1),
      "reply file",
    );
    expect(row).toMatchObject({
      commentId: message.id,
      customerVisible: true,
      uploadedBy: s.alice.person.id,
      state: "ready",
    });
    // Customers cannot choose visibility: the field is refused.
    const visibility = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/attachments/presign`,
      {
        method: "POST",
        body: {
          filename: "y.pdf",
          contentType: "application/pdf",
          size: PDF_BYTES.length,
          customerVisible: false,
        },
      },
    );
    expect(visibility.status).toBe(400);
    // A colleague who is not the requester never reaches the upload (CP-16).
    const bob = await portalRequest(
      s.contoso,
      s.bob,
      `${base}/attachments/presign`,
      {
        method: "POST",
        body: {
          filename: "z.pdf",
          contentType: "application/pdf",
          size: PDF_BYTES.length,
        },
      },
    );
    expect(bob.status).toBe(404);
  });

  it("shares public-comment files and accepts uploads on an accepted submission too", async () => {
    const s = await seed();
    const { accepted, ref } = await acceptedSubmission(s);
    const publicComment = await staffComment(
      s.contoso,
      accepted.id,
      "Guide attached",
      "public",
    );
    const guide = await staffUpload(s.contoso, accepted.key, "guide.pdf", {
      commentId: publicComment.id,
      customerVisible: true,
    });
    const internalComment = await staffComment(
      s.contoso,
      accepted.id,
      "Internal",
      "internal",
    );
    const hidden = await staffUpload(s.contoso, accepted.key, "hidden.pdf", {
      commentId: internalComment.id,
      customerVisible: true,
    });
    // A staff file still uploading stays out of the portal until it is ready.
    mockAuthenticatedSession(s.contoso.requester.user);
    const inFlight = await s.contoso.app.request(
      `/api/work-items/${accepted.key}/attachments/presign`,
      {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          filename: "draft.pdf",
          contentType: "application/pdf",
          size: PDF_BYTES.length,
          commentId: publicComment.id,
          customerVisible: true,
        }),
      },
    );
    expect(inFlight.status).toBe(200);
    const list = (await (
      await portalRequest(
        s.contoso,
        s.alice,
        `/api/portal/submissions/${ref}/attachments`,
      )
    ).json()) as PortalFile[];
    expect(list.map((file) => file.id)).toEqual([guide]);
    // CP-19: the staff file (a work-item key) downloads through a portal-bound link.
    expect(list[0]?.downloadable).toBe(true);
    const guideDownload = await portalDownloadBytes(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}/attachments/${guide}`,
    );
    expect(new URL(guideDownload.location).pathname).toBe(
      "/api/storage/portal-download",
    );
    expect(guideDownload.body.equals(PDF_BYTES)).toBe(true);
    // Bound to Alice: Bob's session cannot use it.
    mockAuthenticatedSession(s.bob.user, { portal: "customer" });
    expect(
      (
        await portalHostStorage(s.contoso, guideDownload.location, {
          method: "GET",
        })
      ).status,
    ).toBe(400);
    const refused = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}/attachments/${hidden}`,
    );
    expect(refused.status).toBe(404);

    // A-08: the requester uploads to the accepted request; the file lands on its work item.
    const uploaded = await customerUpload(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}`,
      {
        filename: "logs.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
      },
    );
    expect(uploaded.complete?.status, await uploaded.complete?.text()).toBe(
      200,
    );
    const row = requireRow(
      await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, uploaded.id as string))
        .limit(1),
      "accepted upload",
    );
    expect(row).toMatchObject({
      workItemId: accepted.id,
      submissionId: null,
      customerVisible: true,
      uploadedBy: s.alice.person.id,
      state: "ready",
    });
    // A fresh key under the converted work item, served through a portal-bound link.
    expect(row.objectKey).toContain(`/work-item/${accepted.id}/attachment/`);
    const withOwn = (await (
      await portalRequest(
        s.contoso,
        s.alice,
        `/api/portal/submissions/${ref}/attachments`,
      )
    ).json()) as PortalFile[];
    expect(withOwn.map((file) => [file.id, file.downloadable]).sort()).toEqual(
      [
        [guide, true],
        [uploaded.id, true],
      ].sort(),
    );
    const ownDownload = await portalDownloadBytes(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}/attachments/${uploaded.id}`,
    );
    expect(ownDownload.body.equals(PDF_BYTES)).toBe(true);
    // Staff see it on the work item, with the same bytes.
    expect(
      (await staffDownload(s.contoso, uploaded.id as string)).body.equals(
        PDF_BYTES,
      ),
    ).toBe(true);
    // A-08: a reply on the accepted request carries its file; the file hangs off the reply.
    const posted = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}/messages`,
      { method: "POST", body: { body: "Logs from today attached" } },
    );
    expect(posted.status, await posted.clone().text()).toBe(200);
    const { message: replyMessage } = (await posted.json()) as {
      message: { id: string };
    };
    const withReply = await customerUpload(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}`,
      {
        filename: "reply-logs.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        commentId: replyMessage.id,
      },
    );
    expect(withReply.complete?.status, await withReply.complete?.text()).toBe(
      200,
    );
    const replyRow = requireRow(
      await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, withReply.id as string))
        .limit(1),
      "reply file",
    );
    expect(replyRow).toMatchObject({
      commentId: replyMessage.id,
      workItemId: null,
      customerVisible: true,
      uploadedBy: s.alice.person.id,
      state: "ready",
    });
    expect(replyRow.objectKey).toContain(
      `/work-item/${accepted.id}/attachment/`,
    );
    expect(
      (
        await portalDownloadBytes(
          s.contoso,
          s.alice,
          `/api/portal/submissions/${ref}/attachments/${withReply.id}`,
        )
      ).body.equals(PDF_BYTES),
    ).toBe(true);
    expect(
      (await staffDownload(s.contoso, withReply.id as string)).body.equals(
        PDF_BYTES,
      ),
    ).toBe(true);
    // Only her own live public reply on this item takes a file.
    for (const commentId of [publicComment.id, internalComment.id]) {
      const refusedReply = await portalRequest(
        s.contoso,
        s.alice,
        `/api/portal/submissions/${ref}/attachments/presign`,
        {
          method: "POST",
          body: {
            filename: "x.pdf",
            contentType: "application/pdf",
            size: PDF_BYTES.length,
            commentId,
          },
        },
      );
      expect(refusedReply.status, commentId).toBe(404);
    }
    // A form field does not apply once the request is accepted.
    const field = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${ref}/attachments/presign`,
      {
        method: "POST",
        body: {
          filename: "z.pdf",
          contentType: "application/pdf",
          size: PDF_BYTES.length,
          fieldKey: "evidence",
        },
      },
    );
    expect(field.status).toBe(400);
  });

  it("ends the submission's hold on its item once staff name another requester (A-03, CP-16)", async () => {
    const s = await seed();
    const { accepted, submission, ref } = await acceptedSubmission(s);
    const base = `/api/portal/submissions/${ref}`;
    const publicComment = await staffComment(
      s.contoso,
      accepted.id,
      "Guide attached",
      "public",
    );
    const guide = await staffUpload(s.contoso, accepted.key, "guide.pdf", {
      commentId: publicComment.id,
      customerVisible: true,
    });
    const upload = await customerUpload(s.contoso, s.alice, base, {
      filename: "logs.pdf",
      contentType: "application/pdf",
      size: PDF_BYTES.length,
    });
    expect(upload.complete?.status).toBe(200);
    const posted = await portalRequest(s.contoso, s.alice, `${base}/messages`, {
      method: "POST",
      body: { body: "Logs attached" },
    });
    expect(posted.status, await posted.clone().text()).toBe(200);
    const { message: reply } = (await posted.json()) as {
      message: { id: string };
    };
    const replyFile = await customerUpload(s.contoso, s.alice, base, {
      filename: "reply.pdf",
      contentType: "application/pdf",
      size: PDF_BYTES.length,
      commentId: reply.id,
    });
    expect(replyFile.complete?.status).toBe(200);
    // A file uploaded but not yet completed when the requester changes.
    const pendingPresign = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/attachments/presign`,
      {
        method: "POST",
        body: {
          filename: "late.pdf",
          contentType: "application/pdf",
          size: PDF_BYTES.length,
        },
      },
    );
    expect(pendingPresign.status).toBe(200);
    const pending = (await pendingPresign.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    expect(
      (
        await portalHostStorage(s.contoso, pending.uploadUrl, {
          method: "PUT",
          headers: pending.uploadHeaders,
          body: PDF_BYTES,
        })
      ).status,
    ).toBe(204);
    const itemFiles = [
      guide,
      upload.id as string,
      replyFile.id as string,
      pending.attachmentId,
    ];
    const before = (await (
      await portalRequest(s.contoso, s.alice, `${base}/attachments`)
    ).json()) as PortalFile[];
    expect(before.map((file) => file.id).sort()).toEqual([...itemFiles].sort());

    // A-03: staff name Bob as the item's requester.
    const { version } = requireRow(
      await db
        .select({ version: schema.workItemTable.version })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, accepted.id))
        .limit(1),
      "work item",
    );
    mockAuthenticatedSession(s.contoso.requester.user);
    const reassigned = await s.contoso.app.request(
      `/api/work-items/${encodeURIComponent(accepted.key)}`,
      {
        method: "PATCH",
        headers: { ...json, "if-match": `"${version}"` },
        body: JSON.stringify({ requesterId: s.bob.person.id }),
      },
    );
    expect(reassigned.status, await reassigned.clone().text()).toBe(200);

    // Alice keeps her submission, but none of the item's files, uploads or conversation.
    const list = await portalRequest(s.contoso, s.alice, `${base}/attachments`);
    expect(list.status).toBe(200);
    expect(
      ((await list.json()) as PortalFile[]).map((file) => file.id),
    ).toEqual([]);
    for (const id of itemFiles) {
      const download = await portalRequest(
        s.contoso,
        s.alice,
        `${base}/attachments/${id}`,
      );
      expect(download.status, id).toBe(404);
    }
    for (const commentId of [undefined, reply.id]) {
      const presign = await portalRequest(
        s.contoso,
        s.alice,
        `${base}/attachments/presign`,
        {
          method: "POST",
          body: {
            filename: "more.pdf",
            contentType: "application/pdf",
            size: PDF_BYTES.length,
            ...(commentId ? { commentId } : {}),
          },
        },
      );
      expect(presign.status, commentId ?? "item").toBe(404);
    }
    const complete = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/attachments/${pending.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(complete.status).toBe(404);
    const message = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/messages`,
      { method: "POST", body: { body: "Still there?" } },
    );
    expect(message.status).toBe(404);
    const comments = await db
      .select({ id: schema.commentTable.id })
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, accepted.id));
    expect(comments).toHaveLength(2);

    // The guards hold inside the queries too, for a caller still holding the old link (a
    // request that read the link just before the change).
    const alice = await resolveIdentity({
      userId: s.alice.user.id,
      credential: "session",
    });
    if (!alice) throw new Error("customer identity was not resolved");
    expect(
      await listPortalSubmissionAttachments(db, alice, {
        submissionId: submission.id,
        workItemId: accepted.id,
      }),
    ).toEqual([]);
    for (const id of itemFiles) {
      expect(
        await findSubmissionAttachmentContent(db, alice, {
          id,
          workspaceId: s.contoso.workspaceId,
          submissionId: submission.id,
          linkedWorkItemId: accepted.id,
          portal: true,
        }),
        id,
      ).toEqual([]);
      expect(
        await findReachableSubmissionAttachment(db, {
          identity: alice,
          id,
          workspaceId: s.contoso.workspaceId,
          submissionId: submission.id,
          linkedWorkItemId: accepted.id,
          accepted: true,
          portalDownload: true,
          download: true,
          completion: false,
        }),
        id,
      ).toEqual([]);
    }
    await expect(
      presignSubmissionAttachment({
        submissionId: submission.id,
        workspaceId: s.contoso.workspaceId,
        requesterId: s.alice.person.id,
        acceptedWorkItemId: accepted.id,
        filename: "stale.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        apiBaseUrl: `http://${PORTAL_HOST}`,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      completeSubmissionAttachment({
        attachmentId: pending.attachmentId,
        submissionId: submission.id,
        submissionWorkItemId: accepted.id,
        requesterId: s.alice.person.id,
        workspaceId: s.contoso.workspaceId,
        identity: alice,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const pendingRow = requireRow(
      await db
        .select({ state: schema.attachmentTable.state })
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, pending.attachmentId))
        .limit(1),
      "pending file",
    );
    expect(pendingRow.state).toBe("pending");

    // Bob now holds the item as his own direct request and reads the shared file.
    const cases = await portalRequest(s.contoso, s.bob, "/api/portal/requests");
    expect(cases.status).toBe(200);
    expect(
      (
        (await cases.json()) as {
          cases: Array<{ ref: string; source: string }>;
        }
      ).cases,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: accepted.key, source: "direct" }),
      ]),
    );
    const page = await portalRequest(
      s.contoso,
      s.bob,
      `/api/portal/requests/${accepted.key}`,
    );
    expect(page.status, await page.clone().text()).toBe(200);
    expect(await page.json()).toMatchObject({
      source: "direct",
      canReply: true,
      canViewAttachments: true,
    });
    const bobFiles = (await (
      await portalRequest(
        s.contoso,
        s.bob,
        `/api/portal/requests/${accepted.key}/attachments`,
      )
    ).json()) as PortalFile[];
    expect(bobFiles.map((file) => file.id)).toContain(guide);

    // CP-16: what is said after the move is Bob's alone. A staff answer and Bob's reply never
    // reach Alice's submission page (nor, through it, her colleagues or participants).
    const staffAnswer = await staffComment(
      s.contoso,
      accepted.id,
      "Answer for Bob",
      "public",
    );
    const bobReply = await portalRequest(
      s.contoso,
      s.bob,
      `/api/portal/requests/${accepted.key}/comments`,
      { method: "POST", body: { body: "Bob says thanks" } },
    );
    expect(bobReply.status, await bobReply.clone().text()).toBe(200);
    const { message: bobMessage } = (await bobReply.json()) as {
      message: { id: string };
    };
    const itemCommentIds = (
      await db
        .select({ id: schema.commentTable.id })
        .from(schema.commentTable)
        .where(eq(schema.commentTable.workItemId, accepted.id))
    ).map((row) => row.id);
    expect(itemCommentIds).toEqual(
      expect.arrayContaining([staffAnswer.id, bobMessage.id]),
    );
    const alicePage = await portalRequest(s.contoso, s.alice, base);
    expect(alicePage.status, await alicePage.clone().text()).toBe(200);
    const aliceView = (await alicePage.json()) as {
      workItem: unknown;
      messages: Array<{ id: string; body: string }>;
    };
    expect(aliceView.workItem).toBeNull();
    expect(
      aliceView.messages.filter((entry) => itemCommentIds.includes(entry.id)),
    ).toEqual([]);
    for (const text of ["Answer for Bob", "Bob says thanks"])
      expect(
        aliceView.messages.some((entry) => entry.body.includes(text)),
        text,
      ).toBe(false);

    // Nor can Alice escalate, reopen or rate Bob's request (CP-7, CP-8, CP-9).
    const { priority: bobPriority } = requireRow(
      await db
        .select({ priority: schema.workItemTable.priority })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, accepted.id))
        .limit(1),
      "work item",
    );
    const escalate = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/escalate-priority`,
      { method: "POST", body: { priority: "urgent" } },
    );
    expect(escalate.status, await escalate.clone().text()).toBe(404);
    const resolvedAt = new Date();
    await db
      .update(schema.workItemTable)
      .set({ resolvedAt })
      .where(eq(schema.workItemTable.id, accepted.id));
    const reopen = await portalRequest(s.contoso, s.alice, `${base}/reopen`, {
      method: "POST",
    });
    expect(reopen.status, await reopen.clone().text()).toBe(404);
    const rate = await portalRequest(
      s.contoso,
      s.alice,
      `${base}/satisfaction`,
      { method: "POST", body: { rating: 1 } },
    );
    expect(rate.status, await rate.clone().text()).toBe(404);
    const after = requireRow(
      await db
        .select({
          priority: schema.workItemTable.priority,
          resolvedAt: schema.workItemTable.resolvedAt,
        })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, accepted.id))
        .limit(1),
      "work item",
    );
    expect(after).toEqual({ priority: bobPriority, resolvedAt });
    expect(
      await db
        .select({ id: schema.satisfactionRatingTable.id })
        .from(schema.satisfactionRatingTable)
        .where(eq(schema.satisfactionRatingTable.workItemId, accepted.id)),
    ).toEqual([]);
  });
});
