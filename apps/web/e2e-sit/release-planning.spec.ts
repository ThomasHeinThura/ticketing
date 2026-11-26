import { expect, test } from "@playwright/test";
import { redactSecretErrorContext } from "../e2e/helpers/redact-secret-error-context";
import {
  discoverTarget,
  featureOn,
  removeResource,
  removeWorkItem,
  type Session,
  setProjectFeature,
  signIn,
  stamp,
  taskTypeId,
} from "./release-helpers";

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Release journey: planning. An admin creates a cycle, adds a work item the journey created,
 * and completes the cycle. Cycles are enabled for the project for the run when they are off,
 * and the previous override is put back at the end. The cycle and the item are deleted again.
 */
test("a cycle is created, filled with an item and completed", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await signIn(browser, "admin");
  const sessions: Session[] = [admin];
  let itemKey: string | null = null;
  let cycleId: string | null = null;
  let restore: { projectId: string; override: boolean | null } | null = null;
  try {
    const { projectId, projectKey } = await discoverTarget(admin);
    if (!(await featureOn(admin, projectId, "feature.cycles")))
      restore = {
        projectId,
        override: await setProjectFeature(
          admin,
          projectId,
          "feature.cycles",
          true,
        ),
      };

    const made = await admin.call("POST", `/projects/${projectId}/work-items`, {
      typeId: await taskTypeId(admin, projectId),
      title: `R929 planning ${stamp()}`,
      priority: "low",
    });
    expect(made.status).toBe(200);
    itemKey = made.body.key as string;

    // A far-future window that differs per run cannot overlap a real cycle (409); one 409 moves it once.
    const createCycle = (shiftDays: number) => {
      const start =
        1825 + shiftDays + (Math.floor(Date.now() / 60_000) % 1000) * 9;
      return admin.call("POST", `/projects/${projectKey}/cycles`, {
        name: `R929 cycle ${stamp()}`,
        startDate: isoDay(start),
        endDate: isoDay(start + 7),
      });
    };
    let created = await createCycle(0);
    if (created.status === 409) created = await createCycle(4000);
    expect([200, 201]).toContain(created.status);
    cycleId = created.body.id as string;

    const added = await admin.call("POST", `/cycles/${cycleId}/work-items`, {
      workItemKeys: [itemKey],
    });
    expect(added.status).toBe(200);
    const detail = await admin.call("GET", `/cycles/${cycleId}`);
    expect(detail.status).toBe(200);
    // Cycle detail carries a summary, not keys; this fresh cycle holds only the item added above.
    expect(detail.body.summary.total.count).toBe(1);

    const completed = await admin.call(
      "POST",
      `/cycles/${cycleId}/complete`,
      {},
    );
    expect(completed.status).toBe(200);
  } finally {
    await cleanup();
  }

  // Each step runs even when an earlier one fails; the first failure is reported.
  async function cleanup() {
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    };
    const cycle = cycleId;
    const item = itemKey;
    const undo = restore;
    if (cycle) await attempt(() => removeResource(admin, `/cycles/${cycle}`));
    if (item) await attempt(() => removeWorkItem(admin, item));
    if (undo)
      await attempt(() =>
        setProjectFeature(
          admin,
          undo.projectId,
          "feature.cycles",
          undo.override,
        ),
      );
    await Promise.all(sessions.map((session) => session.context.close()));
    if (failures.length > 0) throw failures[0];
  }
});
