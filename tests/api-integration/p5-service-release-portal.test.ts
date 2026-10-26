/** REL-5: portal release notes are scoped to linked customer projects and frozen snapshots. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  releaseTable,
  serviceLinkTable,
  serviceTable,
} from "../../apps/api/src/database/schema-p5-service";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { type KbWorld, kbWorld, PORTAL_HOST, setKbFlag } from "./helpers/p5-kb";
import { setServiceFlag } from "./helpers/p5-service";

let world: KbWorld;

beforeEach(async () => {
  await resetTestDatabase();
  world = await kbWorld();
  await setKbFlag(world.workspaceId, true);
  await setServiceFlag(world.workspaceId, true);
});

async function serviceLinkedToProject(projectId: string, suffix: string) {
  const serviceId = `release-portal-service-${suffix}`;
  await db.insert(serviceTable).values({
    id: serviceId,
    workspaceId: world.workspaceId,
    name: `Customer service ${suffix}`,
  });
  await db.insert(serviceLinkTable).values({
    workspaceId: world.workspaceId,
    serviceId,
    kind: "project",
    projectId,
  });
  return serviceId;
}

async function insertRelease(input: {
  id: string;
  serviceId: string;
  name?: string;
  publishedAt?: Date;
  publishToPortal?: boolean;
  status?: "planned" | "in_progress" | "released" | "cancelled";
  portalSnapshot?: {
    version: 1;
    name: string;
    serviceName: string;
    plannedDate: string | null;
    notes: string | null;
    publishedAt: string;
  } | null;
}) {
  const publishedAt = input.publishedAt ?? new Date("2030-01-01T12:00:00.000Z");
  await db.insert(releaseTable).values({
    id: input.id,
    workspaceId: world.workspaceId,
    name: input.name ?? input.id,
    serviceId: input.serviceId,
    status: input.status ?? "released",
    publishToPortal: input.publishToPortal ?? true,
    publishedAt,
    portalSnapshot:
      input.portalSnapshot === undefined
        ? {
            version: 1,
            name: input.name ?? input.id,
            serviceName: `Customer service ${input.id.split("-").at(-1)}`,
            plannedDate: null,
            notes: `Published notes for ${input.id}`,
            publishedAt: publishedAt.toISOString(),
          }
        : input.portalSnapshot,
  });
}

function portal(user: KbWorld["customerA"]["user"], path: string) {
  mockAuthenticatedSession(user, { portal: "customer" });
  return world.app.request(`http://${PORTAL_HOST}${path}`, {
    headers: { host: PORTAL_HOST },
  });
}

describe("customer release notes portal reach", () => {
  it("lists only published snapshots for the organisation's linked projects", async () => {
    const serviceId = await serviceLinkedToProject(
      world.projectA.id,
      "visible",
    );
    await insertRelease({ id: "release-visible", serviceId });
    await insertRelease({
      id: "release-draft",
      serviceId,
      status: "planned",
      publishToPortal: false,
      portalSnapshot: null,
    });
    await insertRelease({
      id: "release-no-legacy-snapshot",
      serviceId,
      status: "released",
      publishToPortal: true,
      portalSnapshot: null,
    });
    const otherService = await serviceLinkedToProject(
      world.projectB.id,
      "other-org",
    );
    await insertRelease({ id: "release-other-org", serviceId: otherService });

    const visible = await portal(world.customerA.user, "/api/portal/releases");
    expect(visible.status, await visible.clone().text()).toBe(200);
    const body = (await visible.json()) as {
      data: { id: string; notes: string | null }[];
      nextCursor: string | null;
    };
    expect(body.data.map((entry) => entry.id)).toEqual(["release-visible"]);
    expect(body.data[0]?.notes).toBe("Published notes for release-visible");

    const foreign = await portal(world.customerB.user, "/api/portal/releases");
    expect(foreign.status).toBe(200);
    expect((await foreign.json()).data).toEqual([]);
    expect(
      (
        await portal(
          world.customerB.user,
          "/api/portal/releases/release-visible",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await portal(
          world.customerA.user,
          "/api/portal/releases/release-no-legacy-snapshot",
        )
      ).status,
    ).toBe(404);
  });

  it("uses bounded stable cursors and refuses a cursor from another organisation", async () => {
    const serviceId = await serviceLinkedToProject(
      world.projectA.id,
      "pagination",
    );
    await insertRelease({
      id: "release-page-a",
      serviceId,
      publishedAt: new Date("2030-01-03T12:00:00.000Z"),
    });
    await insertRelease({
      id: "release-page-b",
      serviceId,
      publishedAt: new Date("2030-01-02T12:00:00.000Z"),
    });
    await insertRelease({
      id: "release-page-c",
      serviceId,
      publishedAt: new Date("2030-01-01T12:00:00.000Z"),
    });
    const first = await portal(
      world.customerA.user,
      "/api/portal/releases?limit=2",
    );
    const page = (await first.json()) as {
      data: { id: string }[];
      nextCursor: string | null;
    };
    expect(page.data.map((entry) => entry.id)).toEqual([
      "release-page-a",
      "release-page-b",
    ]);
    expect(page.nextCursor).toBeTruthy();
    const next = await portal(
      world.customerA.user,
      `/api/portal/releases?limit=2&cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
    );
    expect((await next.json()).data).toMatchObject([{ id: "release-page-c" }]);
    const foreignCursor = await portal(
      world.customerB.user,
      `/api/portal/releases?cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
    );
    expect(foreignCursor.status).toBe(200);
    expect(await foreignCursor.json()).toMatchObject({
      data: [],
      nextCursor: null,
    });
  });

  it("hides published notes when the workspace feature is off or the linked project is archived", async () => {
    const serviceId = await serviceLinkedToProject(
      world.projectA.id,
      "lifecycle",
    );
    await insertRelease({ id: "release-lifecycle", serviceId });
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, world.projectA.id));
    const archivedList = await portal(
      world.customerA.user,
      "/api/portal/releases",
    );
    expect(await archivedList.json()).toMatchObject({ data: [] });
    expect(
      (
        await portal(
          world.customerA.user,
          "/api/portal/releases/release-lifecycle",
        )
      ).status,
    ).toBe(404);

    await db
      .update(schema.projectTable)
      .set({ archivedAt: null })
      .where(eq(schema.projectTable.id, world.projectA.id));
    await setServiceFlag(world.workspaceId, false);
    const disabled = await portal(world.customerA.user, "/api/portal/releases");
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).data).toEqual([]);
    expect(
      (
        await portal(
          world.customerA.user,
          "/api/portal/releases/release-lifecycle",
        )
      ).status,
    ).toBe(404);
  });
});
