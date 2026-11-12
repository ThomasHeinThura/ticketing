import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT, planRemoval } from "../../deploy/local-fresh-plan.mjs";

function fixture() {
  return {
    confirmation: PROJECT,
    config: { name: PROJECT, services: {} },
    containers: [
      {
        Id: "a".repeat(64),
        Config: { Labels: { "com.docker.compose.project": PROJECT } },
        HostConfig: {},
      },
    ],
    volumes: [
      {
        Name: `${PROJECT}_attachments`,
        Labels: {
          "com.docker.compose.project": PROJECT,
          "com.docker.compose.volume": "attachments",
        },
      },
    ],
  };
}
test("requires confirmation and returns only inspected resources", () => {
  const f = fixture();
  assert.deepEqual(planRemoval(f), {
    containers: ["a".repeat(64)],
    volumes: [`${PROJECT}_attachments`],
  });
  f.confirmation = "";
  assert.throws(() => planRemoval(f));
});
test("rejects resources from other projects", () => {
  const f = fixture();
  f.containers[0].Config.Labels["com.docker.compose.project"] = "other";
  assert.throws(() => planRemoval(f));
  const g = fixture();
  g.volumes[0].Labels["com.docker.compose.project"] = "other";
  assert.throws(() => planRemoval(g));
});
test("protects the native database port", () => {
  const f = fixture();
  f.config.services.postgres = { ports: [{ published: 62870 }] };
  assert.throws(() => planRemoval(f));
  const g = fixture();
  g.containers[0].HostConfig.PortBindings = {
    "5432/tcp": [{ HostPort: "62870" }],
  };
  assert.throws(() => planRemoval(g));
});

test("fresh plan orders backup before any removal", async () => {
  const { buildFreshPlan } = await import("../../deploy/local-fresh-plan.mjs");
  const steps = buildFreshPlan(fixture());
  assert.deepEqual(
    steps.map((s) => s.phase),
    [
      "verify",
      "backup",
      "reinspect",
      "remove-container",
      "remove-volume",
      "start-dependencies",
      "migrate",
      "start-app-and-proxy",
      "seed",
      "readiness",
      "smoke",
    ],
  );
});

test("rejects similar projects, metacharacters, malformed IDs and duplicate resources", () => {
  for (const value of [
    "",
    "taskdesk-codex-testing2",
    "taskdesk-codex-testing;true",
    "$(whoami)",
  ]) {
    const f = fixture();
    f.confirmation = value;
    assert.throws(() => planRemoval(f));
  }
  for (const value of [
    "taskdesk-codex-testing2",
    "",
    "taskdesk-codex-testing;true",
  ]) {
    const f = fixture();
    f.containers[0].Config.Labels["com.docker.compose.project"] = value;
    assert.throws(() => planRemoval(f));
  }
  const f = fixture();
  f.containers.push(f.containers[0]);
  assert.throws(() => planRemoval(f));
  const g = fixture();
  g.volumes.push(g.volumes[0]);
  assert.throws(() => planRemoval(g));
  const h = fixture();
  h.containers[0].Id = "a;true";
  assert.throws(() => planRemoval(h));
});

test("rejects host networking, publish-all and live port 62870 bindings", () => {
  for (const host of [
    { NetworkMode: "host" },
    { PublishAllPorts: true },
    { PortBindings: { "5432/tcp": [{ HostPort: "62870" }] } },
  ]) {
    const f = fixture();
    f.containers[0].HostConfig = host;
    assert.throws(() => planRemoval(f));
  }
  const f = fixture();
  f.containers[0].NetworkSettings = {
    Ports: { "5432/tcp": [{ HostPort: "62870" }] },
  };
  assert.throws(() => planRemoval(f));
});
