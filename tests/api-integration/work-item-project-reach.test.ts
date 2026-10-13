/**
 * Project reach on every item-scoped work-item route.
 *
 * Every route below is declared `reach: "required"` on the `work_item` scope
 * (`apps/api/src/work-item/policy.ts`) and the permission matrix
 * (`tests/permissions/matrix.fixture.json`) declares `404 not_found` for a caller outside
 * reach and the role's own answer inside it. These tests drive the REAL middleware chain and
 * assert the declared answers, taking the expected status for the outside-reach and customer
 * cases from the matrix fixture itself, so the fixture and the runtime cannot drift apart
 * silently (#708 tracks the general gap; this closes it for the item-scoped routes).
 *
 * For each route:
 *  - a same-workspace caller with a strong workspace role but NO project membership gets 404,
 *    nothing is written, and the response never carries the item;
 *  - a customer-role member gets the matrix's customer answer (404 without a project role,
 *    the declared inReach answer with one);
 *  - a project member holding the capability succeeds.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createItem,
  type Fixture,
  json,
  MATRIX,
  matrixStatus,
  ROUTES,
  setupWorld,
  snapshot,
  TITLE,
} from "./helpers/reach-world";

describe("API integration: project reach on item-scoped work-item routes", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-reach-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
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
        const item: Fixture = {
          key: target.key,
          neighbourId: neighbour.id,
          parentKey: parent.key,
        };
        await route.prepare?.(world, item, app);
        return { world, app, item };
      }

      it("a same-workspace caller with no project membership gets 404, writes nothing and sees no row", async () => {
        const { world, app, item } = await arrange();
        const declared = matrixStatus(
          MATRIX.routes[route.matrixKey]?.member?.outOfReach,
        );
        expect(declared).toBe(404);
        const before = await snapshot();

        for (const outsider of [
          world.outsiderLead,
          world.outsiderMember,
          world.outsiderAdmin,
        ]) {
          mockAuthenticatedSession(outsider.user);
          const response = await route.call(app, world, item);
          const text = await response.text();
          expect(response.status, text).toBe(declared);
          expect(text).not.toContain(TITLE);
          expect(await snapshot()).toBe(before);
        }
      });

      it("a customer-role member gets the matrix's customer answer, and nothing is written", async () => {
        const { world, app, item } = await arrange();
        const before = await snapshot();

        mockAuthenticatedSession(world.customerNoRole.user);
        const out = await route.call(app, world, item);
        const outText = await out.text();
        expect(out.status, outText).toBe(
          matrixStatus(MATRIX.routes[route.matrixKey]?.customer?.outOfReach),
        );
        expect(outText).not.toContain(TITLE);

        mockAuthenticatedSession(world.customerWithRole.user);
        const inside = await route.call(app, world, item);
        const insideText = await inside.text();
        expect(inside.status, insideText).toBe(
          matrixStatus(MATRIX.routes[route.matrixKey]?.customer?.inReach),
        );
        expect(await snapshot()).toBe(before);
      });

      it("a project member holding the capability succeeds", async () => {
        const { world, app, item } = await arrange();
        mockAuthenticatedSession(world.projectMember.user);
        const response = await route.call(app, world, item);
        expect(response.status, await response.clone().text()).toBe(
          route.successStatus ?? 200,
        );
      });
    });
  }

  describe("POST /api/work-items/bulk", () => {
    it("reports an item outside the caller's project reach exactly like a missing key, and changes nothing", async () => {
      const world = await setupWorld();
      const { app } = createApp();
      const hidden = await createItem(app, world, TITLE);
      const before = await snapshot();

      mockAuthenticatedSession(world.outsiderLead.user);
      const response = await json(app, "POST", "/api/work-items/bulk", {
        workspaceId: world.workspaceId,
        workItemKeys: [hidden.key, "NOPE-9999"],
        operation: "assign",
        assigneeId: world.projectMember.personId,
      });
      const body = (await response.json()) as {
        succeeded: string[];
        failed: { id: string; reason: string }[];
      };
      expect(response.status).toBe(200);
      expect(body.succeeded).toEqual([]);
      expect(body.failed.map((f) => f.reason)).toEqual([
        "Work item not found",
        "Work item not found",
      ]);
      expect(await snapshot()).toBe(before);
    });
  });
});
