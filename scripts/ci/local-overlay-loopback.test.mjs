// #752: a local stack listens on loopback only, and never publishes the
// application port. Read from the overlay files themselves, so a later edit that
// widens a binding (or re-adds the 5173 publication) fails here rather than on
// someone's network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCAL_OVERLAYS = ["deploy/compose.local.yml", "deploy/compose.traefik.yml"];

// Returns { service: [port entries] } for the top-level `services:` block. The
// overlays use the short string syntax only; any other form is reported so the
// check cannot pass by not understanding a new shape.
function publishedPorts(text) {
  const out = {};
  let service = null;
  let inPorts = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\S/.test(line)) {
      service = null;
      inPorts = false;
      continue;
    }
    const serviceMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (serviceMatch) {
      service = serviceMatch[1];
      inPorts = false;
      continue;
    }
    if (/^ {4}ports:/.test(line)) {
      assert.match(line, /^ {4}ports:(\s*!override)?\s*$/, `unsupported ports form: ${raw}`);
      inPorts = true;
      out[service] ??= [];
      continue;
    }
    if (inPorts) {
      const item = /^ {6}- +"([^"]+)"\s*$/.exec(line);
      if (item) {
        out[service].push(item[1]);
        continue;
      }
      if (/^ {6}-/.test(line)) assert.fail(`unquoted or long-form port entry: ${raw}`);
      if (/^ {4}\S/.test(line) || /^ {2}\S/.test(line)) inPorts = false;
    }
  }
  return out;
}

for (const file of LOCAL_OVERLAYS) {
  test(`${file}: every published port is bound to loopback`, async () => {
    const ports = publishedPorts(await readFile(path.join(root, file), "utf8"));
    for (const [service, entries] of Object.entries(ports)) {
      for (const entry of entries) {
        assert.match(
          entry,
          /^(127\.0\.0\.1|\[::1\]):/,
          `${file} publishes ${service} on "${entry}", which is not loopback-only (#752)`,
        );
      }
    }
  });

  test(`${file}: the application service publishes no port`, async () => {
    const ports = publishedPorts(await readFile(path.join(root, file), "utf8"));
    assert.equal(ports.taskdesk, undefined, `${file} publishes the taskdesk application port`);
  });
}

test("the local Traefik publishes both address families for HTTP and HTTPS", async () => {
  const ports = publishedPorts(await readFile(path.join(root, "deploy/compose.traefik.yml"), "utf8"));
  const entries = ports.traefik ?? [];
  for (const family of ["127.0.0.1", "[::1]"]) {
    for (const target of [":80", ":443"]) {
      assert.ok(
        entries.some((entry) => entry.startsWith(`${family}:`) && entry.endsWith(target)),
        `traefik has no ${family} binding for container port ${target.slice(1)}`,
      );
    }
  }
});

test("the parser sees a wildcard binding and a published application port", () => {
  const sample = [
    "services:",
    "  taskdesk:",
    "    ports:",
    '      - "5173:5173"',
    "  traefik:",
    "    ports: !override",
    '      - "8443:443"',
    '      - "127.0.0.1:80:80"',
    "    volumes:",
    '      - "./x:/y"',
  ].join("\n");
  assert.deepEqual(publishedPorts(sample), {
    taskdesk: ["5173:5173"],
    traefik: ["8443:443", "127.0.0.1:80:80"],
  });
});
