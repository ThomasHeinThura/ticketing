// Offline by default. Real engine execution requires --real-engine and an image ID.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireHostBootstrapFence,
  isLocalDockerSocket,
} from "../../deploy/local-candidate-daemon-lease.mjs";
import {
  advanceEventFence,
  beginEventFence,
} from "../../deploy/local-candidate-selection.mjs";

const fail = (message) => {
  throw new Error(message);
};
const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;

export function qualifyEngine({
  imageId,
  run = spawnSync,
  env = process.env,
  token = randomBytes(32).toString("hex"),
  acquireFence = acquireHostBootstrapFence,
}) {
  if (!imagePattern.test(imageId || "") || !idPattern.test(token))
    fail("Invalid fixture input.");
  // Reject overrides rather than interpreting conflicting Docker CLI configuration.
  if (
    Object.keys(env).some(
      (key) => key.startsWith("DOCKER_") && key !== "DOCKER_CONFIG",
    )
  )
    fail("Docker environment overrides are unsupported.");
  const cleanEnv = Object.fromEntries(
    ["PATH", "HOME", "DOCKER_CONFIG"]
      .filter((key) => env[key] !== undefined)
      .map((key) => [key, env[key]]),
  );
  const execute = (args, commandEnv = cleanEnv) => {
    const result = run("docker", args, {
      env: commandEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    if (result.error || result.status !== 0)
      fail("Docker command failed; inspect fixture state.");
    return result.stdout || "";
  };
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return fail("Invalid Docker response.");
    }
  };
  const context = execute(["context", "show"]).trim();
  if (!context || /\s/.test(context)) fail("Invalid Docker context.");
  const inspectContext = () => {
    if (execute(["context", "show"]).trim() !== context)
      fail("Docker context drift.");
    const value = parse(execute(["context", "inspect", context]));
    if (
      !Array.isArray(value) ||
      value.length !== 1 ||
      !isLocalDockerSocket(value[0]?.Endpoints?.docker?.Host)
    )
      fail("Docker context is not local.");
    return value[0].Endpoints.docker.Host;
  };
  const endpoint = inspectContext();
  const pinnedEnv = { ...cleanEnv, DOCKER_HOST: endpoint };
  const daemon = execute(["info", "--format", "{{.ID}}"], pinnedEnv).trim();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(daemon))
    fail("Invalid Docker daemon identity.");
  const assertIdentity = () => {
    if (
      inspectContext() !== endpoint ||
      execute(["info", "--format", "{{.ID}}"], pinnedEnv).trim() !== daemon
    )
      fail("Docker daemon or context drift.");
  };
  let fence = null;
  const command = (args) => {
    if (fence) fence.assertOwned();
    assertIdentity();
    return execute(args, pinnedEnv);
  };
  const images = parse(command(["image", "inspect", imageId]));
  if (
    !Array.isArray(images) ||
    images.length !== 1 ||
    images[0]?.Id !== imageId ||
    !images[0].Config ||
    Object.keys(images[0].Config.Volumes || {}).length
  )
    fail("Image is unavailable or declares volumes.");
  let id = null;
  let result;
  let failure;
  let createAttempted = false;
  const inspectOwned = () => {
    const values = parse(command(["inspect", id]));
    const v = values[0];
    if (
      !Array.isArray(values) ||
      values.length !== 1 ||
      v?.Id !== id ||
      v.Image !== imageId ||
      v.Config?.Image !== imageId ||
      v.Config?.Labels?.["info.taskdesk.engine-fixture"] !== token ||
      v.State?.Status !== "created" ||
      v.State?.Running !== false ||
      v.State?.StartedAt !== "0001-01-01T00:00:00Z" ||
      v.HostConfig?.NetworkMode !== "none" ||
      v.HostConfig?.PublishAllPorts !== false ||
      Object.keys(v.HostConfig?.PortBindings || {}).length ||
      !Array.isArray(v.Mounts) ||
      v.Mounts.length ||
      (v.HostConfig?.Binds || []).length ||
      (v.HostConfig?.VolumesFrom || []).length ||
      Object.keys(v.NetworkSettings?.Ports || {}).length ||
      Object.keys(v.NetworkSettings?.Networks || {}).length !== 1 ||
      !v.NetworkSettings?.Networks?.none ||
      typeof v.NetworkSettings.Networks.none !== "object" ||
      Array.isArray(v.NetworkSettings.Networks.none) ||
      ["IPAddress", "GlobalIPv6Address", "Gateway", "IPv6Gateway"].some((key) =>
        Boolean(v.NetworkSettings.Networks.none[key]),
      )
    )
      fail("Fixture identity or isolation is uncertain.");
  };
  fence = acquireFence({ token });
  try {
    fence.assertOwned();
    createAttempted = true;
    const created = command([
      "create",
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--no-healthcheck",
      "--label",
      `info.taskdesk.engine-fixture=${token}`,
      "--entrypoint",
      "node",
      imageId,
      "-e",
      "process.exit(0)",
    ]).trim();
    if (!idPattern.test(created))
      fail("Container creation identity is uncertain.");
    id = created;
    inspectOwned();
    const client = {
      id,
      command: (args) => {
        inspectOwned();
        return command(args);
      },
    };
    const opening = beginEventFence(client);
    const first = advanceEventFence(client, opening);
    const second = advanceEventFence(client, first.closing);
    inspectOwned();
    result = {
      windows: 2,
      eventCounts: [first.events.length, second.events.length],
    };
  } catch (error) {
    failure = error;
  }
  let cleanupFailure = false;
  if (id) {
    try {
      inspectOwned();
      if (command(["rm", id]).trim() !== id)
        fail("Removal identity is uncertain.");
      if (
        command(["ps", "-a", "-q", "--no-trunc", "--filter", `id=${id}`]).trim()
      )
        fail("Removal is unconfirmed.");
    } catch {
      cleanupFailure = true;
    }
  } else if (createAttempted) cleanupFailure = true;
  if (cleanupFailure)
    fail(
      "Fixture failed or completed, but cleanup is unconfirmed; inspect the daemon manually before retrying.",
    );
  try {
    fence.release();
  } catch {
    fail(
      "Fixture cleanup completed, but host fence release is unconfirmed; inspect before retrying.",
    );
  }
  if (failure) throw failure;
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length === 2) {
    const test = spawnSync(
      process.execPath,
      [
        "--test",
        fileURLToPath(
          new URL("./candidate-engine-fixture.test.mjs", import.meta.url),
        ),
      ],
      { stdio: "inherit" },
    );
    process.exitCode = test.status ?? 1;
  } else if (process.argv.length === 4 && process.argv[2] === "--real-engine") {
    try {
      const result = qualifyEngine({ imageId: process.argv[3] });
      console.log(
        `Engine fixture passed: ${result.windows} windows; event counts ${result.eventCounts.join(", ")}.`,
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  } else {
    console.error(
      "Usage: node scripts/ci/candidate-engine-fixture.mjs [--real-engine sha256:<local-image-id>]",
    );
    process.exitCode = 1;
  }
}
