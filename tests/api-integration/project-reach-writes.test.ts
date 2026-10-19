/**
 * Project reach on two write routes whose target project is named in the body or chosen by the
 * handler (#741): `POST /api/views` with a project scope, and `POST /api/submissions/{ref}/accept`.
 *
 * Triage and view scoping happen within reach. A same-workspace caller who does not reach the
 * target project is answered exactly like a caller naming a project that does not exist, and
 * nothing is created for them. Sessions and API keys decide the same way.
 */
import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { portalRequest } from "./helpers/approval-fixtures";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { seedIntake, staffRequest, submitAs } from "./helpers/intake-http";
import { PROJECT_BODY_TARGET_ROUTE_KEYS } from "./helpers/project-reach-route-keys";
import {
  grantSeesAll,
  PROJECT_KEY_SCOPE,
  setupProjectWorld,
} from "./helpers/project-reach-world";
import {
  addMember,
  json,
  makeApiKey,
  makeState,
  setAmbientHeaders,
} from "./helpers/reach-world";

const rows = async (table: typeof schema.savedViewTable) =>
  Number((await db.select({ n: count() }).from(table))[0]?.n);

describe("API integration: project reach on body-targeted writes (#741)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("the file covers exactly the routes the guard requires of this family", () => {
    expect([...PROJECT_BODY_TARGET_ROUTE_KEYS].sort()).toEqual([
      "GET /api/submissions/{ref}",
      "GET /api/submissions/{ref}/attachments",
      "GET /api/submissions/{ref}/attachments/{id}",
      "POST /api/submissions/{ref}/accept",
      "POST /api/submissions/{ref}/duplicate",
      "POST /api/views",
    ]);
  });

  describe("POST /api/views with a project scope", () => {
    const VIEW_KEY_SCOPE = {
      ...PROJECT_KEY_SCOPE,
      saved_view: ["read", "create"],
    };

    async function arrange() {
      const world = await setupProjectWorld();
      const { app } = createApp();
      const seesAll = await addMember(world.workspaceId, "member");
      await grantSeesAll(world.workspaceId, seesAll.personId);
      const tenant = await setupProjectWorld();
      return { world, app, seesAll, foreignProjectId: tenant.project.id };
    }

    const body = (workspaceId: string, projectId: string) => ({
      workspaceId,
      name: "Scoped view",
      scope: "project",
      scopeId: projectId,
      layout: "list",
      query: { entity: "work_item" },
    });

    it("an unreachable project is answered exactly like a missing one, and no view is created", async () => {
      const a = await arrange();
      mockAuthenticatedSession(a.world.projectAdmin.user);
      const missing = await json(
        a.app,
        "POST",
        "/api/views",
        body(a.world.workspaceId, `missing-${randomUUID()}`),
      );
      const missingText = await missing.text();
      expect(missing.status, missingText).toBe(400);
      const before = await rows(schema.savedViewTable);

      for (const outsider of [
        a.world.outsiderAdmin,
        a.world.outsiderLead,
        a.world.outsiderMember,
        a.world.otherProjectAdmin,
      ]) {
        mockAuthenticatedSession(outsider.user);
        // The caller's own workspace, a project of the same workspace they do not reach, and
        // another tenant's project: three answers, one body.
        for (const projectId of [a.world.project.id, a.foreignProjectId]) {
          const response = await json(
            a.app,
            "POST",
            "/api/views",
            body(a.world.workspaceId, projectId),
          );
          const text = await response.text();
          expect(response.status, text).toBe(400);
          expect(text).toBe(missingText);
          expect(await rows(schema.savedViewTable)).toBe(before);
        }
      }
    });

    it("a member of the project, and a sees_all holder, create the view", async () => {
      const a = await arrange();
      for (const caller of [a.world.projectAdmin, a.seesAll]) {
        mockAuthenticatedSession(caller.user);
        const response = await json(
          a.app,
          "POST",
          "/api/views",
          body(a.world.workspaceId, a.world.project.id),
        );
        expect(response.status, await response.clone().text()).toBe(200);
      }
      expect(await rows(schema.savedViewTable)).toBe(2);
      // sees_all reaches the project the member did not join, too.
      mockAuthenticatedSession(a.seesAll.user);
      const other = await json(
        a.app,
        "POST",
        "/api/views",
        body(a.world.workspaceId, a.world.otherProject.id),
      );
      expect(other.status, await other.clone().text()).toBe(200);
    });

    it("API key: an outsider's key gets the missing-project answer; a member's key succeeds", async () => {
      const a = await arrange();
      mockAnonymousSession();
      const outsiderKey = await makeApiKey(
        a.world.outsiderAdmin.user.id,
        VIEW_KEY_SCOPE,
      );
      const memberKey = await makeApiKey(
        a.world.projectAdmin.user.id,
        VIEW_KEY_SCOPE,
      );
      setAmbientHeaders({ "x-api-key": memberKey });
      const missing = await json(
        a.app,
        "POST",
        "/api/views",
        body(a.world.workspaceId, `missing-${randomUUID()}`),
      );
      const missingText = await missing.text();
      expect(missing.status, missingText).toBe(400);
      const before = await rows(schema.savedViewTable);

      setAmbientHeaders({ "x-api-key": outsiderKey });
      const outside = await json(
        a.app,
        "POST",
        "/api/views",
        body(a.world.workspaceId, a.world.project.id),
      );
      const outsideText = await outside.text();
      expect(outside.status, outsideText).toBe(400);
      expect(outsideText).toBe(missingText);
      expect(await rows(schema.savedViewTable)).toBe(before);

      setAmbientHeaders({ "x-api-key": memberKey });
      const allowed = await json(
        a.app,
        "POST",
        "/api/views",
        body(a.world.workspaceId, a.world.project.id),
      );
      expect(allowed.status, await allowed.clone().text()).toBe(200);
    });

    it("a workspace-scoped view needs no project reach", async () => {
      const a = await arrange();
      mockAuthenticatedSession(a.world.outsiderAdmin.user);
      const response = await json(a.app, "POST", "/api/views", {
        workspaceId: a.world.workspaceId,
        name: "Workspace scoped",
        scope: "workspace",
        scopeId: a.world.workspaceId,
        layout: "list",
        query: { entity: "work_item" },
      });
      expect(response.status, await response.clone().text()).toBe(200);
    });
  });

  describe("POST /api/submissions/{ref}/accept", () => {
    async function arrange() {
      const s = await seedIntake("reach-accept");
      const wsId = s.t.workspaceId;
      // A second project of the same customer organisation, with a default state, so a
      // destination guard that forgot reach would ACCEPT into it.
      const { project: second } = await createProjectFixture({
        workspaceId: wsId,
        name: "Second destination",
      });
      await db
        .update(schema.projectTable)
        .set({ organisationId: s.customer.orgId })
        .where(eq(schema.projectTable.id, second.id));
      await makeState(wsId, second.id, "backlog", true);
      const secondStaff = await addMember(wsId, "admin");
      await grantProjectRole(secondStaff.user.id, second.id, [
        "project:read",
        "work_item:read",
        "work_item:create",
      ]);
      const seesAll = await addMember(wsId, "admin");
      await grantSeesAll(wsId, seesAll.personId);
      // The tenant fixture already holds one work item; "created" means above this.
      const baseline = (await db.select().from(schema.workItemTable)).length;
      return { s, second, secondStaff, seesAll, baseline };
    }

    type A = Awaited<ReturnType<typeof arrange>>;

    const acceptBody = (a: A, projectId: string) => ({
      method: "POST",
      body: { projectId, workItemTypeId: a.s.t.type.id },
    });

    async function snapshotOf(ref: string) {
      const number = Number(ref.replace("SUB-", ""));
      const submissions = await db.select().from(schema.submissionTable);
      const submission = submissions.find((row) => row.number === number);
      const items = await db.select().from(schema.workItemTable);
      return {
        state: submission?.state,
        workItemId: submission?.workItemId,
        claimedBy: submission?.claimedBy,
        workItems: items.length,
      };
    }

    it("an unreachable destination project is answered exactly like a missing one and creates no work item", async () => {
      const a = await arrange();
      const refMissing = await submitAs(a.s, a.s.customer, "Missing target");
      const refOutside = await submitAs(a.s, a.s.customer, "Outside target");

      // The tenant's requester reaches the first project only.
      const missing = await staffRequest(
        a.s.t,
        a.s.t.requester,
        `/api/submissions/${refMissing}/accept`,
        acceptBody(a, `missing-${randomUUID()}`),
      );
      const missingText = await missing.text();
      expect(missing.status, missingText).toBe(422);

      const outside = await staffRequest(
        a.s.t,
        a.s.t.requester,
        `/api/submissions/${refOutside}/accept`,
        acceptBody(a, a.second.id),
      );
      const outsideText = await outside.text();
      expect(outside.status, outsideText).toBe(422);
      expect(outsideText).toBe(missingText);

      // Same effect, and nothing was converted: the submission is still open, no item exists.
      const m = await snapshotOf(refMissing);
      const o = await snapshotOf(refOutside);
      expect(o.state).toBe(m.state);
      expect(o.workItemId).toBeNull();
      expect(o.workItems).toBe(a.baseline);
      // #743: the failed attempts released their claim, identically for both.
      expect(m.claimedBy).toBeNull();
      expect(o.claimedBy).toBeNull();
    });

    it("the staff member who reaches the second project accepts into it; the requester cannot, and neither can they reach the first", async () => {
      const a = await arrange();
      const ref = await submitAs(a.s, a.s.customer, "Second project");
      const denied = await staffRequest(
        a.s.t,
        a.secondStaff,
        `/api/submissions/${ref}/accept`,
        acceptBody(a, a.s.t.project.id),
      );
      expect(denied.status, await denied.clone().text()).toBe(422);
      expect((await snapshotOf(ref)).workItems).toBe(a.baseline);

      const accepted = await staffRequest(
        a.s.t,
        a.secondStaff,
        `/api/submissions/${ref}/accept`,
        acceptBody(a, a.second.id),
      );
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      expect((await snapshotOf(ref)).workItems).toBe(a.baseline + 1);
    });

    it("a sees_all holder accepts into any project of the workspace", async () => {
      const a = await arrange();
      const ref = await submitAs(a.s, a.s.customer, "Sees all");
      const accepted = await staffRequest(
        a.s.t,
        a.seesAll,
        `/api/submissions/${ref}/accept`,
        acceptBody(a, a.second.id),
      );
      expect(accepted.status, await accepted.clone().text()).toBe(200);
    });

    it("API key: a key whose owner does not reach the project gets the missing-project answer; the reaching owner's key succeeds", async () => {
      const a = await arrange();
      mockAnonymousSession();
      const scope = { intake: ["triage"], workspace: ["read"] };
      const outsiderKey = await makeApiKey(a.s.t.requester.user.id, scope);
      const memberKey = await makeApiKey(a.secondStaff.user.id, scope);
      const refMissing = await submitAs(a.s, a.s.customer, "Key missing");
      const refOutside = await submitAs(a.s, a.s.customer, "Key outside");
      const refOk = await submitAs(a.s, a.s.customer, "Key ok");
      const post = (ref: string, projectId: string) =>
        json(a.s.t.app, "POST", `/api/submissions/${ref}/accept`, {
          projectId,
          workItemTypeId: a.s.t.type.id,
        });

      setAmbientHeaders({ "x-api-key": outsiderKey });
      const missing = await post(refMissing, `missing-${randomUUID()}`);
      const missingText = await missing.text();
      expect(missing.status, missingText).toBe(422);
      const outside = await post(refOutside, a.second.id);
      const outsideText = await outside.text();
      expect(outside.status, outsideText).toBe(422);
      expect(outsideText).toBe(missingText);
      expect((await snapshotOf(refOutside)).workItems).toBe(a.baseline);

      setAmbientHeaders({ "x-api-key": memberKey });
      const ok = await post(refOk, a.second.id);
      setAmbientHeaders({});
      expect(ok.status, await ok.clone().text()).toBe(200);
    });
  });

  describe("duplicate suggestions and linking name only work items the triager reaches", () => {
    async function arrange() {
      const s = await seedIntake("reach-duplicates");
      const wsId = s.t.workspaceId;
      const { project: second } = await createProjectFixture({
        workspaceId: wsId,
        name: "Second destination",
      });
      await db
        .update(schema.projectTable)
        .set({ organisationId: s.customer.orgId })
        .where(eq(schema.projectTable.id, second.id));
      await makeState(wsId, second.id, "backlog", true);
      const secondStaff = await addMember(wsId, "admin");
      await grantProjectRole(secondStaff.user.id, second.id, [
        "project:read",
        "work_item:read",
        "work_item:create",
      ]);
      const seesAll = await addMember(wsId, "admin");
      await grantSeesAll(wsId, seesAll.personId);
      const create = async (
        user: { id: string },
        projectId: string,
        title: string,
      ) => {
        mockAuthenticatedSession(user as never);
        const response = await json(
          s.t.app,
          "POST",
          `/api/projects/${projectId}/work-items`,
          { typeId: s.t.type.id, title },
        );
        expect(response.status, await response.clone().text()).toBe(200);
        return (await response.json()) as { id: string; key: string };
      };
      const TITLE = "Lobby printer is on fire";
      const own = await create(s.t.requester.user, s.t.project.id, TITLE);
      const hidden = await create(
        secondStaff.user,
        second.id,
        `${TITLE} again`,
      );
      const ref = await submitAs(s, s.customer, TITLE);
      return { s, second, secondStaff, seesAll, own, hidden, ref };
    }

    const keysOf = async (response: Response) =>
      (
        (await response.json()) as { suggestions: { key: string }[] }
      ).suggestions
        .map((x) => x.key)
        .sort();

    it("the suggestions a triager gets exclude work items of projects outside reach", async () => {
      const a = await arrange();
      const path = `/api/submissions/${a.ref}/duplicates`;
      const mine = await staffRequest(a.s.t, a.s.t.requester, path);
      expect(mine.status, await mine.clone().text()).toBe(200);
      const text = await mine.clone().text();
      expect(await keysOf(mine)).toEqual([a.own.key]);
      expect(text).not.toContain(a.hidden.key);
      expect(text).not.toContain("again");

      const other = await staffRequest(a.s.t, a.secondStaff, path);
      expect(await keysOf(other)).toEqual([a.hidden.key]);
      const all = await staffRequest(a.s.t, a.seesAll, path);
      expect(await keysOf(all)).toEqual([a.own.key, a.hidden.key].sort());
    });

    it("API key: the same decision for a key's owner", async () => {
      const a = await arrange();
      mockAnonymousSession();
      const scope = { intake: ["triage"], workspace: ["read"] };
      const outsiderKey = await makeApiKey(a.s.t.requester.user.id, scope);
      const memberKey = await makeApiKey(a.secondStaff.user.id, scope);
      const path = `/api/submissions/${a.ref}/duplicates`;
      setAmbientHeaders({ "x-api-key": outsiderKey });
      expect(await keysOf(await json(a.s.t.app, "GET", path))).toEqual([
        a.own.key,
      ]);
      setAmbientHeaders({ "x-api-key": memberKey });
      expect(await keysOf(await json(a.s.t.app, "GET", path))).toEqual([
        a.hidden.key,
      ]);
    });

    it("linking a submission to a work item outside reach answers like a missing item and links nothing", async () => {
      const a = await arrange();
      const missing = await staffRequest(
        a.s.t,
        a.s.t.requester,
        `/api/submissions/${a.ref}/duplicate`,
        { method: "POST", body: { workItemId: `missing-${randomUUID()}` } },
      );
      const missingText = await missing.text();
      expect(missing.status, missingText).toBe(404);
      const outside = await staffRequest(
        a.s.t,
        a.s.t.requester,
        `/api/submissions/${a.ref}/duplicate`,
        { method: "POST", body: { workItemId: a.hidden.id } },
      );
      const outsideText = await outside.text();
      expect(outside.status, outsideText).toBe(404);
      expect(outsideText).toBe(missingText);
      const [row] = await db.select().from(schema.submissionTable);
      expect(row?.state).not.toBe("duplicate");
      expect(row?.workItemId).toBeNull();

      const ok = await staffRequest(
        a.s.t,
        a.s.t.requester,
        `/api/submissions/${a.ref}/duplicate`,
        { method: "POST", body: { workItemId: a.own.id } },
      );
      expect(ok.status, await ok.clone().text()).toBe(200);
    });
  });

  describe("GET /api/submissions/{ref}: an accepted submission's work item is shown only within reach", () => {
    it("a triager without reach to the destination sees neither the work item id nor its public comments", async () => {
      const s = await seedIntake("reach-detail");
      const wsId = s.t.workspaceId;
      const { project: second } = await createProjectFixture({
        workspaceId: wsId,
        name: "Second destination",
      });
      await db
        .update(schema.projectTable)
        .set({ organisationId: s.customer.orgId })
        .where(eq(schema.projectTable.id, second.id));
      await makeState(wsId, second.id, "backlog", true);
      const secondStaff = await addMember(wsId, "admin");
      await grantProjectRole(secondStaff.user.id, second.id, [
        "project:read",
        "work_item:read",
        "work_item:create",
        "work_item:comment",
      ]);
      const ref = await submitAs(s, s.customer, "Detail probe");
      const accepted = await staffRequest(
        s.t,
        secondStaff,
        `/api/submissions/${ref}/accept`,
        {
          method: "POST",
          body: { projectId: second.id, workItemTypeId: s.t.type.id },
        },
      );
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      const item = (await accepted.json()) as {
        workItem: { id: string; key: string };
      };
      // A public comment on the converted item, written by someone who reaches it.
      const marker = "internal-escalation-note";
      await db.insert(schema.commentTable).values({
        workspaceId: wsId,
        workItemId: item.workItem.id,
        authorId: secondStaff.personId,
        actorType: "person",
        body: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: marker }] },
          ],
        },
        visibility: "public",
      });

      const path = `/api/submissions/${ref}`;
      const inReach = await staffRequest(s.t, secondStaff, path);
      const inText = await inReach.text();
      expect(inReach.status, inText).toBe(200);
      expect(inText).toContain(item.workItem.id);
      expect(inText).toContain(marker);

      const outside = await staffRequest(s.t, s.t.requester, path);
      const outText = await outside.text();
      expect(outside.status, outText).toBe(200);
      expect(outText).not.toContain(item.workItem.id);
      expect(outText).not.toContain(marker);
      expect(
        (JSON.parse(outText) as { submission: { workItemId: unknown } })
          .submission.workItemId,
      ).toBeNull();

      mockAnonymousSession();
      const key = await makeApiKey(s.t.requester.user.id, {
        intake: ["triage"],
        workspace: ["read"],
      });
      setAmbientHeaders({ "x-api-key": key });
      const viaKey = await json(s.t.app, "GET", path);
      const keyText = await viaKey.text();
      expect(keyText).not.toContain(item.workItem.id);
      expect(keyText).not.toContain(marker);
    });
  });

  describe("staff submission attachments: an accepted submission's work item attachments are shown only within reach", () => {
    async function arrange() {
      const s = await seedIntake("reach-attachments");
      const wsId = s.t.workspaceId;
      const { project: second } = await createProjectFixture({
        workspaceId: wsId,
        name: "Second destination",
      });
      await db
        .update(schema.projectTable)
        .set({ organisationId: s.customer.orgId })
        .where(eq(schema.projectTable.id, second.id));
      await makeState(wsId, second.id, "backlog", true);
      const secondStaff = await addMember(wsId, "admin");
      await grantProjectRole(secondStaff.user.id, second.id, [
        "project:read",
        "work_item:read",
        "work_item:create",
      ]);
      const ref = await submitAs(s, s.customer, "Attachment probe");
      const accepted = await staffRequest(
        s.t,
        secondStaff,
        `/api/submissions/${ref}/accept`,
        {
          method: "POST",
          body: { projectId: second.id, workItemTypeId: s.t.type.id },
        },
      );
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      const item = (await accepted.json()) as { workItem: { id: string } };
      const submissionRow = (await db.select().from(schema.submissionTable))[0];
      const make = async (
        filename: string,
        parent: { workItemId?: string; submissionId?: string },
        customerVisible: boolean,
      ) =>
        requireRow(
          await db
            .insert(schema.attachmentTable)
            .values({
              workspaceId: wsId,
              organisationId: s.customer.orgId,
              ...parent,
              objectKey: `workspace/${wsId}/${randomUUID()}/${filename}`,
              filename,
              mimeType: "application/pdf",
              size: 5,
              state: "ready",
              customerVisible,
              uploadedBy: s.customer.person.id,
            })
            .returning(),
          "attachment",
        );
      const internal = await make(
        "internal-escalation.pdf",
        { workItemId: item.workItem.id },
        false,
      );
      const visible = await make(
        "customer-visible.pdf",
        { workItemId: item.workItem.id },
        true,
      );
      const own = await make(
        "on-the-submission.pdf",
        { submissionId: submissionRow?.id },
        true,
      );
      return { s, secondStaff, ref, internal, visible, own };
    }

    const filenames = async (response: Response) =>
      ((await response.json()) as { filename: string }[])
        .map((x) => x.filename)
        .sort();
    const auditCount = async () =>
      (await db.select().from(schema.auditLogTable)).length;

    it("a triager who reaches the work item's project lists and downloads all of them, internal included", async () => {
      const a = await arrange();
      const list = await staffRequest(
        a.s.t,
        a.secondStaff,
        `/api/submissions/${a.ref}/attachments`,
      );
      expect(list.status, await list.clone().text()).toBe(200);
      expect(await filenames(list)).toEqual([
        "customer-visible.pdf",
        "internal-escalation.pdf",
        "on-the-submission.pdf",
      ]);
      for (const att of [a.internal, a.visible, a.own]) {
        const dl = await staffRequest(
          a.s.t,
          a.secondStaff,
          `/api/submissions/${a.ref}/attachments/${att.id}`,
        );
        expect(dl.status, await dl.clone().text()).toBe(302);
      }
    });

    it("a triager without reach sees only the submission's own attachment; the work item's are 404 and nothing is written", async () => {
      const a = await arrange();
      const before = await auditCount();
      const list = await staffRequest(
        a.s.t,
        a.s.t.requester,
        `/api/submissions/${a.ref}/attachments`,
      );
      const text = await list.clone().text();
      expect(list.status, text).toBe(200);
      expect(text).not.toContain("internal-escalation");
      expect(text).not.toContain("customer-visible");
      expect(await filenames(list)).toEqual(["on-the-submission.pdf"]);
      const missing = await staffRequest(
        a.s.t,
        a.s.t.requester,
        `/api/submissions/${a.ref}/attachments/missing-${randomUUID()}`,
      );
      const missingText = await missing.text();
      expect(missing.status, missingText).toBe(404);
      for (const att of [a.internal, a.visible]) {
        const dl = await staffRequest(
          a.s.t,
          a.s.t.requester,
          `/api/submissions/${a.ref}/attachments/${att.id}`,
        );
        const dlText = await dl.text();
        expect(dl.status, dlText).toBe(404);
        expect(dlText).toBe(missingText);
      }
      expect(await auditCount()).toBe(before);
      const own = await staffRequest(
        a.s.t,
        a.s.t.requester,
        `/api/submissions/${a.ref}/attachments/${a.own.id}`,
      );
      expect(own.status, await own.clone().text()).toBe(302);
    });

    it("API key: an outsider's key sees only the submission's own attachment; the reaching owner's key sees all", async () => {
      const a = await arrange();
      mockAnonymousSession();
      const scope = { intake: ["triage"], workspace: ["read"] };
      const outsiderKey = await makeApiKey(a.s.t.requester.user.id, scope);
      const memberKey = await makeApiKey(a.secondStaff.user.id, scope);
      const path = `/api/submissions/${a.ref}/attachments`;
      setAmbientHeaders({ "x-api-key": outsiderKey });
      const out = await json(a.s.t.app, "GET", path);
      expect(await filenames(out)).toEqual(["on-the-submission.pdf"]);
      const dl = await json(a.s.t.app, "GET", `${path}/${a.internal.id}`);
      expect(dl.status).toBe(404);
      setAmbientHeaders({ "x-api-key": memberKey });
      const inn = await json(a.s.t.app, "GET", path);
      expect(await filenames(inn)).toHaveLength(3);
      const ok = await json(a.s.t.app, "GET", `${path}/${a.internal.id}`);
      expect(ok.status).toBe(302);
    });

    it("the requester's own portal view is unchanged: customer-visible items only, internal never", async () => {
      const a = await arrange();
      const list = await portalRequest(
        a.s.t,
        a.s.customer,
        `/api/portal/submissions/${a.ref}/attachments`,
      );
      expect(list.status, await list.clone().text()).toBe(200);
      expect(await filenames(list)).toEqual([
        "customer-visible.pdf",
        "on-the-submission.pdf",
      ]);
    });
  });
});
