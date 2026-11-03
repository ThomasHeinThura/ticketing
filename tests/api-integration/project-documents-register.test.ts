/**
 * U-15, Thomas's decision of 3 Nov 2026 ("Pages and Documents are different"): the project
 * Documents register. Staff add and edit entries (type, description, customer-visible flag),
 * every write is audited, and the portal's Project Details lists only the customer-visible
 * entries of the caller's own organisation's project.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { portalRequest } from "./helpers/approval-fixtures";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectManageAccess,
  grantProjectRole,
} from "./helpers/fixtures";
import {
  type IntakeSeed,
  seedIntake,
  staffRequest,
} from "./helpers/intake-http";

type Entry = {
  id: string;
  projectId: string;
  title: string;
  url: string;
  kind: string;
  description: string | null;
  customerVisible: boolean;
  updatedAt: string;
};

type PortalDocument = {
  id: string;
  title: string;
  url: string;
  kind: string;
  description: string | null;
};

let s: IntakeSeed;

beforeEach(async () => {
  await resetTestDatabase();
  s = await seedIntake("u15");
  // The staff writer manages the engagement (project:update), as in project-document-links.
  await grantProjectManageAccess(s.t.requester.user.id, s.t.project.id);
  await grantProjectRole(s.t.requester.user.id, s.t.project.id, [
    "project:read",
  ]);
});

async function add(projectId: string, body: Record<string, unknown>) {
  const response = await staffRequest(
    s.t,
    s.t.requester,
    `/api/project/${projectId}/document-links`,
    { method: "POST", body },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Entry;
}

function patch(projectId: string, linkId: string, body: unknown) {
  return staffRequest(
    s.t,
    s.t.requester,
    `/api/project/${projectId}/document-links/${linkId}`,
    { method: "PATCH", body },
  );
}

async function portalDocuments(as: unknown, key: string) {
  const response = await portalRequest(
    s.t,
    as as never,
    `/api/portal/projects/${encodeURIComponent(key)}`,
  );
  return {
    status: response.status,
    text: await response.text(),
  };
}

async function auditRows(entityId: string) {
  return db
    .select()
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.entityType, "document_link"),
        eq(schema.auditLogTable.entityId, entityId),
      ),
    );
}

describe("project Documents register", () => {
  it("adds an entry with a type and description, staff-only by default, and audits it", async () => {
    const entry = await add(s.t.project.id, {
      title: "Statement of work",
      url: "https://docs.example.test/sow",
      kind: "sow",
      description: "Signed version, March.",
    });
    expect(entry).toMatchObject({
      title: "Statement of work",
      kind: "sow",
      description: "Signed version, March.",
      customerVisible: false,
    });

    const [row] = await auditRows(entry.id);
    expect(row?.action).toBe("document_link.created");
    expect(row?.after).toEqual({ kind: "sow", customerVisible: false });
    // The audit never records the title, address or description.
    const recorded = JSON.stringify({ before: row?.before, after: row?.after });
    expect(recorded).not.toContain("docs.example.test");
    expect(recorded).not.toContain("Signed version");
  });

  it("defaults the type to other and rejects an unknown type", async () => {
    const entry = await add(s.t.project.id, {
      title: "Kick-off deck",
      url: "https://docs.example.test/deck",
    });
    expect(entry.kind).toBe("other");
    expect(entry.description).toBeNull();

    const bad = await staffRequest(
      s.t,
      s.t.requester,
      `/api/project/${s.t.project.id}/document-links`,
      {
        method: "POST",
        body: {
          title: "Bad",
          url: "https://docs.example.test/bad",
          kind: "invoice",
        },
      },
    );
    expect(bad.status).toBe(400);
  });

  it("edits an entry, audits the changed fields and visibility, and refuses a bad address", async () => {
    const entry = await add(s.t.project.id, {
      title: "Contract",
      url: "https://docs.example.test/contract",
      kind: "contract",
    });

    const response = await patch(s.t.project.id, entry.id, {
      title: "Master services agreement",
      description: "Countersigned copy",
      customerVisible: true,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const edited = (await response.json()) as Entry;
    expect(edited).toMatchObject({
      title: "Master services agreement",
      kind: "contract",
      description: "Countersigned copy",
      customerVisible: true,
    });

    const updates = (await auditRows(entry.id)).filter(
      (row) => row.action === "document_link.updated",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.before).toEqual({
      kind: "contract",
      customerVisible: false,
    });
    expect(updates[0]?.after).toEqual({
      kind: "contract",
      customerVisible: true,
      changedFields: ["title", "description", "customerVisible"],
    });

    // Clearing the description with an empty value stores null.
    const cleared = await patch(s.t.project.id, entry.id, { description: "" });
    expect(((await cleared.json()) as Entry).description).toBeNull();

    // A no-op edit writes no audit row.
    const before = (await auditRows(entry.id)).length;
    const same = await patch(s.t.project.id, entry.id, { kind: "contract" });
    expect(same.status).toBe(200);
    expect((await auditRows(entry.id)).length).toBe(before);

    for (const url of ["javascript:alert(1)", "not-a-url"]) {
      const refused = await patch(s.t.project.id, entry.id, { url });
      expect(refused.status).toBe(400);
    }
    expect((await patch(s.t.project.id, entry.id, {})).status).toBe(400);
  });

  it("refuses to edit an entry through another project's address", async () => {
    const { project: other } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
      name: "Other engagement",
    });
    await grantProjectManageAccess(s.t.requester.user.id, other.id);
    await grantProjectRole(s.t.requester.user.id, other.id, ["project:read"]);
    const entry = await add(s.t.project.id, {
      title: "Handover pack",
      url: "https://docs.example.test/handover",
      kind: "handover",
    });

    const response = await patch(other.id, entry.id, { title: "Hijacked" });
    expect(response.status).toBe(404);
    const [row] = await db
      .select()
      .from(schema.documentLinkTable)
      .where(eq(schema.documentLinkTable.id, entry.id));
    expect(row?.title).toBe("Handover pack");
  });

  it("refuses a customer session on the staff routes", async () => {
    const entry = await add(s.t.project.id, {
      title: "Design",
      url: "https://docs.example.test/design",
    });
    const response = await portalRequest(
      s.t,
      s.customer,
      `/api/project/${s.t.project.id}/document-links/${entry.id}`,
      { method: "PATCH", body: { customerVisible: true } },
    );
    expect(response.status).not.toBe(200);
    const [row] = await db
      .select()
      .from(schema.documentLinkTable)
      .where(eq(schema.documentLinkTable.id, entry.id));
    expect(row?.customerVisible).toBe(false);
  });
});

describe("portal Project Details documents", () => {
  it("lists only customer-visible entries with their type, and follows visibility changes", async () => {
    const shared = await add(s.t.project.id, {
      title: "Statement of work",
      url: "https://docs.example.test/sow",
      kind: "sow",
      description: "Scope and fees",
      customerVisible: true,
    });
    const internal = await add(s.t.project.id, {
      title: "Internal margin sheet",
      url: "https://docs.example.test/margin",
      kind: "other",
    });
    // A Page added to Documents stays staff-only and never reaches the portal.
    await add(s.t.project.id, {
      title: "Runbook page",
      url: "https://ticketing.example.test/agent/projects/X/pages/p1",
    });

    const first = await portalDocuments(s.customer, s.t.project.slug);
    expect(first.status).toBe(200);
    const documents = (
      JSON.parse(first.text) as { documents: PortalDocument[] }
    ).documents;
    expect(documents).toEqual([
      {
        id: shared.id,
        title: "Statement of work",
        url: "https://docs.example.test/sow",
        kind: "sow",
        description: "Scope and fees",
      },
    ]);
    expect(first.text).not.toContain("margin");
    expect(first.text).not.toContain("Runbook page");
    expect(first.text).not.toContain("customerVisible");

    // Making the internal entry visible shows it; hiding the shared one removes it.
    expect(
      (await patch(s.t.project.id, internal.id, { customerVisible: true }))
        .status,
    ).toBe(200);
    expect(
      (await patch(s.t.project.id, shared.id, { customerVisible: false }))
        .status,
    ).toBe(200);
    const second = await portalDocuments(s.customer, s.t.project.slug);
    const titles = (
      JSON.parse(second.text) as { documents: PortalDocument[] }
    ).documents.map((row) => row.title);
    expect(titles).toEqual(["Internal margin sheet"]);
  });

  it("never shows another organisation's entries (CP-2 isolation)", async () => {
    const fabrikam = await createCustomerPrincipal();
    await add(s.t.project.id, {
      title: "Contoso contract",
      url: "https://docs.example.test/contoso",
      kind: "contract",
      customerVisible: true,
    });

    const foreign = await portalDocuments(fabrikam, s.t.project.slug);
    expect(foreign.status).toBe(404);
    expect(foreign.text).not.toContain("Contoso contract");
  });
});
