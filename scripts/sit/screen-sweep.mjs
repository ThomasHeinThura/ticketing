/**
 * Screen sweep: signs in as each role on local SIT and visits every route in
 * docs/screens.md per width and theme. Read-only by intent, but a page visit can
 * still write (default dashboard creation, KB view counts), so run it on SIT only.
 * Usage: docs/testing.md ("Screen sweep").
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Parse route rows, preserving the inventory's agent-to-portal boundary. */
export function parseRoutes(markdown) {
  const routes = [];
  let headers = [];
  let portal = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.includes("Screen") && cells.includes("Kind")) {
      headers = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    const row = Object.fromEntries(
      headers.map((header, index) => [header, cells[index]]),
    );
    if (row.kind !== "route") continue;
    const path = row.route?.match(/`([^`]+)`/)?.[1];
    if (!path) continue;
    if (path === "/sign-in") portal = true;
    const host = row.host?.toLowerCase() || (portal ? "portal" : "agent");
    routes.push({ route: path, host, roles: row.role || row.roles || null });
  }
  return routes;
}

/** Values are route-specific: an {id} on a team route is not an article ID. */
export function resolveRoute(route, values) {
  let missing = false;
  const result = route.replace(
    /\{([A-Za-z][\w]*)\}|\$([A-Za-z][\w]*)/g,
    (_, braces, dollar) => {
      const value = values[braces || dollar];
      if (typeof value !== "string" || !value) {
        missing = true;
        return "";
      }
      return encodeURIComponent(value);
    },
  );
  return missing ? null : result;
}

const SECRET_PARAM = /(^|[_-])(token|code|secret|key|signature)$/i;

/** Drops credentials and fragments; masks secret-named query parameters. */
export function redactUrl(input) {
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(name)) url.searchParams.set(name, "REDACTED");
    }
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

/** Redacts every URL inside free text such as console messages. */
export function redactText(text, max = 300) {
  return String(text)
    .replace(/https?:\/\/[^\s"')<>]+/g, (url) => redactUrl(url))
    .slice(0, max);
}

/** Filesystem-safe name for a route template. */
export function slugify(route) {
  const slug = route
    .replace(/[{}$]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 100);
  return slug || "root";
}

export function parseCsv(value, fallback) {
  if (value === undefined) return fallback;
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) throw new Error("Empty list option");
  return list;
}

/** First array in a JSON body: the body itself or its first array property. */
export function rowsOf(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    for (const value of Object.values(json)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

/** Which discovered value fills `{id}`, by route. Order matters. */
const ID_RULES = [
  [/^\/agent\/service-management\/services\//, "service"],
  [/^\/agent\/kb\//, "article"],
  [/^\/agent\/reports\/exports\//, "reportExport"],
  [/^\/agent\/views\//, "view"],
  [/pending-actions\//, "pendingAction"],
  [/workspace\/teams\//, "team"],
  [/workspace\/roles\//, "role"],
  [/workspace\/workflows\//, "workflow"],
  [/workspace\/sla-policies\//, "slaPolicy"],
  [/workspace\/calendars\//, "calendar"],
  [/workspace\/custom-fields\//, "customField"],
  [/workspace\/webhooks\//, "webhook"],
  [/workspace\/request-types/, "requestType"],
  [/^\/god-mode\/authentication\//, "identity"],
  [/^\/god-mode\/organisations\//, "organisation"],
  [/^\/god-mode\/imports\//, "importRun"],
  [/^\/announcements\//, "announcement"],
  [/^\/approvals/, "approval"],
  [/^\/kb\//, "article"],
];

/** Route-specific parameter values from what discovery found for the role. */
export function valuesFor(route, found) {
  const values = { ...found };
  if (route.startsWith("/agent/work-items/")) values.key = found.workItemKey;
  else if (route.startsWith("/agent/reports/")) values.key = found.report;
  const rule = ID_RULES.find(([re]) => re.test(route));
  values.id = rule ? found[rule[1]] : undefined;
  values.cycleId = found.cycle;
  values.moduleId = found.module;
  values.pageId = found.page;
  values.typeKey = found.requestTypeKey;
  return values;
}

const DENIED_STATUS = new Set([401, 403, 404]);
const DENIED_TEXT =
  /^\s*(403|404)\b|forbidden|not found|access denied|no access|do(?:n't| not) have permission/i;
const SIGN_IN_PATH = /\/(auth\/|god-mode\/)?sign-in\/?$/;

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** A refused settings History read (`GET /api/audit`) only hides that panel; the page stays reachable. */
export function isHistoryRefusal(url, status) {
  return pathOf(url) === "/api/audit" && DENIED_STATUS.has(status);
}

export function isApiDenial(url, status) {
  return (
    pathOf(url).startsWith("/api/") &&
    DENIED_STATUS.has(status) &&
    !isHistoryRefusal(url, status)
  );
}

/**
 * Decide whether the role was denied (reported as `denied`, not as a failure).
 * Signals: redirect to a sign-in page, 401/403/404 on the document or an API
 * call, or a short page whose text says forbidden / not found.
 */
export function classifyDenial({
  requestedUrl,
  finalUrl,
  documentStatus,
  apiStatuses = [],
  mainText = "",
}) {
  if (
    SIGN_IN_PATH.test(pathOf(finalUrl)) &&
    !SIGN_IN_PATH.test(pathOf(requestedUrl))
  )
    return { denied: true, reason: "redirected to sign-in" };
  if (DENIED_STATUS.has(documentStatus))
    return { denied: true, reason: `document ${documentStatus}` };
  const api = apiStatuses.find((status) => DENIED_STATUS.has(status));
  if (api) return { denied: true, reason: `api ${api}` };
  if (mainText.length < 600 && DENIED_TEXT.test(mainText))
    return { denied: true, reason: "denial page" };
  return { denied: false, reason: null };
}

/** Parse and validate CLI arguments. */
export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "agent-origin": { type: "string" },
      "portal-origin": { type: "string" },
      accounts: { type: "string" },
      out: { type: "string" },
      roles: { type: "string" },
      widths: { type: "string" },
      themes: { type: "string" },
      routes: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  for (const name of ["agent-origin", "portal-origin", "accounts", "out"]) {
    if (!values[name]) throw new Error(`Missing --${name}`);
  }
  const widths = parseCsv(values.widths, ["1440", "768", "390"]).map(Number);
  if (widths.some((w) => !Number.isInteger(w) || w < 200 || w > 4000))
    throw new Error("Invalid --widths");
  const themes = parseCsv(values.themes, ["light", "dark"]);
  if (themes.some((theme) => theme !== "light" && theme !== "dark"))
    throw new Error("Invalid --themes");
  const concurrency = Number(values.concurrency ?? 3);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10)
    throw new Error("Invalid --concurrency");
  return {
    agentOrigin: new URL(values["agent-origin"]).origin,
    portalOrigin: new URL(values["portal-origin"]).origin,
    accounts: values.accounts,
    out: path.resolve(values.out),
    roles: parseCsv(values.roles, null),
    widths,
    themes,
    routes: values.routes ? new RegExp(values.routes) : null,
    concurrency,
  };
}

/** Bounded-concurrency queue; fn must not throw. */
export async function runQueue(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

/** Issue types for one cell; denied cells report no page issues. */
export function issuesOf(cell) {
  if (cell.error) return ["error"];
  if (cell.denied) return [];
  const issues = [];
  if (cell.consoleErrors?.length) issues.push("console");
  if (cell.failedRequests?.length) issues.push("request");
  if (cell.overflow) issues.push("overflow");
  // Only critical axe violations fail a cell; the rest are warnings (see axeWarningsOf).
  if (cell.axe?.some((v) => v.impact === "critical")) issues.push("axe");
  return issues;
}

/** Non-critical axe violations of one cell, by impact. */
export function axeWarningsOf(cell) {
  const counts = { serious: 0, moderate: 0, minor: 0 };
  for (const v of cell.axe ?? []) if (v.impact in counts) counts[v.impact]++;
  return counts;
}

/** Markdown summary: counts, failing routes, role x route denial matrix. */
export function buildSummary(meta, cells) {
  const count = (fn) => cells.filter(fn).length;
  const ran = cells.filter((cell) => !cell.skipped);
  const cell = (value) => String(value).replaceAll("|", "\\|");
  const lines = [
    "# Screen sweep summary",
    "",
    `Cells run: ${ran.length}; skipped routes: ${new Set(cells.filter((c) => c.skipped).map((c) => `${c.role}|${c.route}`)).size}`,
    meta.axe
      ? ""
      : "Axe: skipped (`@axe-core/playwright` is not resolvable from apps/web).",
    "",
    "## Counts by issue type",
    "",
    "| Issue | Cells |",
    "| --- | ---: |",
    ...["console", "request", "overflow", "axe", "error"].map(
      (type) => `| ${type} | ${count((c) => issuesOf(c).includes(type))} |`,
    ),
    `| denied | ${count((c) => c.denied)} |`,
    "",
    "## Axe warnings (not failures; only critical counts as an issue)",
    "",
    "| Impact | Cells | Violations |",
    "| --- | ---: | ---: |",
    ...["serious", "moderate", "minor"].map(
      (impact) =>
        `| ${impact} | ${count((c) => axeWarningsOf(c)[impact] > 0)} | ${cells.reduce((n, c) => n + axeWarningsOf(c)[impact], 0)} |`,
    ),
    "",
    "## Routes with failures",
    "",
  ];
  const failing = new Map();
  for (const c of ran) {
    const issues = issuesOf(c);
    if (!issues.length) continue;
    const key = `${c.role}|${c.route}`;
    const entry = failing.get(key) ?? {
      role: c.role,
      route: c.route,
      set: new Set(),
      where: [],
    };
    for (const issue of issues) entry.set.add(issue);
    entry.where.push(`${c.width}-${c.theme}`);
    failing.set(key, entry);
  }
  if (failing.size === 0) lines.push("None.");
  else {
    lines.push(
      "| Role | Route | Issues | Cells |",
      "| --- | --- | --- | --- |",
    );
    for (const e of failing.values())
      lines.push(
        `| ${e.role} | ${cell(e.route)} | ${[...e.set].join(", ")} | ${e.where.join(" ")} |`,
      );
  }
  const roles = [...new Set(cells.map((c) => c.role))];
  const routes = [...new Set(cells.map((c) => c.route))];
  lines.push(
    "",
    "## Denial matrix",
    "",
    "D = denied, ok = reachable, skip = skipped, - = other host",
    "",
  );
  lines.push(
    `| Route | ${roles.join(" | ")} |`,
    `| --- |${roles.map(() => " --- |").join("")}`,
  );
  for (const route of routes) {
    const marks = roles.map((role) => {
      const mine = cells.filter((c) => c.role === role && c.route === route);
      if (mine.length === 0) return "-";
      if (mine.every((c) => c.skipped)) return "skip";
      return mine.some((c) => c.denied) ? "D" : "ok";
    });
    lines.push(`| ${cell(route)} | ${marks.join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

// ---- Runner (needs a browser; not covered by the node tests) ----

const NOT_FOUND_ROUTE = "/__sweep-not-found";

/** Sets the app's own persisted theme before any page script runs. */
function seedTheme(theme) {
  try {
    const key = "user-preferences";
    const current = JSON.parse(localStorage.getItem(key) || "null") || {
      state: {},
      version: 0,
    };
    current.state = { ...current.state, theme };
    localStorage.setItem(key, JSON.stringify(current));
  } catch {
    // storage blocked: emulateMedia still applies
  }
}

async function signIn(context, account, origin) {
  const page = await context.newPage();
  try {
    const signInButton = page.getByRole("button", { name: /^sign in$/i });
    if (account.host === "portal") {
      await page.goto(new URL("/sign-in", origin).toString());
      await page.getByLabel("Email").fill(account.email);
      await signInButton.click();
      await page.getByLabel("Password", { exact: true }).fill(account.password);
      await signInButton.click();
    } else {
      await page.goto(new URL("/auth/sign-in", origin).toString());
      // The form opens on the emailed-code method when it is enabled.
      await page
        .getByRole("button", { name: /use password instead/i })
        .click({ timeout: 5000 })
        .catch(() => {});
      await page.getByLabel("Email").fill(account.email);
      await page.getByLabel("Password", { exact: true }).fill(account.password);
      await signInButton.click();
    }
    await page.waitForURL((url) => !SIGN_IN_PATH.test(url.pathname), {
      timeout: 20000,
    });
  } finally {
    await page.close();
  }
}

/** Find IDs the role can reach through the app's own JSON API. */
async function discover(context, origin, host) {
  const found = {};
  const get = async (apiPath, headers) => {
    const response = await context.request.get(`${origin}/api${apiPath}`, {
      headers,
    });
    return response.ok() ? response.json().catch(() => null) : null;
  };
  const first = async (name, apiPath, pick, headers) => {
    try {
      const row = rowsOf(await get(apiPath, headers))[0];
      const value = row && pick(row);
      if (value) found[name] = String(value);
    } catch {
      // unreachable resource: the route is skipped
    }
  };
  const id = (row) => row.id;
  if (host === "portal") {
    await first("projectKey", "/portal/projects", (r) => r.key);
    await first("key", "/portal/projects", (r) => r.key);
    await first("ref", "/portal/requests", (r) => r.ref);
    await first("article", "/portal/kb", id);
    await first("announcement", "/portal/announcements", id);
    await first("approval", "/portal/approvals", id);
    return found;
  }
  await first("workspaceId", "/workspace", id);
  const ws = found.workspaceId;
  if (!ws) return found;
  const q = `?workspaceId=${encodeURIComponent(ws)}`;
  const projects = rowsOf(await get(`/project${q}`).catch(() => null)).slice(
    0,
    5,
  );
  for (const project of projects) {
    found.key = String(project.key ?? project.slug ?? project.id);
    found.projectId = String(project.id);
    await first(
      "workItemKey",
      `/projects/${encodeURIComponent(found.projectId)}/work-items?limit=1`,
      (r) => r.key,
    );
    if (found.workItemKey) break;
  }
  const k = encodeURIComponent(found.key ?? "");
  const p = encodeURIComponent(found.projectId ?? "");
  if (found.key) {
    await first("cycle", `/projects/${k}/cycles`, id);
    await first("module", `/projects/${k}/modules`, id);
    await first("page", `/projects/${p}/pages`, id);
  }
  await first("service", `/services${q}`, id);
  await first("article", `/kb/articles${q}`, id);
  await first("report", `/reports${q}`, (r) => r.key);
  await first("reportExport", `/report-exports${q}`, id);
  await first("view", `/views${q}`, id);
  await first("pendingAction", "/me/pending-actions", id);
  await first("team", `/teams${q}`, id);
  await first("role", `/workspace/${encodeURIComponent(ws)}/roles`, id);
  await first("workflow", `/workflows${q}`, id);
  await first("slaPolicy", `/sla-policies${q}`, id);
  await first("calendar", `/service-calendars${q}`, id);
  await first("customField", `/custom-fields${q}`, id);
  await first("webhook", "/webhooks", id, { "x-workspace-id": ws });
  await first("identity", "/instance/identity-connections", id);
  await first("organisation", "/instance/organisations", id);
  await first("importRun", `/imports${q}`, id);
  await first("requestType", `/request-types${q}`, id);
  await first("requestTypeKey", `/request-types${q}`, (r) => r.key);
  await first("announcement", `/announcements${q}`, id);
  await first("ref", `/submissions${q}`, (r) => r.ref);
  return found;
}

async function visit(context, job, axeBuilder) {
  const { role, host, origin, route, resolved, width, theme } = job;
  const started = Date.now();
  const result = { role, host, route, width, theme };
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const apiStatuses = [];
  try {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(seedTheme, theme);
    page.on("console", (message) => {
      // Failed loads are reported once, as failed requests.
      if (
        message.type() === "error" &&
        !/Failed to load resource/.test(message.text())
      )
        consoleErrors.push(redactText(message.text()));
    });
    page.on("pageerror", (error) =>
      consoleErrors.push(redactText(`pageerror: ${error.message}`)),
    );
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const url = response.url();
      if (isApiDenial(url, status)) apiStatuses.push(status);
      else if (!isHistoryRefusal(url, status))
        failedRequests.push({ url: redactUrl(url), status });
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "failed";
      if (!/ERR_ABORTED/.test(failure))
        failedRequests.push({
          url: redactUrl(request.url()),
          status: 0,
          failure,
        });
    });
    const requestedUrl = new URL(resolved, origin).toString();
    const response = await page.goto(requestedUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .locator("main")
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 3000 })
      .catch(() => {});
    const documentStatus = response?.status() ?? null;
    const mainText = await page
      .locator("main, body")
      .first()
      .innerText({ timeout: 2000 })
      .catch(() => "");
    const finalUrl = page.url();
    const denial = classifyDenial({
      requestedUrl,
      finalUrl,
      documentStatus,
      apiStatuses,
      mainText,
    });
    Object.assign(result, {
      finalUrl: redactUrl(finalUrl),
      documentStatus,
      denied: denial.denied,
      deniedReason: denial.reason,
      consoleErrors,
      failedRequests,
      overflow: await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
      ),
    });
    if (axeBuilder && !denial.denied) {
      const axe = await new axeBuilder({ page }).analyze();
      result.axe = axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
      }));
    }
    result.shot = path.join(
      "shots",
      slugify(role),
      `${width}-${theme}`,
      `${slugify(route)}.png`,
    );
    await page.screenshot({
      path: path.join(job.out, result.shot),
      fullPage: true,
      timeout: 15000,
    });
  } catch (error) {
    result.error = redactText(error instanceof Error ? error.message : error);
  } finally {
    result.elapsedMs = Date.now() - started;
    await page.close().catch(() => {});
  }
  return result;
}

