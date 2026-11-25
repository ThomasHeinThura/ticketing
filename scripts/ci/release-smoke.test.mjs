import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function smoke(enabled, kbStatus, flags = [], healthFailures = 0, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "release-smoke-test-"));
  try {
    const credentials = join(dir, "accounts.json");
    const captures = join(dir, "captures.json");
    writeFileSync(
      credentials,
      JSON.stringify({
        accounts: [
          { email: "owner@example.com", password: "fixture", side: "staff" },
          {
            email: "customer@example.com",
            password: "fixture",
            side: "customer",
          },
        ],
      }),
    );
    const preload = join(dir, "fixture.cjs");
    writeFileSync(
      preload,
      `
const fs = require('node:fs');
const Module = require('node:module');
const captures = { contexts: [], pages: [], requests: [] };
let healthFailures = ${healthFailures};
process.on('exit', () => fs.writeFileSync(${JSON.stringify(captures)}, JSON.stringify(captures)));
global.fetch = async (url, init) => {
 const route = new URL(url).pathname;
 captures.requests.push(route);
 let body = {}, status = 200;
 if (route === '/api/public/health/ready' && process.env.STALL_READY) await new Promise((_, reject) => { const hold = setTimeout(() => {}, 60000); init.signal.addEventListener('abort', () => { clearTimeout(hold); reject(new Error('aborted')); }); });
 if (route === '/api/public/health/ready' && healthFailures-- > 0) return {status:503, json:async()=>({}), headers:{getSetCookie:()=>[]}};
 if (route === '/api/auth/get-session') body = { user: { id: 'owner' } };
 else if (route === '/api/workspace') body = [{id:'workspace'}];
 else if (route === '/api/project') body = [{id:'project', slug:'HELP'}];
 else if (route === '/api/projects/project/work-items') body = [];
 else if (route.endsWith('/features/resolved')) body = {features:[{key:'feature.knowledge_base',enabled:${enabled}}]};
 else if (route === '/api/kb/articles') status = ${kbStatus};
 else if (!['/api/auth/sign-in/email','/api/public/health/ready','/api/portal/catalogue','/api/portal/submissions'].includes(route)) throw Error('unexpected route');
 return {status, json:async()=>body, headers:{getSetCookie:()=>['session=fixture']}};
};
const original = Module._load;
Module._load = function(name, ...args) {
 if (name !== '@playwright/test') return original.call(this, name, ...args);
 return { chromium: { launch: async()=>({
  newContext: async(options)=>{
   captures.contexts.push(options);
   return {addCookies:async()=>{},close:async()=>{},newPage:async()=>({
    on:()=>{},goto:async(url)=>{captures.pages.push(new URL(url).pathname);return {status:()=>200};},
    waitForTimeout:async()=>{},getByText:()=>({count:async()=>0}),screenshot:async()=>{},close:async()=>{}
   })};
  }, close:async()=>{}
 })}};
};`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        resolve("scripts/sit/release-smoke.mjs"),
        "--credentials",
        credentials,
        "--out",
        join(dir, "out"),
        "--pause",
        "0",
        ...flags,
      ],
      { encoding: "utf8", timeout: 30_000, env: { ...process.env, ...env } },
    );
    return { ...result, captures: JSON.parse(readFileSync(captures, "utf8")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("smoke uses registered work-item route and rejects enabled KB 404", () => {
  const failed = smoke(true, 404, ["--no-browser"]);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /PASS {2}owner: work items/);
  assert.match(failed.stdout, /FAIL {2}owner: kb/);
  assert.equal(smoke(false, 404, ["--no-browser"]).status, 0);
});

test("smoke capture flags select accounts, viewport, scheme and extra routes", () => {
  const result = smoke(true, 200, [
    "--width",
    "390",
    "--height",
    "844",
    "--scheme",
    "light",
    "--accounts",
    "owner",
    "--extra",
    "/agent/projects/{key}/pages",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.captures.contexts.length, 1);
  assert.deepEqual(result.captures.contexts[0].viewport, {
    width: 390,
    height: 844,
  });
  assert.equal(result.captures.contexts[0].colorScheme, "light");
  assert.ok(result.captures.pages.includes("/agent/projects/HELP/pages"));
  const portal = smoke(true, 200, [
    "--accounts",
    "customer",
    "--extra-portal",
    "/approvals",
  ]);
  assert.equal(portal.status, 0, portal.stderr);
  assert.ok(portal.captures.pages.includes("/approvals"));
});

test("smoke rejects unknown or empty account filters before any requests", () => {
  for (const args of [
    ["--accounts", "owenr"],
    ["--accounts", "owner,owenr"],
    ["--accounts", ",,"],
    ["--accounts", ""],
    ["--accounts="],
  ]) {
    const result = smoke(true, 200, [...args, "--no-browser"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /account filter/i);
    assert.deepEqual(result.captures.requests, []);
  }
});

test("smoke --wait-ready polls readiness until 200 and gives up after the timeout", () => {
  const waited = smoke(
    true,
    200,
    ["--no-browser", "--wait-ready", "10", "--wait-interval", "0.05"],
    3,
  );
  assert.equal(waited.status, 0, waited.stdout);
  assert.ok(
    waited.captures.requests.filter(
      (route) => route === "/api/public/health/ready",
    ).length >= 5,
  );
  const noWait = smoke(true, 200, ["--no-browser"], 1);
  assert.equal(noWait.status, 1);
  assert.match(noWait.stdout, /FAIL {2}ready/);
  const expired = smoke(
    true,
    200,
    ["--no-browser", "--wait-ready", "0.2", "--wait-interval", "0.05"],
    1000,
  );
  assert.equal(expired.status, 1);
  assert.match(expired.stdout, /FAIL {2}ready/);
  const invalid = smoke(true, 200, ["--no-browser", "--wait-ready", "soon"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--wait-ready/);
});

test("smoke --wait-ready aborts a stalled readiness request at the deadline", () => {
  const started = Date.now();
  const stalled = smoke(
    true,
    200,
    ["--no-browser", "--wait-ready", "1", "--wait-interval", "30"],
    0,
    { STALL_READY: "1" },
  );
  assert.equal(stalled.status, 1);
  assert.match(stalled.stdout, /FAIL {2}ready.*unreachable/);
  // Two hosts, each bounded by the 3 s floor; far below the 30 s interval or a hang.
  assert.ok(Date.now() - started < 15_000);
});
