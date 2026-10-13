/** Customer-facing intake responses carry only their declared fields. The create
 * route used to return the stored submission row and the attachment complete route
 * the stored attachment row, including its storage object key. */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  addCustomer,
  buildTenant,
  portalRequest,
} from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

async function seed() {
  const t = await buildTenant("response-shape");
  const customer = await addCustomer(t);
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.intake", enabled: true, locked: false })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: t.workspaceId,
    featureKey: "feature.intake",
    enabled: true,
  });
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: t.workspaceId,
        key: `req-${randomUUID()}`,
        name: "Help",
        group: "General",
        workItemTypeId: t.type.id,
        formSchema: { fields: [] },
        published: true,
        customerVisible: true,
      })
      .returning(),
    "request type",
  );
  await db.insert(schema.requestTypeVersionTable).values({
    workspaceId: t.workspaceId,
    requestTypeId: requestType.id,
    number: 1,
    formSchema: { fields: [] },
    workItemTypeId: t.type.id,
  });
  await db.insert(schema.organisationRequestTypeTable).values({
    organisationId: customer.orgId,
    requestTypeId: requestType.id,
  });
  return { t, customer, requestType };
}

describe("customer-facing intake responses expose only declared fields", () => {
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;
  let root = "";
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-portal-shape-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });
  afterEach(async () => {
    if (originalRoot === undefined)
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    if (originalDriver === undefined)
      delete process.env.TASKDESK_STORAGE_DRIVER;
    else process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
    await rm(root, { recursive: true, force: true });
  });

  it("create submission and complete attachment return the declared shapes", async () => {
    const { t, customer, requestType } = await seed();

    const created = await portalRequest(
      t,
      customer,
      "/api/portal/submissions",
      {
        method: "POST",
        body: { key: requestType.key, formData: {} },
      },
    );
    expect(created.status).toBe(200);
    const submission = (await created.json()) as Record<string, unknown>;
    expect(Object.keys(submission).sort()).toEqual([
      "createdAt",
      "id",
      "number",
      "ref",
      "state",
    ]);
    const ref = String(submission.ref);

    const presign = await portalRequest(
      t,
      customer,
      `/api/portal/submissions/${ref}/attachments/presign`,
      {
        method: "POST",
        body: {
          filename: "evidence.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        },
      },
    );
    expect(presign.status).toBe(200);
    const presigned = (await presign.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    // The signed upload URL targets the host that issued it; send that Host header.
    const upload = await t.app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: {
        ...presigned.uploadHeaders,
        host: new URL(presigned.uploadUrl).host,
      },
      body: PNG_BYTES,
    });
    expect(upload.status).toBe(204);

    const complete = await portalRequest(
      t,
      customer,
      `/api/portal/submissions/${ref}/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(complete.status).toBe(200);
    const attachment = (await complete.json()) as Record<string, unknown>;
    expect(Object.keys(attachment).sort()).toEqual([
      "createdAt",
      "customerVisible",
      "deletedAt",
      "filename",
      "id",
      "mimeType",
      "size",
      "state",
      "submissionId",
      "uploadedBy",
      "workItemId",
    ]);
    expect(JSON.stringify(attachment)).not.toContain("workspace/");
  });
});
