import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { kbCategoryTable } from "../../apps/api/src/database/schema-p5-kb";
import {
  announcementProjectTable,
  announcementTable,
  releaseTable,
  serviceLinkTable,
  serviceTable,
} from "../../apps/api/src/database/schema-p5-service";
import {
  timeActivityTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { changeProjectCustomerAccess } from "../../apps/api/src/project/members/customer-access";
import {
  addCustomer,
  PORTAL_HOST,
  portalRequest,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import {
  seedIntake,
  staffRequest,
  submissionRow,
  submitAs,
  TITLE_FORM,
} from "./helpers/intake-http";
import { insertArticle, setKbFlag } from "./helpers/p5-kb";
import { setServiceFlag } from "./helpers/p5-service";

beforeEach(async () => {
  await resetTestDatabase();
});

describe("per-person customer project reach", () => {
  it("keeps project-free organisation request types available to a customer with no projects", async () => {
    const s = await seedIntake("customer-project-free-request");
    const c = await addCustomer(s.t);
    await db
      .delete(schema.customerProjectAccessTable)
      .where(eq(schema.customerProjectAccessTable.personId, c.person.id));
    await db
      .update(schema.requestTypeTable)
      .set({ defaultProjectId: null })
      .where(eq(schema.requestTypeTable.id, s.requestType.id));
    await db
      .update(schema.requestTypeVersionTable)
      .set({ defaultProjectId: null })
      .where(eq(schema.requestTypeVersionTable.id, s.version.id));
    const ref = await submitAs(s, c, "Organisation request without a project");
    expect(
      (await portalRequest(s.t, c, `/api/portal/submissions/${ref}`)).status,
    ).toBe(200);
  });
  it("paginates submissions within the four customer access scopes", async () => {
    const s = await seedIntake("customer-pagination-matrix");
    const b = await addCustomer(s.t);
    const c = await addCustomer(s.t);
    const foreign = await createCustomerPrincipal();
    const { project: p2 } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: s.customer.orgId })
      .where(eq(schema.projectTable.id, p2.id));
    await db
      .delete(schema.customerProjectAccessTable)
      .where(eq(schema.customerProjectAccessTable.personId, b.person.id));
    await db
      .delete(schema.customerProjectAccessTable)
      .where(eq(schema.customerProjectAccessTable.personId, c.person.id));
    await db
      .insert(schema.customerProjectAccessTable)
      .values({ personId: b.person.id, projectId: p2.id });
    const secondType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: s.t.workspaceId,
          key: "b8-pagination-p2",
          name: "P2 pagination",
          group: "General",
          workItemTypeId: s.t.type.id,
          defaultProjectId: p2.id,
          formSchema: TITLE_FORM,
          published: true,
          customerVisible: true,
        })
        .returning(),
      "second type",
    );
    await db.insert(schema.requestTypeVersionTable).values({
      workspaceId: s.t.workspaceId,
      requestTypeId: secondType.id,
      number: 1,
      formSchema: TITLE_FORM,
      workItemTypeId: s.t.type.id,
      defaultProjectId: p2.id,
    });
    await db
      .insert(schema.organisationRequestTypeTable)
      .values({ organisationId: b.orgId, requestTypeId: secondType.id });
    const refsA = [
      await submitAs(s, s.customer, "A page one"),
      await submitAs(s, s.customer, "A page two"),
    ];
    const refsB = [
      await submitAs({ t: s.t, requestType: secondType }, b, "B page one"),
      await submitAs({ t: s.t, requestType: secondType }, b, "B page two"),
    ];
    for (const [person, expected] of [
      [s.customer, refsA],
      [b, refsB],
      [c, []],
      [foreign, []],
    ] as const) {
      const firstResponse = await portalRequest(
        s.t,
        person,
        "/api/portal/submissions?limit=1",
      );
      expect(firstResponse.status).toBe(200);
      const first = (await firstResponse.json()) as {
        submissions: { ref: string }[];
        page: { nextCursor: string | null; hasMore: boolean };
        meta: { total: number };
      };
      expect(first.meta.total).toBe(expected.length);
      expect(first.submissions).toHaveLength(expected.length ? 1 : 0);
      expect(first.page.hasMore).toBe(expected.length > 1);
      const seen = first.submissions.map((row) => row.ref);
      if (first.page.nextCursor) {
        const secondResponse = await portalRequest(
          s.t,
          person,
          `/api/portal/submissions?limit=1&cursor=${encodeURIComponent(first.page.nextCursor)}`,
        );
        expect(secondResponse.status).toBe(200);
        const second = (await secondResponse.json()) as typeof first;
        expect(second.meta.total).toBe(expected.length);
        expect(second.page).toEqual({ hasMore: false, nextCursor: null });
        seen.push(...second.submissions.map((row) => row.ref));
      }
      expect(seen.sort()).toEqual([...expected].sort());
    }
    await db
      .delete(schema.customerProjectAccessTable)
      .where(
        eq(schema.customerProjectAccessTable.personId, s.customer.person.id),
      );
    const revoked = await portalRequest(
      s.t,
      s.customer,
      "/api/portal/submissions?limit=1",
    );
    expect(await revoked.json()).toMatchObject({
      submissions: [],
      meta: { total: 0 },
    });
  });

  it("scopes backlog listing and ranking to each customer's live project grants", async () => {
    const s = await seedIntake("customer-backlog-matrix");
    const b = await addCustomer(s.t);
    const c = await addCustomer(s.t);
    const foreign = await createCustomerPrincipal();
    const { project: p2 } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: s.customer.orgId })
      .where(eq(schema.projectTable.id, p2.id));
    await db
      .delete(schema.customerProjectAccessTable)
      .where(
        and(
          eq(schema.customerProjectAccessTable.projectId, s.t.project.id),
          eq(schema.customerProjectAccessTable.personId, b.person.id),
        ),
      );
    await db
      .delete(schema.customerProjectAccessTable)
      .where(
        and(
          eq(schema.customerProjectAccessTable.projectId, s.t.project.id),
          eq(schema.customerProjectAccessTable.personId, c.person.id),
        ),
      );
    await db
      .insert(schema.customerProjectAccessTable)
      .values({ personId: b.person.id, projectId: p2.id });
    const p2State = requireRow(
      await db
        .insert(schema.stateTable)
        .values({ projectId: p2.id, stateTemplateId: s.t.backlog.id })
        .returning(),
      "backlog state",
    );
    const items = [];
    for (const [person, project, stateId, label] of [
      [s.customer, s.t.project, s.t.workItem.stateId, "P1"],
      [b, p2, p2State.id, "P2"],
    ] as const) {
      const group = [];
      for (const n of [1, 2]) {
        const item = requireRow(
          await db
            .insert(schema.workItemTable)
            .values({
              workspaceId: s.t.workspaceId,
              projectId: project.id,
              typeId: s.t.type.id,
              stateId,
              title: `${label} backlog ${n}`,
              number: 8000 + n,
              key: `B8${label}-${8000 + n}`,
              position: String(n),
              requesterId: person.person.id,
              customerVisibility: "organisation",
            })
            .returning(),
          "backlog item",
        );
        await db.insert(schema.submissionTable).values({
          organisationId: person.orgId,
          requesterId: person.person.id,
          requestTypeId: s.requestType.id,
          requestTypeVersionId: s.version.id,
          formData: {},
          state: "accepted",
          submittedAt: new Date(),
          customerVisibility: "organisation",
          workItemId: item.id,
        });
        group.push(item);
      }
      items.push(group);
    }
    const p1Items = items[0];
    const p2Items = items[1];
    if (!p1Items?.[0] || !p1Items[1] || !p2Items?.[0] || !p2Items[1])
      throw new Error("Backlog fixtures missing");
    for (const [person, own, denied] of [
      [s.customer, p1Items, p2Items],
      [b, p2Items, p1Items],
      [c, [], p1Items],
      [foreign, [], p1Items],
    ] as const) {
      const list = await portalRequest(
        s.t,
        person,
        "/api/portal/requests/backlog",
      );
      expect(list.status).toBe(200);
      const text = await list.text();
      for (const item of own) expect(text).toContain(item.key);
      for (const item of denied) {
        expect(text).not.toContain(item.key);
        const blocked = await portalRequest(
          s.t,
          person,
          "/api/portal/requests/rank",
          { method: "POST", body: { key: item.key, beforeId: "missing" } },
        );
        const missing = await portalRequest(
          s.t,
          person,
          "/api/portal/requests/rank",
          { method: "POST", body: { key: "UNKNOWN-B8", beforeId: "missing" } },
        );
        expect(blocked.status).toBe(404);
        expect(await blocked.text()).toBe(await missing.text());
      }
    }
    expect(
      (
        await portalRequest(s.t, s.customer, "/api/portal/requests/rank", {
          method: "POST",
          body: { key: p1Items[0].key, beforeId: p1Items[1].id },
        })
      ).status,
    ).toBe(200);
    await db
      .delete(schema.customerProjectAccessTable)
      .where(
        and(
          eq(schema.customerProjectAccessTable.personId, s.customer.person.id),
          eq(schema.customerProjectAccessTable.projectId, s.t.project.id),
        ),
      );
    expect(
      await (
        await portalRequest(s.t, s.customer, "/api/portal/requests/backlog")
      ).text(),
    ).not.toContain(p1Items[0].key);
    expect(
      (
        await portalRequest(s.t, s.customer, "/api/portal/requests/rank", {
          method: "POST",
          body: { key: p1Items[0].key, beforeId: p1Items[1].id },
        })
      ).status,
    ).toBe(404);
  });
  it("serializes duplicate grants and grant-revoke races with one audit per change", async () => {
    const s = await seedIntake("customer-project-race");
    const person = await addCustomer(s.t);
    await db
      .delete(schema.customerProjectAccessTable)
      .where(
        and(
          eq(schema.customerProjectAccessTable.personId, person.person.id),
          eq(schema.customerProjectAccessTable.projectId, s.t.project.id),
        ),
      );
    const input = {
      projectId: s.t.project.id,
      workspaceId: s.t.workspaceId,
      personId: person.person.id,
      actorId: s.t.requester.user.id,
      actorPersonId: s.t.requesterPerson.id,
    };
    await Promise.all([
      changeProjectCustomerAccess({ ...input, granted: true }),
      changeProjectCustomerAccess({ ...input, granted: true }),
    ]);
    const auditRows = () =>
      db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.entityId, person.person.id),
            eq(schema.auditLogTable.action, "membership.changed"),
          ),
        );
    const first = await auditRows();
    expect(first).toHaveLength(1);
    expect(first[0]?.after).toMatchObject({
      scope: "project",
      scopeId: s.t.project.id,
      granted: true,
    });
    await Promise.all([
      changeProjectCustomerAccess({ ...input, granted: false }),
      changeProjectCustomerAccess({ ...input, granted: true }),
    ]);
    const rows = await auditRows();
    const access = await db
      .select()
      .from(schema.customerProjectAccessTable)
      .where(
        and(
          eq(schema.customerProjectAccessTable.personId, person.person.id),
          eq(schema.customerProjectAccessTable.projectId, s.t.project.id),
        ),
      );
    expect([2, 3]).toContain(rows.length);
    expect(access.length).toBe(rows.length === 3 ? 1 : 0);
    expect(
      rows.filter(
        (row) => (row.after as { granted?: boolean }).granted === false,
      ),
    ).toHaveLength(1);
  });
  it("isolates same-organisation customers and changes reach on grant and revoke", async () => {
    const s = await seedIntake("customer-project-access");
    const b = await addCustomer(s.t);
    const c = await addCustomer(s.t);
    const foreign = await createCustomerPrincipal();
    const ref = await submitAs(
      s,
      s.customer,
      "Confidential engagement request",
    );
    const { project: p2 } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
      name: "Second engagement",
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: s.customer.orgId })
      .where(eq(schema.projectTable.id, p2.id));
    await db
      .delete(schema.customerProjectAccessTable)
      .where(
        and(
          eq(schema.customerProjectAccessTable.projectId, s.t.project.id),
          eq(schema.customerProjectAccessTable.personId, b.person.id),
        ),
      );
    await db
      .delete(schema.customerProjectAccessTable)
      .where(
        and(
          eq(schema.customerProjectAccessTable.projectId, s.t.project.id),
          eq(schema.customerProjectAccessTable.personId, c.person.id),
        ),
      );
    await db
      .insert(schema.customerProjectAccessTable)
      .values({ personId: b.person.id, projectId: p2.id });
    const secondType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: s.t.workspaceId,
          key: "b8-p2-request",
          name: "P2 request",
          group: "General",
          workItemTypeId: s.t.type.id,
          defaultProjectId: p2.id,
          formSchema: TITLE_FORM,
          published: true,
          customerVisible: true,
        })
        .returning(),
      "second request type",
    );
    await db.insert(schema.requestTypeVersionTable).values({
      workspaceId: s.t.workspaceId,
      requestTypeId: secondType.id,
      number: 1,
      formSchema: TITLE_FORM,
      workItemTypeId: s.t.type.id,
      defaultProjectId: p2.id,
    });
    await db
      .insert(schema.organisationRequestTypeTable)
      .values({ organisationId: b.orgId, requestTypeId: secondType.id });
    const ref2 = await submitAs(
      { t: s.t, requestType: secondType },
      b,
      "Second engagement request",
    );

    for (const [person, visible, hidden] of [
      [s.customer, [s.requestType.key], [secondType.key]],
      [b, [secondType.key], [s.requestType.key]],
      [c, [], [s.requestType.key, secondType.key]],
      [foreign, [], [s.requestType.key, secondType.key]],
    ] as const) {
      const catalogue = await portalRequest(
        s.t,
        person,
        "/api/portal/catalogue",
      );
      expect(catalogue.status).toBe(200);
      const body = await catalogue.text();
      for (const key of visible) expect(body).toContain(key);
      for (const key of hidden) {
        expect(body).not.toContain(key);
        const denied = await portalRequest(
          s.t,
          person,
          `/api/portal/catalogue/${key}`,
        );
        const missing = await portalRequest(
          s.t,
          person,
          "/api/portal/catalogue/unknown-b8-key",
        );
        expect(denied.status).toBe(404);
        expect(await denied.text()).toBe(await missing.text());
        expect(
          (
            await portalRequest(s.t, person, "/api/portal/submissions", {
              method: "POST",
              body: { key, formData: { summary: "Denied" } },
            })
          ).status,
        ).toBe(404);
      }
    }

    for (const [person, ownRef, deniedRefs] of [
      [s.customer, ref, [ref2]],
      [b, ref2, [ref]],
      [c, null, [ref, ref2]],
      [foreign, null, [ref, ref2]],
    ] as const) {
      const list = await portalRequest(
        s.t,
        person,
        "/api/portal/submissions?limit=1",
      );
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject({
        submissions: ownRef ? [{ ref: ownRef }] : [],
        page: { hasMore: false, nextCursor: null },
        meta: { total: ownRef ? 1 : 0 },
      });
      for (const deniedRef of deniedRefs) {
        for (const [suffix, body] of [
          ["/messages", { body: "Denied reply" }],
          ["/withdraw", undefined],
          ["/escalate-priority", { priority: "high" }],
          ["/reopen", undefined],
          ["/satisfaction", { rating: 5 }],
        ] as const) {
          const denied = await portalRequest(
            s.t,
            person,
            `/api/portal/submissions/${deniedRef}${suffix}`,
            { method: "POST", body },
          );
          const unknown = await portalRequest(
            s.t,
            person,
            `/api/portal/submissions/SUB-999999${suffix}`,
            { method: "POST", body },
          );
          expect(denied.status).toBe(404);
          expect(await denied.text()).toBe(await unknown.text());
        }
      }
    }

    const activity = requireRow(
      await db
        .insert(timeActivityTable)
        .values({ workspaceId: s.t.workspaceId, name: "B8 work" })
        .returning(),
      "activity",
    );
    for (const [project, marker, managerId, minutes] of [
      [s.t.project, "P1", s.t.requesterPerson.id, 45],
      [p2, "P2", s.t.approverPerson.id, 90],
    ] as const) {
      await db
        .update(schema.projectTable)
        .set({
          name: `${marker} engagement`,
          description: `${marker} information`,
          objective: `${marker} objective`,
          inScope: `${marker} scope`,
          outOfScope: `${marker} exclusions`,
          successCriteria: `${marker} success`,
          managerId,
        })
        .where(eq(schema.projectTable.id, project.id));
      await db.insert(schema.milestoneTable).values({
        projectId: project.id,
        name: `${marker} milestone`,
        date: new Date("2027-01-10"),
      });
      await db.insert(schema.prerequisiteTable).values({
        projectId: project.id,
        title: `${marker} prerequisite`,
        ownerSide: "customer",
        isBlocking: true,
      });
      await db.insert(schema.documentLinkTable).values({
        projectId: project.id,
        title: `${marker} document`,
        url: `https://example.test/${marker}`,
        customerVisible: true,
      });
      await db.insert(schema.stakeholderTable).values({
        projectId: project.id,
        personId: managerId,
        role: `${marker} contact`,
        escalationOrder: 1,
      });
      await db.insert(schema.projectContractTable).values({
        projectId: project.id,
        startDate: "2020-01-01",
        endDate: "2099-12-31",
        contractedMinutes: 600,
        coverage: "9x5",
        kickoffStatus: "completed",
      });
      await db.insert(timeEntryTable).values({
        workspaceId: s.t.workspaceId,
        projectId: project.id,
        personId: managerId,
        date: "2026-11-01",
        minutes,
        activityId: activity.id,
        billable: true,
      });
    }
    for (const [
      person,
      ownProject,
      otherProject,
      ownRef,
      otherRef,
      marker,
      minutes,
    ] of [
      [s.customer, s.t.project, p2, ref, ref2, "P1", 45],
      [b, p2, s.t.project, ref2, ref, "P2", 90],
    ] as const) {
      const detailResponse = await portalRequest(
        s.t,
        person,
        `/api/portal/projects/${ownProject.slug}`,
      );
      expect(detailResponse.status).toBe(200);
      const detail = (await detailResponse.json()) as {
        name: string;
        description: string;
        summary: Record<string, string>;
        contacts: Array<{ role: string | null }>;
        milestones: Array<{ name: string }>;
        prerequisites: Array<{ title: string }>;
        documents: Array<{ title: string; url: string }>;
        contract: {
          startDate: string;
          endDate: string;
          hours: {
            contractedMinutes: number;
            usedMinutes: number;
            remainingMinutes: number;
          };
        };
      };
      expect(detail.name).toBe(`${marker} engagement`);
      expect(detail).toMatchObject({
        key: ownProject.slug,
        kind: "project",
        status: "active",
        health: null,
        supportLevel: null,
        serviceCalendarName: null,
        goLive: { name: `${marker} milestone`, reached: false },
        counts: { outstanding: 1 },
      });
      expect(typeof (detail as { createdAt?: unknown }).createdAt).toBe(
        "string",
      );
      expect(detail.description).toBe(`${marker} information`);
      expect(detail.summary).toEqual({
        objective: `${marker} objective`,
        inScope: `${marker} scope`,
        outOfScope: `${marker} exclusions`,
        successCriteria: `${marker} success`,
      });
      expect(
        detail.contacts.some((contact) => contact.role === `${marker} contact`),
      ).toBe(true);
      expect(detail.milestones.map((row) => row.name)).toEqual([
        `${marker} milestone`,
      ]);
      expect(detail.prerequisites.map((row) => row.title)).toEqual([
        `${marker} prerequisite`,
      ]);
      expect(detail.documents).toMatchObject([
        { title: `${marker} document`, url: `https://example.test/${marker}` },
      ]);
      expect(detail.contract).toMatchObject({
        startDate: "2020-01-01",
        endDate: "2099-12-31",
        hours: {
          contractedMinutes: 600,
          usedMinutes: minutes,
          remainingMinutes: 600 - minutes,
        },
      });
      const denied = await portalRequest(
        s.t,
        person,
        `/api/portal/projects/${otherProject.slug}`,
      );
      const unknown = await portalRequest(
        s.t,
        person,
        "/api/portal/projects/UNKNOWN_B8",
      );
      expect(denied.status).toBe(404);
      expect(await denied.text()).toBe(await unknown.text());
      const list = await portalRequest(
        s.t,
        person,
        "/api/portal/requests?scope=all",
      );
      const listText = await list.text();
      expect(listText).toContain(ownRef);
      expect(listText).not.toContain(otherRef);
      for (const query of [
        "/export.csv?scope=all",
        `?scope=all&q=${encodeURIComponent(ownRef)}`,
      ]) {
        const response = await portalRequest(
          s.t,
          person,
          `/api/portal/requests${query}`,
        );
        const text = await response.text();
        expect(response.status).toBe(200);
        expect(text).toContain(ownRef);
        expect(text).not.toContain(otherRef);
      }
      const ownType =
        person.person.id === b.person.id ? secondType : s.requestType;
      const otherType =
        person.person.id === b.person.id ? s.requestType : secondType;
      expect(
        (
          await portalRequest(
            s.t,
            person,
            `/api/portal/catalogue/${ownType.key}`,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await portalRequest(
            s.t,
            person,
            `/api/portal/catalogue/${otherType.key}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await portalRequest(s.t, person, "/api/portal/submissions", {
            method: "POST",
            body: { key: otherType.key, formData: { summary: "Denied" } },
          })
        ).status,
      ).toBe(404);
      const home = await portalRequest(s.t, person, "/api/portal/home");
      expect(await home.json()).toMatchObject({
        outstanding: 1,
        actionRequired: { total: 0, cases: 0, approvals: 0 },
        closedLast30Days: 0,
        averageFirstResponse: null,
      });
      const scopedHome = await portalRequest(
        s.t,
        person,
        `/api/portal/home?project=${encodeURIComponent(ownProject.slug)}`,
      );
      expect(await scopedHome.json()).toMatchObject({ outstanding: 1 });
      const deniedHome = await portalRequest(
        s.t,
        person,
        `/api/portal/home?project=${encodeURIComponent(otherProject.slug)}`,
      );
      const missingHome = await portalRequest(
        s.t,
        person,
        "/api/portal/home?project=UNKNOWN_B8",
      );
      expect(await deniedHome.text()).toBe(await missingHome.text());
      const cards = await portalRequest(s.t, person, "/api/portal/projects");
      expect(await cards.json()).toMatchObject({
        data: [
          {
            key: ownProject.slug,
            counts: { outstanding: 1, actionRequired: 0 },
          },
        ],
      });
    }
    for (const [person, allowed, denied] of [
      [s.customer, s.t.project.slug, p2.slug],
      [b, p2.slug, s.t.project.slug],
    ] as const) {
      const listed = await portalRequest(s.t, person, "/api/portal/projects");
      expect(listed.status).toBe(200);
      const projects = (await listed.json()) as {
        data: Array<{ key: string }>;
      };
      expect(projects.data.map((row) => row.key)).toEqual([allowed]);
      expect(
        (await portalRequest(s.t, person, `/api/portal/projects/${allowed}`))
          .status,
      ).toBe(200);
      expect(
        (await portalRequest(s.t, person, `/api/portal/projects/${denied}`))
          .status,
      ).toBe(404);
    }
    await setKbFlag(s.t.workspaceId, true);
    await setServiceFlag(s.t.workspaceId, true);
    const resources = [];
    for (const [owner, project, submissionRef, marker] of [
      [s.customer, s.t.project, ref, "P1"],
      [b, p2, ref2, "P2"],
    ] as const) {
      const category = requireRow(
        await db
          .insert(kbCategoryTable)
          .values({ workspaceId: s.t.workspaceId, name: `${marker} category` })
          .returning(),
        "category",
      );
      const article = await insertArticle(s.t.workspaceId, {
        categoryId: category.id,
        title: `${marker} guide`,
        projectId: project.id,
        state: "published",
        customerVisible: true,
      });
      const announcement = requireRow(
        await db
          .insert(announcementTable)
          .values({
            workspaceId: s.t.workspaceId,
            title: `${marker} notice`,
            body: `${marker} notice body`,
            severity: "info",
            audience: "projects",
            startsAt: new Date(Date.now() - 1000),
            publishedAt: new Date(),
          })
          .returning(),
        "announcement",
      );
      await db.insert(announcementProjectTable).values({
        workspaceId: s.t.workspaceId,
        announcementId: announcement.id,
        projectId: project.id,
      });
      const submission = await submissionRow(submissionRef);
      const notification = requireRow(
        await db
          .insert(schema.notificationTable)
          .values({
            userId: owner.user.id,
            personId: owner.person.id,
            type: "task_comment",
            kind: "submission.replied",
            title: `${marker} event`,
            resourceType: "submission",
            resourceId: submission.id,
            isRead: false,
          })
          .returning(),
        "notification",
      );
      const serviceId = `b8-service-${marker}`;
      const releaseId = `b8-release-${marker}`;
      await db.insert(serviceTable).values({
        id: serviceId,
        workspaceId: s.t.workspaceId,
        name: `${marker} service`,
      });
      await db.insert(serviceLinkTable).values({
        workspaceId: s.t.workspaceId,
        serviceId,
        kind: "project",
        projectId: project.id,
      });
      const publishedAt = new Date("2026-11-01T12:00:00Z");
      await db.insert(releaseTable).values({
        id: releaseId,
        workspaceId: s.t.workspaceId,
        name: `${marker} release`,
        serviceId,
        status: "released",
        publishToPortal: true,
        publishedAt,
        portalSnapshot: {
          version: 1,
          name: `${marker} release`,
          serviceName: `${marker} service`,
          plannedDate: null,
          notes: null,
          publishedAt: publishedAt.toISOString(),
        },
      });
      resources.push({
        article,
        announcement,
        notification,
        releaseId,
        category,
      });
    }
    for (const [person, own, other] of [
      [s.customer, resources[0], resources[1]],
      [b, resources[1], resources[0]],
      [c, undefined, resources[0]],
      [foreign, undefined, resources[0]],
    ] as const) {
      const kb = await portalRequest(s.t, person, "/api/portal/kb");
      const kbText = await kb.text();
      expect(kb.status).toBe(200);
      if (own) expect(kbText).toContain(own.article.id);
      if (!own)
        for (const row of resources)
          expect(kbText).not.toContain(row.article.id);
      if (other) expect(kbText).not.toContain(other.article.id);
      const releases = await portalRequest(s.t, person, "/api/portal/releases");
      expect(releases.status).toBe(200);
      const releaseText = await releases.text();
      for (const resource of resources) {
        if (resource === own) expect(releaseText).toContain(resource.releaseId);
        else expect(releaseText).not.toContain(resource.releaseId);
        const detail = await portalRequest(
          s.t,
          person,
          `/api/portal/releases/${resource.releaseId}`,
        );
        if (resource === own) expect(detail.status).toBe(200);
        else {
          const unknown = await portalRequest(
            s.t,
            person,
            "/api/portal/releases/unknown-b8-release",
          );
          expect(detail.status).toBe(404);
          expect(await detail.text()).toBe(await unknown.text());
        }
        if (resource !== own) {
          for (const [url, body] of [
            [
              `/api/portal/kb/${resource.article.id}/feedback`,
              { helpful: true },
            ],
            [
              "/api/portal/kb/deflection",
              { articleId: resource.article.id, query: "guide" },
            ],
          ] as const)
            expect(
              (await portalRequest(s.t, person, url, { method: "POST", body }))
                .status,
            ).toBe(404);
        }
      }
      const categories = await portalRequest(
        s.t,
        person,
        "/api/portal/kb/categories",
      );
      expect(categories.status).toBe(200);
      const categoryText = await categories.text();
      for (const resource of resources) {
        if (resource === own)
          expect(categoryText).toContain(resource.category.id);
        else expect(categoryText).not.toContain(resource.category.id);
      }
      const suggestions = await portalRequest(
        s.t,
        person,
        "/api/portal/kb/deflection?q=guide",
      );
      expect(suggestions.status).toBe(200);
      const suggestionText = await suggestions.text();
      for (const resource of resources)
        if (resource !== own)
          expect(suggestionText).not.toContain(resource.article.id);
      if (own) {
        expect(suggestionText).toContain(own.article.id);
        expect(
          (
            await portalRequest(
              s.t,
              person,
              `/api/portal/kb/${own.article.id}/feedback`,
              { method: "POST", body: { helpful: true } },
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await portalRequest(s.t, person, "/api/portal/kb/deflection", {
              method: "POST",
              body: { articleId: own.article.id, query: "guide" },
            })
          ).status,
        ).toBe(200);
      }
      const notices = await portalRequest(
        s.t,
        person,
        "/api/portal/announcements",
      );
      const noticesText = await notices.text();
      expect(notices.status).toBe(200);
      if (own) expect(noticesText).toContain(own.announcement.id);
      if (!own)
        for (const row of resources)
          expect(noticesText).not.toContain(row.announcement.id);
      if (other) expect(noticesText).not.toContain(other.announcement.id);
      const inbox = await portalRequest(
        s.t,
        person,
        "/api/portal/notification/inbox",
      );
      const inboxText = await inbox.text();
      expect(inbox.status).toBe(200);
      if (own) expect(inboxText).toContain(own.notification.id);
      if (!own)
        for (const row of resources)
          expect(inboxText).not.toContain(row.notification.id);
      if (other) expect(inboxText).not.toContain(other.notification.id);
      if (own) {
        for (const state of ["read", "unread"]) {
          expect(
            (
              await portalRequest(
                s.t,
                person,
                `/api/portal/notification/${own.notification.id}/${state}`,
                { method: "PATCH" },
              )
            ).status,
          ).toBe(200);
        }
        expect(
          (
            await portalRequest(
              s.t,
              person,
              "/api/portal/notification/read-all",
              { method: "PATCH" },
            )
          ).status,
        ).toBe(200);
      }
      if (other) {
        for (const state of ["read", "unread"]) {
          const denied = await portalRequest(
            s.t,
            person,
            `/api/portal/notification/${other.notification.id}/${state}`,
            { method: "PATCH" },
          );
          const unknown = await portalRequest(
            s.t,
            person,
            `/api/portal/notification/unknown-b8-notification/${state}`,
            { method: "PATCH" },
          );
          expect(denied.status).toBe(404);
          expect(await denied.text()).toBe(await unknown.text());
        }
      }
      if (own) {
        expect(
          (await portalRequest(s.t, person, `/api/portal/kb/${own.article.id}`))
            .status,
        ).toBe(200);
        expect(
          (
            await portalRequest(
              s.t,
              person,
              `/api/portal/announcements/${own.announcement.id}`,
            )
          ).status,
        ).toBe(200);
      }
      if (other) {
        for (const [kind, id] of [
          ["kb", other.article.id],
          ["announcements", other.announcement.id],
        ] as const) {
          const denied = await portalRequest(
            s.t,
            person,
            `/api/portal/${kind}/${id}`,
          );
          const missing = await portalRequest(
            s.t,
            person,
            `/api/portal/${kind}/unknown-b8`,
          );
          expect(denied.status).toBe(404);
          expect(await denied.text()).toBe(await missing.text());
        }
      }
    }
    for (const person of [c, foreign]) {
      const listed = await portalRequest(s.t, person, "/api/portal/projects");
      expect(((await listed.json()) as { data: unknown[] }).data).toEqual([]);
      const home = await portalRequest(s.t, person, "/api/portal/home");
      expect(await home.json()).toMatchObject({
        outstanding: 0,
        actionRequired: { total: 0, cases: 0, approvals: 0 },
        closedLast30Days: 0,
        averageFirstResponse: null,
      });
      const missing = await portalRequest(
        s.t,
        person,
        "/api/portal/projects/UNKNOWN_B8",
      );
      const missingBody = await missing.text();
      for (const project of [s.t.project, p2]) {
        const denied = await portalRequest(
          s.t,
          person,
          `/api/portal/projects/${project.slug}`,
        );
        expect(denied.status).toBe(404);
        expect(await denied.text()).toBe(missingBody);
      }
      expect(
        (
          await portalRequest(
            s.t,
            person,
            `/api/portal/projects/${s.t.project.slug}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await portalRequest(s.t, person, `/api/portal/projects/${p2.slug}`))
          .status,
      ).toBe(404);
    }
    for (const person of [b, c, foreign]) {
      for (const path of [
        "/api/portal/requests?scope=all",
        "/api/portal/requests/export.csv?scope=all",
        "/api/portal/home",
      ]) {
        const response = await portalRequest(s.t, person, path);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(ref);
        if (person.person.id !== b.person.id) expect(text).not.toContain(ref2);
      }
      expect(
        (await portalRequest(s.t, person, `/api/portal/submissions/${ref}`))
          .status,
      ).toBe(404);
      if (person.person.id !== b.person.id)
        expect(
          (await portalRequest(s.t, person, `/api/portal/submissions/${ref2}`))
            .status,
        ).toBe(404);
      expect(
        (
          await portalRequest(
            s.t,
            person,
            `/api/portal/catalogue/${s.requestType.key}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await portalRequest(s.t, person, "/api/portal/submissions", {
            method: "POST",
            body: { key: s.requestType.key, formData: { summary: "Denied" } },
          })
        ).status,
      ).toBe(404);
    }
    for (const path of [
      "/api/portal/requests?scope=all",
      "/api/portal/requests/export.csv?scope=all",
      `/api/portal/requests?scope=all&q=${encodeURIComponent(ref)}`,
    ]) {
      const response = await portalRequest(s.t, s.customer, path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(ref);
    }
    expect(
      (await portalRequest(s.t, s.customer, `/api/portal/submissions/${ref}`))
        .status,
    ).toBe(200);
    await grantProjectRole(s.t.requester.user.id, s.t.project.id, [
      "project:manage_members",
    ]);
    await grantProjectRole(s.t.requester.user.id, p2.id, [
      "project:manage_members",
    ]);
    const root = await mkdtemp(path.join(tmpdir(), "taskdesk-b8-files-"));
    const oldRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    const oldDriver = process.env.TASKDESK_STORAGE_DRIVER;
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
    try {
      const files = [];
      const bytes = Buffer.from("%PDF-1.4\n% b8 matrix\n%%EOF\n");
      for (const [owner, project, submissionRef, label] of [
        [s.customer, s.t.project, ref, "P1"],
        [b, p2, ref2, "P2"],
      ] as const) {
        const submission = await submissionRow(submissionRef);
        const objectKey = `workspace/${s.t.workspaceId}/submission/${submission.id}/attachment/${randomUUID()}/final/token-${label}.pdf`;
        await mkdir(path.dirname(path.join(root, objectKey)), {
          recursive: true,
        });
        await writeFile(path.join(root, objectKey), bytes);
        const attachment = requireRow(
          await db
            .insert(schema.attachmentTable)
            .values({
              workspaceId: s.t.workspaceId,
              organisationId: owner.orgId,
              submissionId: submission.id,
              objectKey,
              filename: `${label}.pdf`,
              mimeType: "application/pdf",
              size: bytes.length,
              state: "ready",
              customerVisible: true,
              uploadedBy: owner.person.id,
            })
            .returning(),
          "matrix attachment",
        );
        files.push({ owner, project, submissionRef, attachment, label });
      }
      for (const file of files) {
        const base = `/api/portal/submissions/${file.submissionRef}/attachments`;
        const listing = await portalRequest(s.t, file.owner, base);
        expect(listing.status).toBe(200);
        expect(await listing.json()).toMatchObject([
          { id: file.attachment.id, filename: `${file.label}.pdf` },
        ]);
        const issued = await portalRequest(
          s.t,
          file.owner,
          `${base}/${file.attachment.id}`,
        );
        expect(issued.status).toBe(302);
        const location = issued.headers.get("location");
        if (!location) throw new Error("Missing portal download location");
        const signed = new URL(location);
        const fetchSigned = async (method: "GET" | "HEAD") => {
          mockAuthenticatedSession(file.owner.user, { portal: "customer" });
          return s.t.app.request(
            `http://${PORTAL_HOST}${signed.pathname}${signed.search}`,
            { method, headers: { host: PORTAL_HOST } },
          );
        };
        expect((await fetchSigned("GET")).status).toBe(200);
        expect(
          (
            await portalRequest(
              s.t,
              file.owner,
              `${base}/${file.attachment.id}/preview`,
            )
          ).status,
        ).toBe(200);
        const presign = await portalRequest(
          s.t,
          file.owner,
          `${base}/presign`,
          {
            method: "POST",
            body: {
              filename: "upload.txt",
              contentType: "text/plain",
              size: 8,
            },
          },
        );
        expect(presign.status, await presign.clone().text()).toBe(200);
        for (const other of [s.customer, b, c, foreign].filter(
          (person) => person.person.id !== file.owner.person.id,
        )) {
          for (const suffix of [
            "",
            `/${file.attachment.id}`,
            `/${file.attachment.id}/preview`,
          ]) {
            const denied = await portalRequest(s.t, other, `${base}${suffix}`);
            expect(denied.status).toBe(404);
            const missing = await portalRequest(
              s.t,
              other,
              `/api/portal/submissions/SUB-99999999/attachments${suffix}`,
            );
            expect(await denied.text()).toBe(await missing.text());
          }
          for (const suffix of [
            "/presign",
            `/${file.attachment.id}/complete`,
          ]) {
            const denied = await portalRequest(s.t, other, `${base}${suffix}`, {
              method: "POST",
              body:
                suffix === "/presign"
                  ? {
                      filename: "upload.txt",
                      contentType: "text/plain",
                      size: 8,
                    }
                  : {},
            });
            expect(denied.status).toBe(404);
          }
        }
        const accessPath = `/api/projects/${file.project.id}/customers/${file.owner.person.id}`;
        expect(
          (
            await staffRequest(s.t, s.t.requester, accessPath, {
              method: "DELETE",
            })
          ).status,
        ).toBe(200);
        expect((await portalRequest(s.t, file.owner, base)).status).toBe(404);
        expect((await fetchSigned("GET")).status).toBe(404);
        expect((await fetchSigned("HEAD")).status).toBe(404);
        const resource = resources.find(
          (row) => row.article.projectId === file.project.id,
        );
        if (!resource) throw new Error("Missing project resources");
        expect(
          (
            await portalRequest(
              s.t,
              file.owner,
              `/api/portal/kb/${resource.article.id}`,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await portalRequest(
              s.t,
              file.owner,
              `/api/portal/announcements/${resource.announcement.id}`,
            )
          ).status,
        ).toBe(404);
        await db
          .update(schema.notificationTable)
          .set({ isRead: false })
          .where(eq(schema.notificationTable.id, resource.notification.id));
        expect(
          (
            await portalRequest(
              s.t,
              file.owner,
              `/api/portal/kb/${resource.article.id}/feedback`,
              { method: "POST", body: { helpful: true } },
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await portalRequest(s.t, file.owner, "/api/portal/kb/deflection", {
              method: "POST",
              body: { articleId: resource.article.id, query: "guide" },
            })
          ).status,
        ).toBe(404);
        expect(
          await (
            await portalRequest(s.t, file.owner, "/api/portal/kb/categories")
          ).text(),
        ).not.toContain(resource.category.id);
        for (const state of ["read", "unread"]) {
          expect(
            (
              await portalRequest(
                s.t,
                file.owner,
                `/api/portal/notification/${resource.notification.id}/${state}`,
                { method: "PATCH" },
              )
            ).status,
          ).toBe(404);
        }
        expect(
          (
            await portalRequest(
              s.t,
              file.owner,
              "/api/portal/notification/read-all",
              { method: "PATCH" },
            )
          ).status,
        ).toBe(200);
        const [stillUnread] = await db
          .select({ isRead: schema.notificationTable.isRead })
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.id, resource.notification.id));
        expect(stillUnread?.isRead).toBe(false);
        const inboxAfterRevoke = await portalRequest(
          s.t,
          file.owner,
          "/api/portal/notification/inbox",
        );
        expect(await inboxAfterRevoke.text()).not.toContain(
          resource.notification.id,
        );
        const homeAfterRevoke = await portalRequest(
          s.t,
          file.owner,
          "/api/portal/home",
        );
        expect(await homeAfterRevoke.json()).toMatchObject({ outstanding: 0 });
        expect(
          (
            await staffRequest(s.t, s.t.requester, accessPath, {
              method: "PUT",
            })
          ).status,
        ).toBe(200);
        expect((await portalRequest(s.t, file.owner, base)).status).toBe(200);
      }
      const secondState = requireRow(
        await db
          .insert(schema.stateTable)
          .values({ projectId: p2.id, stateTemplateId: s.t.wip.id })
          .returning(),
        "second project state",
      );
      for (const [owner, project, stateId, label] of [
        [s.customer, s.t.project, s.t.workItem.stateId, "P1"],
        [b, p2, secondState.id, "P2"],
      ] as const) {
        const item = requireRow(
          await db
            .insert(schema.workItemTable)
            .values({
              workspaceId: s.t.workspaceId,
              projectId: project.id,
              typeId: s.t.type.id,
              stateId,
              title: `${label} direct request`,
              number: 9999,
              key: `B8${label}-9999`,
              requesterId: owner.person.id,
              customerVisibility: "organisation",
            })
            .returning(),
          "direct request",
        );
        const approval = requireRow(
          await db
            .insert(schema.approvalTable)
            .values({
              workspaceId: s.t.workspaceId,
              workItemId: item.id,
              transitionId: s.t.gated.id,
              kind: "customer",
              requestedBy: s.t.requesterPerson.id,
              approverId: owner.person.id,
              expiresAt: new Date(Date.now() + 86_400_000),
            })
            .returning(),
          "customer approval",
        );
        const approvalHome = await portalRequest(
          s.t,
          owner,
          "/api/portal/home",
        );
        expect(await approvalHome.json()).toMatchObject({
          outstanding: 2,
          actionRequired: { approvals: 1, total: 1 },
        });
        const approvalList = await portalRequest(
          s.t,
          owner,
          "/api/portal/approvals",
        );
        expect(await approvalList.text()).toContain(approval.id);
        for (const other of [s.customer, b, c, foreign].filter(
          (person) => person.person.id !== owner.person.id,
        )) {
          const otherApprovals = await portalRequest(
            s.t,
            other,
            "/api/portal/approvals",
          );
          expect(await otherApprovals.text()).not.toContain(approval.id);
        }
        const objectKey = `workspace/${s.t.workspaceId}/work-item/${item.id}/attachment/${randomUUID()}/final/token-${label}.pdf`;
        await mkdir(path.dirname(path.join(root, objectKey)), {
          recursive: true,
        });
        await writeFile(path.join(root, objectKey), bytes);
        const attachment = requireRow(
          await db
            .insert(schema.attachmentTable)
            .values({
              workspaceId: s.t.workspaceId,
              organisationId: owner.orgId,
              workItemId: item.id,
              objectKey,
              filename: `${label}-direct.pdf`,
              mimeType: "application/pdf",
              size: bytes.length,
              state: "ready",
              customerVisible: true,
              uploadedBy: s.t.requesterPerson.id,
            })
            .returning(),
          "direct attachment",
        );
        const base = `/api/portal/requests/${item.key}/attachments`;
        const list = await portalRequest(s.t, owner, base);
        expect(list.status).toBe(200);
        expect(await list.json()).toMatchObject([{ id: attachment.id }]);
        const download = await portalRequest(
          s.t,
          owner,
          `${base}/${attachment.id}`,
        );
        expect(download.status).toBe(302);
        const location = download.headers.get("location");
        if (!location) throw new Error("Missing direct download location");
        const signed = new URL(location);
        const signedGet = async () => {
          mockAuthenticatedSession(owner.user, { portal: "customer" });
          return s.t.app.request(
            `http://${PORTAL_HOST}${signed.pathname}${signed.search}`,
            { headers: { host: PORTAL_HOST } },
          );
        };
        expect((await signedGet()).status).toBe(200);
        const presign = await portalRequest(s.t, owner, `${base}/presign`, {
          method: "POST",
          body: { filename: "reply.txt", contentType: "text/plain", size: 8 },
        });
        expect(presign.status).toBe(200);
        for (const other of [s.customer, b, c, foreign].filter(
          (person) => person.person.id !== owner.person.id,
        )) {
          for (const suffix of ["", `/${attachment.id}`]) {
            const denied = await portalRequest(s.t, other, `${base}${suffix}`);
            expect(denied.status).toBe(404);
            const missing = await portalRequest(
              s.t,
              other,
              `/api/portal/requests/NOPE-9999/attachments${suffix}`,
            );
            expect(await denied.text()).toBe(await missing.text());
          }
          for (const suffix of ["/presign", `/${attachment.id}/complete`]) {
            const denied = await portalRequest(s.t, other, `${base}${suffix}`, {
              method: "POST",
              body: {
                filename: "reply.txt",
                contentType: "text/plain",
                size: 8,
              },
            });
            expect(denied.status).toBe(404);
          }
        }
        const accessPath = `/api/projects/${project.id}/customers/${owner.person.id}`;
        expect(
          (
            await staffRequest(s.t, s.t.requester, accessPath, {
              method: "DELETE",
            })
          ).status,
        ).toBe(200);
        const deniedComment = await portalRequest(
          s.t,
          owner,
          `/api/portal/requests/${item.key}/comments`,
          { method: "POST", body: { body: "revoked reply" } },
        );
        const missingComment = await portalRequest(
          s.t,
          owner,
          "/api/portal/requests/UNKNOWN-999999/comments",
          { method: "POST", body: { body: "revoked reply" } },
        );
        expect(deniedComment.status).toBe(404);
        expect(await deniedComment.text()).toBe(await missingComment.text());
        expect((await signedGet()).status).toBe(404);
        expect((await portalRequest(s.t, owner, base)).status).toBe(404);
        const revokedHome = await portalRequest(s.t, owner, "/api/portal/home");
        expect(await revokedHome.json()).toMatchObject({
          outstanding: 0,
          actionRequired: { approvals: 0, total: 0 },
        });
        expect(
          await (
            await portalRequest(s.t, owner, "/api/portal/approvals")
          ).text(),
        ).not.toContain(approval.id);
        expect(
          (
            await staffRequest(s.t, s.t.requester, accessPath, {
              method: "PUT",
            })
          ).status,
        ).toBe(200);
      }
    } finally {
      if (oldRoot === undefined)
        delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
      else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = oldRoot;
      if (oldDriver === undefined) delete process.env.TASKDESK_STORAGE_DRIVER;
      else process.env.TASKDESK_STORAGE_DRIVER = oldDriver;
      await rm(root, { recursive: true, force: true });
    }
    const cAccessPath = `/api/projects/${s.t.project.id}/customers/${c.person.id}`;
    expect(
      (await staffRequest(s.t, s.t.requester, cAccessPath, { method: "PUT" }))
        .status,
    ).toBe(200);
    expect(
      (await portalRequest(s.t, c, `/api/portal/projects/${s.t.project.slug}`))
        .status,
    ).toBe(200);
    expect(
      (
        await staffRequest(s.t, s.t.requester, cAccessPath, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(
      (await portalRequest(s.t, c, `/api/portal/projects/${s.t.project.slug}`))
        .status,
    ).toBe(404);
    const requesterPath = `/api/projects/${s.t.project.id}/customers/${s.customer.person.id}`;
    expect(
      (
        await staffRequest(s.t, s.t.requester, requesterPath, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(
      (await portalRequest(s.t, s.customer, `/api/portal/submissions/${ref}`))
        .status,
    ).toBe(404);
    for (const [suffix, body] of [
      ["/messages", { body: "revoked" }],
      ["/withdraw", undefined],
      ["/escalate-priority", { priority: "high" }],
      ["/reopen", undefined],
      ["/satisfaction", { rating: 5 }],
    ] as const) {
      const denied = await portalRequest(
        s.t,
        s.customer,
        `/api/portal/submissions/${ref}${suffix}`,
        { method: "POST", body },
      );
      const missing = await portalRequest(
        s.t,
        s.customer,
        `/api/portal/submissions/SUB-999999${suffix}`,
        { method: "POST", body },
      );
      expect(denied.status).toBe(404);
      expect(await denied.text()).toBe(await missing.text());
    }
    expect(
      (
        await portalRequest(
          s.t,
          s.customer,
          `/api/portal/releases/${resources[0]?.releaseId}`,
        )
      ).status,
    ).toBe(404);
    const afterRevoke = await portalRequest(
      s.t,
      s.customer,
      "/api/portal/requests?scope=all",
    );
    expect(await afterRevoke.text()).not.toContain(ref);
  });
});
