import {
  access,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseTaskDeskRole,
  roleOwnsGeneralJobs,
  roleOwnsHttp,
  type ServingRole,
  startJobLivenessServer,
} from "../../apps/api/src/runtime-role";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runtime role ownership", () => {
  it("defaults to all and rejects unknown role names", () => {
    expect(parseTaskDeskRole(undefined)).toBe("all");
    expect(parseTaskDeskRole("web")).toBe("web");
    expect(() => parseTaskDeskRole("worker")).toThrow("TASKDESK_ROLE");
  });

  it("assigns HTTP and general jobs to the documented roles", () => {
    const expected: Record<ServingRole, [boolean, boolean]> = {
      web: [true, false],
      jobs: [false, true],
      all: [true, true],
    };
    for (const [role, ownership] of Object.entries(expected) as Array<
      [ServingRole, [boolean, boolean]]
    >) {
      expect([roleOwnsHttp(role), roleOwnsGeneralJobs(role)]).toEqual(
        ownership,
      );
    }
  });

  it("answers a fixed ping on its Unix socket and removes it on shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "taskdesk-liveness-"));
    tempDirectories.push(directory);
    const path = join(directory, "health.sock");
    const stop = await startJobLivenessServer(path);
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(path);
      let response = "";
      socket.on("connect", () => socket.write("ping\n"));
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => (response += chunk));
      socket.on("end", () => resolve(response));
      socket.on("error", reject);
    });
    expect(reply).toBe("pong\n");

    await stop();
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves regular files and symlinks at the liveness path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "taskdesk-liveness-"));
    tempDirectories.push(directory);
    const regularFile = join(directory, "regular");
    const target = join(directory, "target");
    const link = join(directory, "link");
    await writeFile(regularFile, "keep regular file");
    await writeFile(target, "keep symlink target");
    await symlink(target, link);

    await expect(startJobLivenessServer(regularFile)).rejects.toThrow(
      "not an owned Unix socket",
    );
    await expect(startJobLivenessServer(link)).rejects.toThrow(
      "not an owned Unix socket",
    );
    await expect(readFile(regularFile, "utf8")).resolves.toBe(
      "keep regular file",
    );
    await expect(readFile(target, "utf8")).resolves.toBe("keep symlink target");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });

  it("refuses to replace an active socket", async () => {
    const directory = await mkdtemp(join(tmpdir(), "taskdesk-liveness-"));
    tempDirectories.push(directory);
    const path = join(directory, "health.sock");
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(path, resolve));

    await expect(startJobLivenessServer(path)).rejects.toThrow(
      "already in use",
    );
    expect(server.listening).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("recovers an owned stale socket after verifying its identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "taskdesk-liveness-"));
    tempDirectories.push(directory);
    const path = join(directory, "health.sock");
    const movedPath = join(directory, "stale.sock");
    const staleServer = createServer();
    await new Promise<void>((resolve) => staleServer.listen(path, resolve));
    await rename(path, movedPath);
    await new Promise<void>((resolve) => staleServer.close(() => resolve()));
    await rename(movedPath, path);

    expect((await lstat(path)).isSocket()).toBe(true);
    const stop = await startJobLivenessServer(path);
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(path);
      let response = "";
      socket.once("connect", () => socket.write("ping\n"));
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => (response += chunk));
      socket.once("end", () => resolve(response));
      socket.once("error", reject);
    });
    expect(reply).toBe("pong\n");
    await stop();
  });

  it("closes an idle client within the bounded socket lifetime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "taskdesk-liveness-"));
    tempDirectories.push(directory);
    const path = join(directory, "health.sock");
    const stop = await startJobLivenessServer(path);
    const socket = createConnection(path);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("idle liveness connection was not closed")),
        2500,
      );
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await stop();
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("shuts down immediately when an idle client is still connected", async () => {
    const directory = await mkdtemp(join(tmpdir(), "taskdesk-liveness-"));
    tempDirectories.push(directory);
    const path = join(directory, "health.sock");
    const stop = await startJobLivenessServer(path);
    const socket = createConnection(path);
    socket.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const startedAt = Date.now();
    await stop();
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(socket.destroyed).toBe(true);
  });

  it("limits the number of simultaneous idle clients", async () => {
    const directory = await mkdtemp(join(tmpdir(), "taskdesk-liveness-"));
    tempDirectories.push(directory);
    const path = join(directory, "health.sock");
    const stop = await startJobLivenessServer(path);
    const clients = Array.from({ length: 17 }, () => createConnection(path));
    for (const client of clients) client.on("error", () => {});
    await Promise.all(
      clients.map(
        (client) =>
          new Promise<void>((resolve, reject) => {
            client.once("connect", resolve);
            client.once("error", reject);
          }),
      ),
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("excess liveness client was not dropped")),
        500,
      );
      const closes = clients.map(
        (client) => new Promise<void>((closed) => client.once("close", closed)),
      );
      void Promise.race(closes).then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    await stop();
  });
});
