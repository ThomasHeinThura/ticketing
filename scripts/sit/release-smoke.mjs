#!/usr/bin/env node
/**
 * Release smoke for a deployed TaskDesk stack (local SIT or Technexus).
 *
 *   pnpm sit:smoke                                   local SIT, ~/.taskdesk/sit-credentials.json
 *   pnpm sit:smoke -- --agent https://… --portal https://… --credentials <file> --out <dir>
 *
 * Read-only: it signs in with each account in the credentials file and reads, never writes.
 * For every account it checks the API (session, workspaces, projects, work items, KB, portal
 * catalogue and requests) and opens the main screens in Chromium, failing on an HTTP error,
 * an uncaught page error, a console error or an error boundary. Screenshots go to --out
 * (default ~/.taskdesk/smoke-<timestamp>, 0700). Output names accounts by their local part
 * only and never prints cookies or passwords.
 *
 * The local SIT certificate is self-signed: Node trusts it through NODE_EXTRA_CA_CERTS=
 * deploy/local/certs/local.crt (the package script sets it); Chromium skips the check for
 * *.localhost hosts only.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    agent: { type: "string", default: "https://ticketing.localhost" },
    portal: { type: "string", default: "https://portal.localhost" },
    credentials: {
      type: "string",
      default: path.join(os.homedir(), ".taskdesk", "sit-credentials.json"),
    },
    out: {
      type: "string",
      default: path.join(
        os.homedir(),
        ".taskdesk",
        `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      ),
    },
    "no-browser": { type: "boolean", default: false },
    // Every account signs in from one IP. Local Traefik limits each IP to a 1000-request burst
    // and better-auth to 100 auth requests per 10 s, so accounts are spaced apart.
    pause: { type: "string", default: "12" },
  },
});

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const accounts = JSON.parse(fs.readFileSync(opts.credentials, "utf8")).accounts;
fs.mkdirSync(opts.out, { recursive: true, mode: 0o700 });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};
const who = (account) => account.email.split("@")[0];
const isCustomer = (account) =>
  account.side === "customer" || account.email.endsWith("@acme.example");

async function signIn(base, account, attempt = 0) {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: base },
    body: JSON.stringify({ email: account.email, password: account.password }),
    redirect: "manual",
  });
  if (response.status === 429 && attempt < 2) {
    const wait = Math.min(
      Number(response.headers.get("retry-after") ?? 30),
      120,
    );
    console.log(`      sign-in rate limited; waiting ${wait}s`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return signIn(base, account, attempt + 1);
  }
  const cookies = (response.headers.getSetCookie?.() ?? []).map(
    (c) => c.split(";")[0],
  );
  return { status: response.status, cookies };
}

async function getJson(base, cookies, route) {
  const response = await fetch(`${base}${route}`, {
    headers: { cookie: cookies.join("; "), Origin: base },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {}
  return { status: response.status, body };
}

const length = (value) =>
  Array.isArray(value)
    ? value.length
    : Array.isArray(value?.data)
      ? value.data.length
      : 0;

/** API checks; returns the pages to open in the browser for this account. */
async function apiChecks(account, base, cookies) {
  const name = who(account);
  const session = await getJson(base, cookies, "/api/auth/get-session");
  check(
    `${name}: session`,
    session.status === 200 && !!session.body?.user,
    String(session.status),
  );
  if (isCustomer(account)) {
    const catalogue = await getJson(base, cookies, "/api/portal/catalogue");
    const types = catalogue.body?.requestTypes?.length ?? 0;
    check(
      `${name}: portal catalogue`,
      catalogue.status === 200,
      `${catalogue.status} types=${types}`,
    );
    const requests = await getJson(base, cookies, "/api/portal/submissions");
    check(
      `${name}: portal requests`,
      requests.status === 200,
      String(requests.status),
    );
    return ["/", "/catalogue", "/requests", "/account"];
  }
  const workspaces = await getJson(base, cookies, "/api/workspace");
  check(
    `${name}: workspaces`,
    workspaces.status === 200 && length(workspaces.body) > 0,
    `${workspaces.status} n=${length(workspaces.body)}`,
  );
  const workspaceId = workspaces.body?.[0]?.id;
  const pages = [
    "/agent/my-work",
    "/agent/inbox",
    "/dashboard/settings/workspace/general",
  ];
  if (!workspaceId) return pages;
  const projects = await getJson(
    base,
    cookies,
    `/api/project?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  check(
    `${name}: projects`,
    projects.status === 200,
    `${projects.status} n=${length(projects.body)}`,
  );
  const project = projects.body?.[0];
  if (project) {
    const items = await getJson(
      base,
      cookies,
      `/api/task/tasks/${encodeURIComponent(project.id)}`,
    );
    check(`${name}: work items`, items.status === 200, String(items.status));
    pages.push(
      `/agent/projects/${project.slug}/work`,
      `/agent/projects/${project.slug}/backlog`,
    );
  }
  const kb = await getJson(
    base,
    cookies,
    `/api/kb/articles?workspaceId=${encodeURIComponent(workspaceId)}&limit=5&offset=0`,
  );
  // 404 is the documented answer while the knowledge-base feature is off.
  check(
    `${name}: kb`,
    kb.status === 200 || kb.status === 404,
    String(kb.status),
  );
  if (kb.status === 200) pages.push("/agent/kb");
  return pages;
}

async function browserChecks(browser, account, base, cookies, pages) {
  const name = who(account);
  const host = new URL(base).hostname;
  // Local SIT uses a self-signed certificate that Chromium cannot be told to trust; only
  // *.localhost stacks skip the certificate check.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: host.endsWith(".localhost"),
  });
  await context.addCookies(
    cookies.map((pair) => {
      const index = pair.indexOf("=");
      return {
        name: pair.slice(0, index),
        value: pair.slice(index + 1),
        domain: host,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      };
    }),
  );
  for (const route of pages) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) =>
      errors.push(`pageerror: ${error.message.split("\n")[0]}`),
    );
    page.on("console", (message) => {
      const text = message.text();
      // Resource failures are judged by their status below; some 404s are documented answers
      // (for example a missing email-link preference handoff).
      if (
        message.type() === "error" &&
        !text.startsWith("Failed to load resource")
      )
        errors.push(`console: ${text.split("\n")[0].slice(0, 160)}`);
    });
    page.on("response", (response) => {
      const code = response.status();
      if (code >= 500 || code === 429)
        errors.push(`${code} ${new URL(response.url()).pathname}`);
    });
    let status = 0;
    try {
      // The app keeps a realtime socket open, so the network never goes idle.
      const response = await page.goto(`${base}${route}`, {
        waitUntil: "load",
        timeout: 45_000,
      });
      status = response?.status() ?? 0;
      await page.waitForTimeout(3000);
    } catch (error) {
      errors.push(`navigation: ${String(error.message).split("\n")[0]}`);
    }
    const boundary = await page
      .getByText(/something went wrong|unexpected application error/i)
      .count()
      .catch(() => 0);
    const file = path.join(
      opts.out,
      `${name}${route.replace(/[^a-z0-9]+/gi, "_")}.png`,
    );
    await page.screenshot({ path: file, fullPage: false }).catch(() => {});
    const ok =
      status > 0 && status < 400 && errors.length === 0 && boundary === 0;
    check(
      `${name}: page ${route}`,
      ok,
      `${status}${boundary ? " error-boundary" : ""}${errors.length ? ` ${errors.slice(0, 2).join(" | ")}` : ""}`,
    );
    await page.close();
  }
  await context.close();
}

for (const url of [
  `${opts.agent}/api/public/health/ready`,
  `${opts.portal}/api/public/health/ready`,
]) {
  const response = await fetch(url).catch(() => null);
  check(
    `ready ${new URL(url).hostname}`,
    response?.status === 200,
    String(response?.status ?? "unreachable"),
  );
}

let browser = null;
if (!opts["no-browser"]) {
  const { chromium } = require("@playwright/test");
  browser = await chromium.launch({ headless: true });
}
try {
  for (const [index, account] of accounts.entries()) {
    if (index > 0)
      await new Promise((resolve) =>
        setTimeout(resolve, Number(opts.pause) * 1000),
      );
    const base = isCustomer(account) ? opts.portal : opts.agent;
    const signedIn = await signIn(base, account);
    check(
      `${who(account)}: sign-in`,
      signedIn.status === 200 && signedIn.cookies.length > 0,
      String(signedIn.status),
    );
    if (signedIn.status !== 200) continue;
    const pages = await apiChecks(account, base, signedIn.cookies);
    if (browser)
      await browserChecks(browser, account, base, signedIn.cookies, pages);
  }
} finally {
  await browser?.close();
}

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed; screenshots in ${opts.out}`,
);
process.exitCode = failed.length ? 1 : 0;
