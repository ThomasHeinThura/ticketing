import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const probe = fileURLToPath(
  new URL("../../deploy/healthcheck.mjs", import.meta.url),
);

async function runProbe(port, role = "web") {
  try {
    const result = await exec(process.execPath, [probe], {
      env: { ...process.env, TASKDESK_PORT: String(port), TASKDESK_ROLE: role },
      timeout: 3000,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("jobs liveness uses the fixed local socket and ping response", async () => {
  const path = "/tmp/taskdesk-liveness.sock";
  await unlink(path).catch(() => {});
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (message) => {
      assert.equal(message, "ping\n");
      socket.end("pong\n");
    });
  });
  await new Promise((resolve) => server.listen(path, resolve));
  try {
    assert.deepEqual(await runProbe(undefined, "jobs"), {
      code: 0,
      stdout: "",
      stderr: "",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await unlink(path).catch(() => {});
  }
});

test("jobs liveness times out when the socket does not answer", async () => {
  const path = "/tmp/taskdesk-liveness.sock";
  await unlink(path).catch(() => {});
  const sockets = new Set();
  const server = net.createServer((socket) => sockets.add(socket));
  await new Promise((resolve) => server.listen(path, resolve));
  try {
    const startedAt = Date.now();
    assert.equal((await runProbe(undefined, "jobs")).code, 1);
    assert.ok(Date.now() - startedAt < 3000);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await unlink(path).catch(() => {});
  }
});

async function withServer(handler, check) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await check(server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("liveness uses only the fixed loopback path and succeeds without response-body completion", async () => {
  await withServer(
    (request, response) => {
      assert.equal(request.url, "/api/public/health/live");
      assert.equal(request.method, "GET");
      response.writeHead(200);
      response.write("live");
    },
    async (port) => {
      assert.deepEqual(await runProbe(port), {
        code: 0,
        stdout: "",
        stderr: "",
      });
    },
  );
});

test("non-200 responses fail without following a redirect", async () => {
  for (const status of [302, 503]) {
    let calls = 0;
    await withServer(
      (_request, response) => {
        calls += 1;
        response.writeHead(status, { location: "/unexpected" });
        response.end();
      },
      async (port) => {
        assert.equal((await runProbe(port)).code, 1);
        assert.equal(calls, 1);
      },
    );
  }
});

test("a server that never sends headers fails before the container timeout", async () => {
  await withServer(
    () => {},
    async (port) => {
      assert.deepEqual(await runProbe(port), {
        code: 1,
        stdout: "",
        stderr: "",
      });
    },
  );
});

test("refused connections and invalid configured ports fail quietly", async () => {
  let closedPort;
  await withServer(
    (_request, response) => response.end(),
    async (port) => {
      closedPort = port;
    },
  );
  assert.equal((await runProbe(closedPort)).code, 1);
  for (const port of [
    "0",
    "65536",
    "-1",
    "5173/path",
    "",
    "http://example.test",
  ]) {
    assert.deepEqual(await runProbe(port), { code: 1, stdout: "", stderr: "" });
  }
});

test("the image copies the exact probe invoked by its exec-form healthcheck", async () => {
  const dockerfile = await readFile(
    new URL("../../Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(
    dockerfile,
    /COPY[^\n]*deploy\/healthcheck\.mjs \.\/healthcheck\.mjs/u,
  );
  assert.match(
    dockerfile,
    /HEALTHCHECK[^\n]*\\\n\s+CMD \["node", "\/app\/healthcheck\.mjs"\]/u,
  );
  assert.doesNotMatch(dockerfile, /apt-get install[^\n]*\bwget\b/u);
});
