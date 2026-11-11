import { lstat, unlink } from "node:fs/promises";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";

export type TaskDeskRole = "web" | "jobs" | "all" | "migrate";
export type ServingRole = Exclude<TaskDeskRole, "migrate">;

export function parseTaskDeskRole(
  value = process.env.TASKDESK_ROLE,
): TaskDeskRole {
  if (value === undefined || value === "") return "all";
  if (
    value === "web" ||
    value === "jobs" ||
    value === "all" ||
    value === "migrate"
  )
    return value;
  throw new Error("TASKDESK_ROLE must be web, jobs, all, or migrate");
}

export function roleOwnsHttp(role: ServingRole): boolean {
  return role !== "jobs";
}

export function roleOwnsGeneralJobs(role: ServingRole): boolean {
  return role !== "web";
}

export function parseCandidateReadOnly(
  value = process.env.TASKDESK_CANDIDATE_READ_ONLY,
  role: TaskDeskRole = parseTaskDeskRole(process.env.TASKDESK_ROLE),
  policyShadow = process.env.TASKDESK_POLICY_SHADOW,
): boolean {
  if (
    value === undefined ||
    value === "" ||
    value === "0" ||
    value === "false"
  ) {
    return false;
  }
  if (value !== "1" && value !== "true") {
    throw new Error(
      "TASKDESK_CANDIDATE_READ_ONLY must be unset, 0, false, 1, or true",
    );
  }
  if (role !== "web") {
    throw new Error(
      `TASKDESK_CANDIDATE_READ_ONLY requires TASKDESK_ROLE=web (received TASKDESK_ROLE=${role})`,
    );
  }
  if (
    policyShadow !== undefined &&
    policyShadow !== "" &&
    policyShadow !== "off"
  ) {
    throw new Error(
      `TASKDESK_CANDIDATE_READ_ONLY requires TASKDESK_POLICY_SHADOW to be unset or off (received TASKDESK_POLICY_SHADOW=${policyShadow})`,
    );
  }
  return true;
}

export const JOB_LIVENESS_SOCKET_PATH = "/tmp/taskdesk-liveness.sock";
const LIVENESS_REQUEST = "ping\n";
const LIVENESS_RESPONSE = "pong\n";
const SOCKET_CONNECT_DEADLINE_MS = 1_500;
const SOCKET_CONNECTION_TTL_MS = 1_500;
const SOCKET_CONNECTION_LIMIT = 16;

async function clearStaleSocket(path: string): Promise<void> {
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const currentUid = process.getuid?.();
  if (
    !before.isSocket() ||
    currentUid === undefined ||
    before.uid !== currentUid
  )
    throw new Error("TaskDesk liveness path is not an owned Unix socket");

  const connectionError = await new Promise<NodeJS.ErrnoException | null>(
    (resolve, reject) => {
      const probe = createConnection(path);
      let settled = false;
      const deadline = setTimeout(() => {
        probe.destroy();
        settle(null, new Error("TaskDesk liveness socket probe timed out"));
      }, SOCKET_CONNECT_DEADLINE_MS);
      const settle = (
        error: NodeJS.ErrnoException | null,
        rejection?: Error,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (rejection) reject(rejection);
        else resolve(error);
      };
      probe.once("connect", () => {
        probe.destroy();
        settle(null, new Error("TaskDesk liveness socket is already in use"));
      });
      probe.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ECONNREFUSED") settle(error);
        else settle(error, error);
      });
    },
  );
  if (connectionError?.code !== "ECONNREFUSED") return;

  const current = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!current) return;
  if (
    !current.isSocket() ||
    current.uid !== currentUid ||
    current.dev !== before.dev ||
    current.ino !== before.ino
  ) {
    throw new Error("TaskDesk liveness path changed during stale socket check");
  }
  await unlink(path);
}

/** Dependency-free local liveness for the jobs role, which has no HTTP listener. */
export async function startJobLivenessServer(
  path = JOB_LIVENESS_SOCKET_PATH,
): Promise<() => Promise<void>> {
  await clearStaleSocket(path);
  const clients = new Set<Socket>();
  const server: Server = createServer((socket) => {
    if (clients.size >= SOCKET_CONNECTION_LIMIT) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    socket.once("close", () => clients.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(SOCKET_CONNECTION_TTL_MS, () => socket.destroy());
    const lifetime = setTimeout(
      () => socket.destroy(),
      SOCKET_CONNECTION_TTL_MS,
    );
    lifetime.unref();
    socket.once("close", () => clearTimeout(lifetime));

    let input = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      input += chunk;
      if (input.length > LIVENESS_REQUEST.length) {
        socket.destroy();
        return;
      }
      if (input === LIVENESS_REQUEST) socket.end(LIVENESS_RESPONSE);
    });
  });
  server.on("error", () => {
    for (const socket of clients) socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(path);
  });

  return () =>
    new Promise<void>((resolve, reject) => {
      for (const socket of clients) socket.destroy();
      server.close((error) => {
        if (error) reject(error);
        else {
          void unlink(path)
            .catch((unlinkError: NodeJS.ErrnoException) => {
              if (unlinkError.code !== "ENOENT") throw unlinkError;
            })
            .then(resolve, reject);
        }
      });
    });
}
