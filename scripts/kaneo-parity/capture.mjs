// Kaneo parity capture (docs/02-design/design-principles.md: kaneo is the specification).
//
// Seeds a deterministic workspace/project/tasks through the public HTTP API of the app
// at BASE_URL, signs in, and screenshots every screen that exists in upstream kaneo at
// three viewports in light and dark. The same script runs against upstream kaneo
// (FLAVOR=upstream) and against TaskDesk (FLAVOR=ours) so the PNG sets are comparable.
//
// Usage: BASE_URL=http://localhost:5173 FLAVOR=upstream OUT=out/upstream node capture.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Playwright is a dependency of apps/web, not of the repository root.
const { chromium } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)("@playwright/test");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.API_URL ?? BASE_URL;
const FLAVOR = process.env.FLAVOR ?? "upstream";
const OUT = process.env.OUT ?? `out/${FLAVOR}`;
const EMAIL = process.env.PARITY_EMAIL ?? "parity@example.com";
const PASSWORD = process.env.PARITY_PASSWORD ?? "Parity-Password-2026!";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];
const SCHEMES = ["light", "dark"];

const log = (...a) => console.log(`[parity:${FLAVOR}]`, ...a);

async function api(ctx, method, path, body) {
  const res = await ctx.fetch(`${API_URL}/api${path}`, {
    method,
    headers: { "content-type": "application/json", origin: BASE_URL },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  log(method, path, res.status());
  if (!res.ok()) log("  body:", text.slice(0, 400));
  return { ok: res.ok(), status: res.status(), json, text };
}

async function seedOurs(ctx) {
  const r = await api(ctx, "POST", "/auth/sign-in/email", {
    email: process.env.OURS_EMAIL ?? "admin@taskdesk.local",
    password: process.env.OURS_PASSWORD ?? "TaskDesk!Admin2026",
  });
  if (!r.ok) throw new Error("cannot sign in to TaskDesk");
  // Deterministic ids written by apps/api/scripts/seed-sit-users.ts.
  return {
    workspaceId: "ws-taskdesk-sit",
    projectId: "proj-help-sit",
    taskId: "sit-wi-help-1",
    projectKey: "HELP",
    workItemKey: "HELP-1",
  };
}

async function seed(ctx) {
  let r = await api(ctx, "POST", "/auth/sign-up/email", {
    name: "Parity User",
    email: EMAIL,
    password: PASSWORD,
  });
  if (!r.ok) {
    r = await api(ctx, "POST", "/auth/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    if (!r.ok) throw new Error("cannot sign up or sign in");
  }
  const org = await api(ctx, "POST", "/auth/organization/create", {
    name: "Parity Workspace",
    slug: "parity-workspace",
  });
  const workspaceId = org.json?.id ?? org.json?.data?.id;
  if (!workspaceId) throw new Error("workspace create failed");
  await api(ctx, "POST", "/auth/organization/set-active", {
    organizationId: workspaceId,
  });
  const project = await api(ctx, "POST", "/project", {
    workspaceId,
    name: "Parity Project",
    icon: "Layout",
    slug: "PAR",
  });
  const projectId = project.json?.id;
  if (!projectId) throw new Error("project create failed");
  const titles = [
    ["Design the landing page", "to-do", "high"],
    ["Write onboarding copy", "to-do", "medium"],
    ["Set up CI pipeline", "in-progress", "urgent"],
    ["Review pull requests", "in-review", "low"],
    ["Ship v1", "done", "medium"],
  ];
  const taskIds = [];
  for (const [i, [title, status, priority]] of titles.entries()) {
    const day = String(10 + i).padStart(2, "0");
    const t = await api(ctx, "POST", `/task/${projectId}`, {
      title,
      description: `${title} — deterministic parity seed.`,
      status,
      priority,
      startDate: `2026-10-${day}T00:00:00.000Z`,
      dueDate: `2026-10-${String(Number(day) + 5)}T00:00:00.000Z`,
    });
    if (t.json?.id) taskIds.push(t.json.id);
  }
  return { workspaceId, projectId, taskId: taskIds[0] };
}

function oursOnly({ projectKey, workItemKey }) {
  return [
    ["td-agent-home", "/agent"],
    ["td-inbox", "/agent/inbox"],
    ["td-my-work", "/agent/my-work"],
    ["td-triage", "/agent/triage"],
    ["td-saved-views", "/agent/views"],
    ["td-project-work", `/agent/projects/${projectKey}/work`],
    ["td-project-backlog", `/agent/projects/${projectKey}/backlog`],
    ["td-work-item", `/agent/work-items/${workItemKey}`],
    ["td-settings-sla", "/agent/settings/sla-policies"],
    ["td-settings-calendars", "/agent/settings/calendars"],
    ["td-settings-request-types", "/agent/settings/request-types"],
    ["td-god-mode-audit", "/agent/god-mode/audit"],
    ["td-god-mode-users", "/agent/god-mode/users"],
  ];
}

function screens({ workspaceId, projectId, taskId, ...rest }) {
  const ws = `/dashboard/workspace/${workspaceId}`;
  const pr = `${ws}/project/${projectId}`;
  const extra = FLAVOR === "ours" ? oursOnly(rest) : [];
  return [
    ...extra,
    ["workspace-home", ws],
    ["project-board", `${pr}/board`],
    ["project-backlog", `${pr}/backlog`],
    ["project-calendar", `${pr}/calendar`],
    ["project-gantt", `${pr}/gantt`],
    ["task-page", `${pr}/task/${taskId}`],
    ["workspace-search", `${ws}/search`],
    ["workspace-members", `${ws}/members`],
    ["invitations", "/dashboard/invitations"],
    ["settings-account-information", "/dashboard/settings/account/information"],
    ["settings-account-notifications", "/dashboard/settings/account/notifications"],
    ["settings-account-developer", "/dashboard/settings/account/developer"],
    ["settings-account-preferences", "/dashboard/settings/account/preferences"],
    ["settings-account-security", "/dashboard/settings/account/security"],
    ["settings-workspace-general", "/dashboard/settings/workspace/general"],
    ["settings-workspace-labels", "/dashboard/settings/workspace/labels"],
    ["settings-workspace-roles", "/dashboard/settings/workspace/roles"],
    ["settings-project-general", `/dashboard/settings/projects/${projectId}/general`],
    ["settings-project-workflow", `/dashboard/settings/projects/${projectId}/workflow`],
    ["settings-project-labels", `/dashboard/settings/projects/${projectId}/labels`],
  ];
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const apiCtx = (await browser.newContext()).request;
  const seeded = FLAVOR === "ours" ? await seedOurs(apiCtx) : await seed(apiCtx);
  const state = await apiCtx.storageState();
  await writeFile(`${OUT}/seed.json`, JSON.stringify(seeded, null, 2));

  const failures = [];
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const context = await browser.newContext({
        storageState: state,
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
        reducedMotion: "reduce",
        locale: "en-GB",
        timezoneId: "UTC",
      });
      // Both apps keep the theme in the zustand store, not in prefers-color-scheme.
      await context.addInitScript((theme) => {
        localStorage.setItem(
          "user-preferences",
          JSON.stringify({ state: { theme }, version: 0 }),
        );
      }, scheme);
      const page = await context.newPage();
      for (const [name, path] of screens(seeded)) {
        try {
          await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
          await page.waitForTimeout(600);
          await page.screenshot({
            path: `${OUT}/${name}.${vp.name}.${scheme}.png`,
            fullPage: false,
          });
          log("ok", name, vp.name, scheme, page.url());
        } catch (e) {
          failures.push(`${name}.${vp.name}.${scheme}: ${e.message}`);
          log("FAIL", name, vp.name, scheme, e.message);
        }
      }
      await context.close();
    }
  }
  await writeFile(`${OUT}/failures.json`, JSON.stringify(failures, null, 2));
  await browser.close();
  if (failures.length > 0) log(`${failures.length} capture failures (see failures.json)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
