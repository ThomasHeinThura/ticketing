import { expect, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

test("board detail sections follow the current row and approved deletion", async ({
  page,
}) => {
  await installPerformanceApiFixture(page, {
    boardProject: true,
    workflowCapabilities: true,
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const get = async (path: string) => {
      const response = await fetch(path);
      return { status: response.status, body: await response.json() };
    };
    const sections = [
      "labels",
      "children",
      "relations",
      "attachments",
      "activity",
      "comments/mention-candidates",
      "approvals",
      "approval-request-context",
    ];
    const before = await get("/api/work-items/BRD-1/children");
    const reads = await Promise.all(
      sections.map((section) => get(`/api/work-items/BRD-1/${section}`)),
    );
    const unknown = await get("/api/work-items/BRD-201/children");
    const unknownSection = await get("/api/work-items/BRD-1/unknown-section");
    const csrf = (await get("/api/me/csrf-token")).body.token;
    const mutation = async (path: string, method: string, body?: object) => {
      const response = await fetch(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-taskdesk-csrf": csrf,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const transition = await mutation(
      "/api/work-items/BRD-1/transition",
      "POST",
      { toStateTemplateId: "template-state-brd-progress" },
    );
    const after = await get("/api/work-items/BRD-1/children");
    const deletion = await mutation("/api/work-items/BRD-1", "DELETE");
    const beforeApproval = await get("/api/work-items/BRD-1/children");
    const approval = await mutation(deletion.body.approveUrl, "POST", {});
    const deleted = await get("/api/work-items/BRD-1/children");
    const deletedLabels = await get("/api/work-items/BRD-1/labels");
    return {
      before,
      reads,
      unknown,
      unknownSection,
      transition,
      after,
      deletion,
      beforeApproval,
      approval,
      deleted,
      deletedLabels,
    };
  });
  expect(result.reads.map((x) => x.status)).toEqual(Array(8).fill(200));
  expect(result.reads[0].body).toEqual([]);
  expect(result.before.body.parent).toMatchObject({
    key: "BRD-1",
    projectId: "project-g11-board",
    stateId: "state-brd-backlog",
  });
  expect(result.unknown.status).toBe(404);
  expect(result.unknownSection.status).toBe(404);
  expect(result.transition.status).toBe(200);
  expect(result.after.body.parent).toMatchObject({
    key: "BRD-1",
    projectId: "project-g11-board",
    stateId: "state-brd-progress",
    version: result.transition.body.version,
  });
  expect(result.deletion.status).toBe(202);
  expect(result.beforeApproval.status).toBe(200);
  expect(result.approval.status).toBe(200);
  expect(result.deleted.status).toBe(404);
  expect(result.deletedLabels.status).toBe(404);
});

test("board detail sections remain unavailable without the board fixture", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const statuses = await page.evaluate(async () =>
    Promise.all(
      [
        "/api/work-items/BRD-1",
        "/api/work-items/BRD-1/children",
        "/api/work-items/BRD-1/labels",
      ].map(async (path) => (await fetch(path)).status),
    ),
  );
  expect(statuses).toEqual([404, 404, 404]);
});
