import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import {
  cycleTable,
  moduleTable,
} from "../../../apps/api/src/database/schema-p5-agile";
import {
  kbArticleTable,
  kbArticleVersionTable,
} from "../../../apps/api/src/database/schema-p5-kb";
import {
  projectPageTable,
  projectPageVersionTable,
} from "../../../apps/api/src/database/schema-p5-pages";
import { dashboardTable } from "../../../apps/api/src/database/schema-p5-reports";
import {
  changeDetailTable,
  changeServiceTable,
  releaseTable,
  serviceDependencyTable,
  serviceLinkTable,
  serviceTable,
} from "../../../apps/api/src/database/schema-p5-service";
import {
  timeActivityTable,
  timeEntryTable,
} from "../../../apps/api/src/database/schema-p5-time";
import { createProjectFixture, requireRow } from "./fixtures";
import { workItemWorld } from "./p4-closeout";

/**
 * A workspace with every P5 table that carries a RESTRICT / NO ACTION link populated: services
 * (with links and a dependency), a release, a change with its affected services, a module led
 * by `leadPersonId`, a cycle, a KB article, time entries, pages (parent and child) and dashboards.
 */
export async function populateP5(
  workspaceId: string,
  leadPersonId: string,
  authorPersonId: string = leadPersonId,
) {
  const { project } = await createProjectFixture({ workspaceId });
  const world = await workItemWorld(workspaceId, project.id);
  const [svcA, svcB] = await db
    .insert(serviceTable)
    .values([
      { workspaceId, name: `Checkout ${randomUUID().slice(0, 6)}` },
      { workspaceId, name: `Payments ${randomUUID().slice(0, 6)}` },
    ])
    .returning();
  if (!svcA || !svcB) throw new Error("services");
  await db.insert(serviceLinkTable).values({
    workspaceId,
    serviceId: svcA.id,
    kind: "project",
    projectId: project.id,
  });
  await db.insert(serviceDependencyTable).values({
    workspaceId,
    serviceId: svcA.id,
    dependsOnServiceId: svcB.id,
  });
  const release = requireRow(
    await db
      .insert(releaseTable)
      .values({ workspaceId, name: "R1", serviceId: svcA.id })
      .returning(),
    "release",
  );
  const change = await world.makeItem("A change");
  await db.insert(changeDetailTable).values({
    workItemId: change.id,
    workspaceId,
    releaseId: release.id,
  });
  await db.insert(changeServiceTable).values({
    workspaceId,
    workItemId: change.id,
    serviceId: svcB.id,
  });
  await db
    .update(schema.workItemTable)
    .set({ serviceId: svcA.id })
    .where(eq(schema.workItemTable.id, change.id));
  const mod = requireRow(
    await db
      .insert(moduleTable)
      .values({
        workspaceId,
        projectId: project.id,
        name: "Module",
        leadId: leadPersonId,
      })
      .returning(),
    "module",
  );
  const cycle = requireRow(
    await db
      .insert(cycleTable)
      .values({
        workspaceId,
        projectId: project.id,
        name: "Cycle 1",
        startDate: "2031-01-01",
        endDate: "2031-01-14",
      })
      .returning(),
    "cycle",
  );
  const planned = await world.makeItem("Planned work");
  await db
    .update(schema.workItemTable)
    .set({ moduleId: mod.id, cycleId: cycle.id })
    .where(eq(schema.workItemTable.id, planned.id));
  const article = requireRow(
    await db
      .insert(kbArticleTable)
      .values({
        workspaceId,
        projectId: project.id,
        title: "How to",
        body: { type: "doc", content: [] },
        authorId: authorPersonId,
        ownerId: leadPersonId,
      })
      .returning(),
    "article",
  );
  await db.insert(kbArticleVersionTable).values({
    articleId: article.id,
    number: 1,
    title: article.title,
    body: article.body,
    createdBy: authorPersonId,
  });
  const activity = requireRow(
    await db
      .insert(timeActivityTable)
      .values({ workspaceId, name: "Development" })
      .returning(),
    "activity",
  );
  await db.insert(timeEntryTable).values({
    workspaceId,
    projectId: project.id,
    workItemId: planned.id,
    personId: authorPersonId,
    date: "2031-01-02",
    minutes: 60,
    activityId: activity.id,
    billable: false,
  });
  const parent = requireRow(
    await db
      .insert(projectPageTable)
      .values({
        workspaceId,
        projectId: project.id,
        title: "Runbook",
        body: { type: "doc", content: [] },
        createdBy: authorPersonId,
        updatedBy: authorPersonId,
      })
      .returning(),
    "page",
  );
  const child = requireRow(
    await db
      .insert(projectPageTable)
      .values({
        workspaceId,
        projectId: project.id,
        parentId: parent.id,
        title: "Sub runbook",
        body: { type: "doc", content: [] },
        createdBy: authorPersonId,
      })
      .returning(),
    "child page",
  );
  for (const page of [parent, child])
    await db.insert(projectPageVersionTable).values({
      pageId: page.id,
      number: 1,
      title: page.title,
      body: page.body,
      createdBy: authorPersonId,
    });
  await db.insert(dashboardTable).values([
    { workspaceId, name: "Team", scope: "workspace" },
    { workspaceId, name: "Mine", scope: "personal", ownerId: leadPersonId },
  ]);
  return { project, svcA, svcB, release, change, mod, cycle, parent, child };
}
