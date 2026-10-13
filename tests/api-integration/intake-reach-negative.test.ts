/** Negative reach tests for the customer-facing intake surface, over HTTP:
 * RT-8a (an unassigned request type is invisible and unsubmittable), IQ-3 (a reference is
 * not a credential), and portal attachment refusals through the route. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  addCustomer,
  buildTenant,
  portalRequest,
} from "./helpers/approval-fixtures";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { seedIntake, submissionRow, submitAs } from "./helpers/intake-http";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

describe("RT-8a: a request type not assigned to the organisation", () => {
  beforeEach(async () => resetTestDatabase());

  it("is absent from the catalogue and refused when named directly", async () => {
    const s = await seedIntake("rt8a", { assignToOrganisation: false });
    const key = s.requestType.key;

    const catalogue = await portalRequest(
      s.t,
      s.customer,
      "/api/portal/catalogue",
    );
    expect(catalogue.status).toBe(200);
    const listed = (await catalogue.json()) as {
      requestTypes: Array<{ key: string }>;
    };
    expect(listed.requestTypes.map((type) => type.key)).not.toContain(key);

    const detail = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/catalogue/${key}`,
    );
    expect(detail.status).toBe(404);

    const submit = await portalRequest(
      s.t,
      s.customer,
      "/api/portal/submissions",
      { method: "POST", body: { key, formData: { summary: "Crafted" } } },
    );
    expect(submit.status, await submit.clone().text()).toBe(404);
    expect(await db.select().from(schema.submissionTable)).toHaveLength(0);
  });

  it("becomes submittable once assigned (control)", async () => {
    const s = await seedIntake("rt8a-control", {
      assignToOrganisation: false,
    });
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: s.customer.orgId,
      requestTypeId: s.requestType.id,
    });
    expect(await submitAs(s, s.customer)).toMatch(/^SUB-\d+$/);
  });

  it("a request type assigned to another organisation stays unsubmittable here", async () => {
    const s = await seedIntake("rt8a-other-org", {
      assignToOrganisation: false,
    });
    const other = await buildTenant("rt8a-foreign");
    const foreign = await addCustomer(other);
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: foreign.orgId,
      requestTypeId: s.requestType.id,
    });
    const submit = await portalRequest(
      s.t,
      s.customer,
      "/api/portal/submissions",
      {
        method: "POST",
        body: { key: s.requestType.key, formData: { summary: "Crafted" } },
      },
    );
    expect(submit.status).toBe(404);
  });
});

describe("IQ-3: a submission reference is not a credential", () => {
  beforeEach(async () => resetTestDatabase());

  it("refuses the durable page with no session, and for another requester or organisation", async () => {
    const s = await seedIntake("iq3");
    const ref = await submitAs(s, s.customer);
    const sameOrgOther = await addCustomer(s.t);
    const otherTenant = await buildTenant("iq3-foreign");
    const foreign = await addCustomer(otherTenant);

    // Control: the owner reads it.
    const own = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}`,
    );
    expect(own.status).toBe(200);

    mockAnonymousSession();
    const anonymous = await s.t.app.request(
      `http://portal.localhost:5174/api/portal/submissions/${ref}`,
      { headers: { host: "portal.localhost:5174" } },
    );
    // intake-queue.md says 404 for a bare reference; the shared authentication middleware
    // answers 401 before the route runs. Either way the reference grants nothing and no
    // submission data is returned. Reported to the orchestrator as a spec/behaviour gap.
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).not.toContain("Cannot sign in");

    for (const who of [sameOrgOther, foreign]) {
      const response = await portalRequest(
        s.t,
        who,
        `/api/portal/submissions/${ref}`,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Cannot sign in");
      for (const suffix of ["messages", "withdraw"]) {
        const write = await portalRequest(
          s.t,
          who,
          `/api/portal/submissions/${ref}/${suffix}`,
          { method: "POST", body: suffix === "messages" ? { body: "x" } : {} },
        );
        expect(write.status, suffix).toBe(404);
      }
    }
    expect((await submissionRow(ref)).state).toBe("new");
  });
});

describe("portal attachments through the route", () => {
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;
  let root = "";
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-intake-neg-"));
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

  const presign = (
    s: Awaited<ReturnType<typeof seedIntake>>,
    who: Awaited<ReturnType<typeof addCustomer>>,
    ref: string,
  ) =>
    portalRequest(
      s.t,
      who,
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

  it("refuses presign once the submission is declined, withdrawn or a duplicate", async () => {
    const s = await seedIntake("att-state");
    const open = await submitAs(s, s.customer, "Open");
    // Control: an open submission can presign.
    expect((await presign(s, s.customer, open)).status).toBe(200);

    for (const state of ["declined", "withdrawn", "duplicate", "accepted"]) {
      const ref = await submitAs(s, s.customer, `Closed ${state}`);
      await db
        .update(schema.submissionTable)
        .set({ state })
        .where(
          eq(schema.submissionTable.number, Number(ref.replace("SUB-", ""))),
        );
      const response = await presign(s, s.customer, ref);
      expect(response.status, state).toBe(404);
    }
  });

  it("refuses complete for another requester's attachment", async () => {
    const s = await seedIntake("att-owner");
    const mine = await submitAs(s, s.customer, "Mine");
    const other = await addCustomer(s.t);
    const theirs = await submitAs(s, other, "Theirs");
    const signed = await presign(s, s.customer, mine);
    expect(signed.status).toBe(200);
    const { attachmentId } = (await signed.json()) as { attachmentId: string };

    // Another requester naming the owner's submission.
    const viaOwnerRef = await portalRequest(
      s.t,
      other,
      `/api/portal/submissions/${mine}/attachments/${attachmentId}/complete`,
      { method: "POST" },
    );
    expect(viaOwnerRef.status).toBe(404);
    // Another requester naming their own submission with the owner's attachment id.
    const viaOwnRef = await portalRequest(
      s.t,
      other,
      `/api/portal/submissions/${theirs}/attachments/${attachmentId}/complete`,
      { method: "POST" },
    );
    expect(viaOwnRef.status).toBe(404);
    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, attachmentId));
    expect(row?.state).not.toBe("ready");
  });
});
