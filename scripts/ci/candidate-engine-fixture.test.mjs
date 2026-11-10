import assert from "node:assert/strict";
import test from "node:test";
import { qualifyEngine } from "./candidate-engine-fixture.mjs";

const id = "a".repeat(64);
const imageId = `sha256:${"b".repeat(64)}`;
const token = "c".repeat(64);
function fake(mode = "ok") {
  let updates = 0;
  let contextCalls = 0;
  let daemonCalls = 0;
  let removed = false;
  let created = false;
  let released = false;
  const event = (n, actor = id) => ({
    Type: "container",
    Action: "update",
    Actor: { ID: actor },
    timeNano: String(1704067200000000000n + BigInt(n) * 1000000000n),
  });
  const run = (_cmd, args) => {
    let output;
    if (args[0] === "context" && args[1] === "show")
      output =
        mode === "context drift" && ++contextCalls > 4 ? "other" : "fixture";
    else if (args[0] === "context")
      output = JSON.stringify([
        { Endpoints: { docker: { Host: "unix:///tmp/fixture.sock" } } },
      ]);
    else if (args[0] === "info" && args[2] === "{{.ID}}")
      output =
        mode === "daemon drift" && ++daemonCalls > 4 ? "other" : "daemon";
    else if (args[0] === "info") output = `2024-01-01T00:00:0${updates + 1}Z`;
    else if (args[0] === "image")
      output = JSON.stringify([
        {
          Id: mode === "image mismatch" ? `sha256:${"e".repeat(64)}` : imageId,
          Config: {},
        },
      ]);
    else if (args[0] === "create") {
      created = true;
      output = mode === "ambiguous creation" ? "not-an-id" : id;
    } else if (args[0] === "inspect")
      output = JSON.stringify([
        {
          Id: id,
          Image: imageId,
          Config: {
            Image: imageId,
            Labels: { "info.taskdesk.engine-fixture": token },
          },
          State: {
            Status: "created",
            Running: false,
            StartedAt: "0001-01-01T00:00:00Z",
          },
          HostConfig: { NetworkMode: "none", PublishAllPorts: false },
          Mounts: mode === "mount" ? [{ Type: "volume" }] : [],
          NetworkSettings: {
            Networks:
              mode === "foreign network"
                ? { none: {}, bridge: {} }
                : {
                    none: {
                      IPAddress: "",
                      GlobalIPv6Address: "",
                      Gateway: "",
                      IPv6Gateway: "",
                    },
                  },
          },
        },
      ]);
    else if (args[0] === "update") {
      if (mode === "update failure") return { status: 1 };
      updates++;
      output = id;
    } else if (args[0] === "events") {
      let events =
        mode === "missing anchor"
          ? []
          : updates === 1
            ? [event(1)]
            : [event(updates - 1), event(updates)];
      if (mode === "no-op") events = [event(1)];
      if (mode === "foreign noise")
        events.splice(1, 0, event(updates - 1, "d".repeat(64)));
      if (mode === "overflow")
        events = Array.from({ length: 256 }, () => event(1));
      output = events.map(JSON.stringify).join("\n");
    } else if (args[0] === "rm") {
      if (mode === "cleanup failure") return { status: 1 };
      removed = true;
      output = id;
    } else if (args[0] === "ps") output = removed ? "" : id;
    else throw Error(`Unexpected command ${args[0]}`);
    return { status: 0, stdout: output };
  };
  return {
    run,
    acquireFence() {
      if (mode === "contention") throw Error("host fence exists");
      return {
        assertOwned() {},
        release() {
          assert.equal(removed, true);
          released = true;
        },
      };
    },
    get created() {
      return created;
    },
    get released() {
      return released;
    },
    get removed() {
      return removed;
    },
  };
}
const invoke = (f) =>
  qualifyEngine({
    imageId,
    token,
    run: f.run,
    acquireFence: f.acquireFence,
    env: { PATH: "/bin" },
  });
test("production fence accepts repeated ordered anchors and unfiltered foreign events", () => {
  for (const mode of ["ok", "foreign noise"]) {
    const f = fake(mode);
    assert.equal(invoke(f).windows, 2);
    assert.equal(f.removed, true);
  }
});
for (const mode of ["missing anchor", "no-op", "overflow", "update failure"])
  test(`fails closed on ${mode} and removes owned fixture`, () => {
    const f = fake(mode);
    assert.throws(() => invoke(f));
    assert.equal(f.removed, true);
  });
for (const mode of ["context drift", "daemon drift", "cleanup failure"])
  test(`reports unconfirmed cleanup on ${mode}`, () => {
    const f = fake(mode);
    assert.throws(() => invoke(f), /cleanup is unconfirmed/);
    assert.equal(f.removed, false);
  });
test("refuses Docker environment overrides before invoking Docker", () => {
  const f = fake();
  assert.throws(
    () =>
      qualifyEngine({
        imageId,
        token,
        run: f.run,
        env: { DOCKER_HOST: "tcp://remote" },
      }),
    /overrides/,
  );
});

test("rejects a foreign network and reports unconfirmed cleanup", () => {
  const f = fake("foreign network");
  assert.throws(() => invoke(f), /cleanup is unconfirmed/);
  assert.equal(f.removed, false);
});

test("host fence contention prevents create", () => {
  const f = fake("contention");
  assert.throws(() => invoke(f), /host fence exists/);
  assert.equal(f.created, false);
});
test("fence releases only after verified removal", () => {
  const f = fake();
  invoke(f);
  assert.equal(f.removed, true);
  assert.equal(f.released, true);
});
test("uncertain cleanup retains host fence", () => {
  const f = fake("cleanup failure");
  assert.throws(() => invoke(f), /cleanup is unconfirmed/);
  assert.equal(f.released, false);
});

test("rejects mismatched image before creation", () => {
  const f = fake("image mismatch");
  assert.throws(() => invoke(f), /Image is unavailable/);
  assert.equal(f.created, false);
});
for (const mode of ["mount", "ambiguous creation"])
  test(`retains fence on ${mode}`, () => {
    const f = fake(mode);
    assert.throws(() => invoke(f), /cleanup is unconfirmed/);
    assert.equal(f.released, false);
  });
