/**
 * Companion to `work-item-project-reach.test.ts`: for every item-addressed route in the
 * shared route table,
 *  - a caller who REACHES the item but lacks the registered capability gets 403 and nothing
 *    is written (watch/unwatch gate on `work_item:read`, so a reader may use them; approvals
 *    leave the capability decision to the handler);
 *  - API-key callers: a read-scoped key and an unscoped key owned by a fully capable project
 *    member are refused, and a fully scoped key owned by someone outside project reach gets
 *    the same 404 as a session caller.
 * `POST /api/work-items/search` is covered at the end (customer refusal, outsider sees nothing).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createItem,
  json,
  makeApiKey,
  ROUTES,
  setAmbientHeaders,
  setupWorld,
  snapshot,
  TITLE,
} from "./helpers/reach-world";

const FULL_SCOPE = {
  project: ["read", "update"],
  work_item: [
    "read",
    "update",
    "delete",
    "assign",
    "rank",
    "transition",
    "set_priority",
  ],
  comment: ["create", "create_internal", "update_own", "delete_own"],
  attachment: ["create", "delete_own"],
  approval: ["request"],
};

describe("API integration: project reach, capability and credential cases", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-reach-cred-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
    if (originalRoot === undefined) {
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    } else {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    }
    await rm(root, { recursive: true, force: true });
  });

  for (const route of ROUTES) {
    describe(route.matrixKey, () => {
      async function arrange() {
        const world = await setupWorld();
        const { app } = createApp();
        const target = await createItem(app, world, TITLE);
        const neighbour = await createItem(app, world, "Neighbour");
        const parent = await createItem(app, world, "Parent");
        const item = {
          key: target.key,
          neighbourId: neighbour.id,
          parentKey: parent.key,
        };
        await route.prepare?.(world, item, app);
        return { world, app, item };
      }

      if (route.capability !== "handler") {
        it("a caller who reaches the item without the capability gets 403 and changes nothing", async () => {
          const { world, app, item } = await arrange();
          const before = await snapshot();
          mockAuthenticatedSession(world.readerLead.user);
          const response = await route.call(app, world, item);
          const text = await response.text();
          expect(response.status, text).toBe(route.readOnlyStatus ?? 403);
          if ((route.readOnlyStatus ?? 403) === 403) {
            expect(await snapshot()).toBe(before);
          }
        });
      }

      if (route.capability !== "handler") {
        it("a read-scoped or unscoped API key owned by a capable project member is refused", async () => {
          const { world, app, item } = await arrange();
          const before = await snapshot();
          mockAnonymousSession();
          const readKey = await makeApiKey(world.projectMember.user.id, {
            project: ["read"],
            work_item: ["read"],
          });
          const nullKey = await makeApiKey(world.projectMember.user.id, null);

          setAmbientHeaders({ "x-api-key": readKey });
          const withRead = await route.call(app, world, item);
          const readText = await withRead.text();
          expect(withRead.status, readText).toBe(route.readKeyStatus ?? 403);

          setAmbientHeaders({ "x-api-key": nullKey });
          const withNull = await route.call(app, world, item);
          setAmbientHeaders({});
          const nullText = await withNull.text();
          expect(withNull.status, nullText).toBe(403);
          if ((route.readKeyStatus ?? 403) === 403) {
            expect(await snapshot()).toBe(before);
          }
        });
      }

      it("a fully scoped API key owned by someone outside project reach gets 404 and changes nothing", async () => {
        const { world, app, item } = await arrange();
        const before = await snapshot();
        mockAnonymousSession();
        const key = await makeApiKey(world.outsiderLead.user.id, FULL_SCOPE);
        setAmbientHeaders({ "x-api-key": key });
        const response = await route.call(app, world, item);
        setAmbientHeaders({});
        const text = await response.text();
        expect(response.status, text).toBe(404);
        expect(text).not.toContain(TITLE);
        expect(await snapshot()).toBe(before);
      });
    });
  }

  describe("POST /api/work-items/bulk", () => {
    it("refuses a read-scoped API key owned by a capable project member and writes nothing", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const item = await createItem(app, world, TITLE);
      const before = await snapshot();
      mockAnonymousSession();
      for (const permissions of [
        { project: ["read"], work_item: ["read"] },
        null,
      ]) {
        setAmbientHeaders({
          "x-api-key": await makeApiKey(
            world.projectMember.user.id,
            permissions,
          ),
        });
        for (const body of [
          { operation: "delete" },
          { operation: "assign", assigneeId: world.projectMember.personId },
        ]) {
          const response = await json(app, "POST", "/api/work-items/bulk", {
            workspaceId: world.workspaceId,
            workItemKeys: [item.key],
            ...body,
          });
          expect(response.status, await response.text()).toBe(403);
        }
      }
      expect(await snapshot()).toBe(before);
    });
  });

  describe("POST /api/work-items/search", () => {
    it("refuses a customer principal and shows an outsider nothing", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      await createItem(app, world, TITLE);
      const body = {
        workspaceId: world.workspaceId,
        query: { entity: "work_item" },
      };

      mockAuthenticatedSession(world.projectMember.user);
      const member = await json(app, "POST", "/api/work-items/search", body);
      expect(member.status, await member.clone().text()).toBe(200);
      expect(await member.text()).toContain(TITLE);

      mockAuthenticatedSession(world.customerWithRole.user);
      const customer = await json(app, "POST", "/api/work-items/search", body);
      const customerText = await customer.text();
      expect(customer.status, customerText).toBe(403);
      expect(customerText).not.toContain(TITLE);

      mockAuthenticatedSession(world.outsiderLead.user);
      const outsider = await json(app, "POST", "/api/work-items/search", body);
      const outsiderText = await outsider.text();
      expect(outsider.status, outsiderText).toBe(200);
      expect(outsiderText).not.toContain(TITLE);
    });
  });
});