/** Each cell has its own timeout; a stuck cell is recorded, not fatal. */
function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function main(argv) {
  const opts = parseCli(argv);
  const rel = path.relative(REPO, opts.out);
  if (!rel.startsWith("..") && !path.isAbsolute(rel))
    throw new Error("--out must be outside the repo");
  mkdirSync(path.dirname(opts.out), { recursive: true });
  mkdirSync(opts.out, { mode: 0o700 }); // throws if it already exists
  mkdirSync(path.join(opts.out, "shots"), { mode: 0o700 });

  const raw = JSON.parse(readFileSync(opts.accounts, "utf8"));
  const accounts = (Array.isArray(raw) ? raw : raw.accounts).filter(
    (account) => !opts.roles || opts.roles.includes(account.role),
  );
  if (accounts.length === 0) throw new Error("No accounts match --roles");

  const seen = new Set();
  const routes = parseRoutes(
    readFileSync(path.join(REPO, "docs/screens.md"), "utf8"),
  )
    .map((r) => ({ ...r, route: r.route === "*" ? NOT_FOUND_ROUTE : r.route }))
    .filter((r) => {
      const key = `${r.host}|${r.route}`;
      if (seen.has(key) || (opts.routes && !opts.routes.test(r.route)))
        return false;
      seen.add(key);
      return true;
    });

  const require = createRequire(path.join(REPO, "apps/web/package.json"));
  const { chromium } = require("@playwright/test");
  let axeBuilder = null;
  try {
    const axe = require("@axe-core/playwright");
    axeBuilder = axe.AxeBuilder ?? axe.default ?? null;
  } catch {
    // reported once in the summary
  }

  const cells = [];
  const jobs = [];
  const contexts = new Map();
  const browser = await chromium.launch();
  try {
    for (const account of accounts) {
      const origin =
        account.host === "portal" ? opts.portalOrigin : opts.agentOrigin;
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      contexts.set(account.role, context);
      const mine = routes.filter((r) => r.host === account.host);
      let found = {};
      try {
        await signIn(context, account, origin);
        found = await discover(context, origin, account.host);
      } catch (error) {
        const reason = `sign-in failed: ${redactText(error instanceof Error ? error.message : error, 120)}`;
        for (const r of mine)
          cells.push({
            role: account.role,
            host: account.host,
            route: r.route,
            skipped: reason,
          });
        continue;
      }
      for (const r of mine) {
        const resolved =
          r.route === NOT_FOUND_ROUTE
            ? r.route
            : resolveRoute(r.route, valuesFor(r.route, found));
        if (!resolved) {
          cells.push({
            role: account.role,
            host: account.host,
            route: r.route,
            skipped: "no reachable instance",
          });
          continue;
        }
        for (const width of opts.widths)
          for (const theme of opts.themes) {
            mkdirSync(
              path.join(
                opts.out,
                "shots",
                slugify(account.role),
                `${width}-${theme}`,
              ),
              { recursive: true, mode: 0o700 },
            );
            jobs.push({
              role: account.role,
              host: account.host,
              origin,
              route: r.route,
              resolved,
              width,
              theme,
              out: opts.out,
            });
          }
      }
    }
    await runQueue(jobs, opts.concurrency, async (job) => {
      const base = {
        role: job.role,
        host: job.host,
        route: job.route,
        width: job.width,
        theme: job.theme,
      };
      cells.push(
        await withTimeout(
          visit(contexts.get(job.role), job, axeBuilder).catch((error) => ({
            ...base,
            error: redactText(error),
          })),
          60000,
          { ...base, error: "cell timeout" },
        ),
      );
    });
  } finally {
    await browser.close().catch(() => {});
  }

  writeFileSync(
    path.join(opts.out, "results.json"),
    JSON.stringify({ axe: Boolean(axeBuilder), cells }, null, 2),
    { mode: 0o600 },
  );
  const summary = path.join(opts.out, "summary.md");
  writeFileSync(summary, buildSummary({ axe: Boolean(axeBuilder) }, cells), {
    mode: 0o600,
  });
  console.log(summary);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(redactText(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
