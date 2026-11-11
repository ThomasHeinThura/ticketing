// Stateful fake Docker daemon for offline lease tests and installer subprocesses.
import {
  existsSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  borrowHostBootstrapFence,
  releaseRecordedDockerDaemonLease,
} from "../../deploy/local-candidate-daemon-lease.mjs";

const project = "taskdesk-codex-testing";
function tick(state) {
  state.clockNano = String(
    BigInt(state.clockNano || "1800000000000000000") + 1000000n,
  );
  return state.clockNano;
}
export function emitDaemonEvent(state, type, action, id, attributes = {}) {
  const container = state.inventory?.find((container) => container.Id === id);
  const network =
    type === "network"
      ? state.networks?.[id] ||
        Object.values(state.networks || {}).find((entry) => entry.Id === id)
      : null;
  const resolvedId = network ? network.Id : id;
  const resolvedAttributes =
    type === "container" && container
      ? { name: container.Name.replace(/^\//, ""), ...attributes }
      : type === "network" && network
        ? { name: network.Name, ...attributes }
        : attributes;
  const event = {
    Type: type,
    Action: action,
    Actor: { ID: resolvedId, Attributes: resolvedAttributes },
    timeNano: tick(state),
  };
  state.events = [...(state.events || []), event].slice(-256);
  return event;
}
function eventTimestamp(value) {
  if (/^\d+\.\d+$/.test(value)) {
    const [seconds, fraction] = value.split(".");
    return BigInt(seconds) * 1000000000n + BigInt(fraction.padEnd(9, "0"));
  }
  return BigInt(Date.parse(value)) * 1000000n;
}
export function fakeDaemon(
  state = { daemonId: "offline-daemon-one", lease: null },
) {
  const calls = [];
  const run = (_bin, args, options = {}) => {
    calls.push({ args: [...args], host: options.env?.DOCKER_HOST });
    let result;
    if (args[0] === "context" && args[1] === "show") result = "desktop-linux";
    else if (args[0] === "context" && args[1] === "inspect")
      result = [
        { Endpoints: { docker: { Host: "unix:///offline-docker.sock" } } },
      ];
    else if (args[0] === "info") {
      if (state.daemonAvailable === false) return { status: 1, stdout: "" };
      result = args.includes("{{.SystemTime}}")
        ? new Date(Number(BigInt(tick(state)) / 1000000n)).toISOString()
        : state.daemonId;
    } else if (args[0] === "events") {
      const since = eventTimestamp(args[args.indexOf("--since") + 1]);
      const until = eventTimestamp(args[args.indexOf("--until") + 1]);
      result = (state.events || [])
        .filter(
          (event) =>
            BigInt(event.timeNano) >= since && BigInt(event.timeNano) <= until,
        )
        .map((event) => JSON.stringify(event))
        .join("\n");
    } else if (args[0] === "update" && args.at(-1) === state.lease?.Id) {
      emitDaemonEvent(state, "container", "update", state.lease.Id);
      result = state.lease.Id;
    } else if (args[0] === "volume" && args[1] === "ls") {
      if (!state.volumes) return { status: 1, stdout: "" };
      result = Object.keys(state.volumes).sort().join("\n");
    } else if (args[0] === "volume" && args[1] === "inspect") {
      if (!state.volumes || args.slice(2).some((name) => !state.volumes[name]))
        return { status: 1, stdout: "" };
      result = args.slice(2).map((name) => state.volumes[name]);
    } else if (args[0] === "network" && args[1] === "ls") {
      if (!state.networks) return { status: 1, stdout: "" };
      result = Object.values(state.networks)
        .map((network) => network.Id)
        .sort()
        .join("\n");
    } else if (args[0] === "network" && args[1] === "inspect") {
      const byId = new Map(
        Object.values(state.networks || {}).map((network) => [
          network.Id,
          network,
        ]),
      );
      if (
        !state.networks ||
        args.slice(2).some((key) => !state.networks[key] && !byId.has(key))
      )
        return { status: 1, stdout: "" };
      result = args
        .slice(2)
        .map((key) => structuredClone(state.networks[key] || byId.get(key)));
    } else if (args[0] === "ps")
      result =
        !args.includes("--filter") && Array.isArray(state.inventory)
          ? [
              ...state.inventory.map((container) => container.Id),
              ...(state.lease ? [state.lease.Id] : []),
            ].join("\n")
          : args.some((arg) => arg.includes("service=taskdesk"))
            ? state.appExists === false ||
              (state.appRunning === false && !args.includes("-a"))
              ? ""
              : Array.isArray(state.inventory)
                ? state.inventory
                    .filter(
                      (container) =>
                        container.Config.Labels[
                          "com.docker.compose.project"
                        ] === project &&
                        container.Config.Labels[
                          "com.docker.compose.service"
                        ] === "taskdesk" &&
                        (args.includes("-a") || container.State.Running),
                    )
                    .map((container) => container.Id)
                    .join("\n")
                : "b".repeat(64)
            : state.lease?.Id || "";
    else if (args[0] === "inspect" && Array.isArray(state.inventory)) {
      const all = new Map(
        [...state.inventory, ...(state.lease ? [state.lease] : [])].map(
          (container) => [container.Id, container],
        ),
      );
      if (args.slice(1).some((id) => !all.has(id)))
        return { status: 1, stdout: "" };
      result = args.slice(1).map((id) => structuredClone(all.get(id)));
      if (typeof state.appRunning === "boolean")
        for (const container of result)
          if (
            container.Config.Labels["com.docker.compose.service"] === "taskdesk"
          )
            container.State.Running = state.appRunning;
    } else if (args[0] === "inspect" && args[1] === "b".repeat(64))
      result = [
        {
          Id: "b".repeat(64),
          Image: `sha256:${"c".repeat(64)}`,
          Config: {
            Labels: {
              "com.docker.compose.project": project,
              "com.docker.compose.service": "taskdesk",
            },
          },
          State: { Running: state.appRunning !== false },
        },
      ];
    else if (args[0] === "image")
      result = [
        state.images?.[args[2]] ||
          Object.values(state.images || {}).find(
            (image) => image.Id === args[2],
          ) || {
            Id: /^sha256:/.test(args[2] || "")
              ? args[2]
              : `sha256:${"c".repeat(64)}`,
            Config: { Volumes: {} },
          },
      ];
    else if (args[0] === "create") {
      if (state.lease) return { status: 1, stdout: "" };
      const labels = Object.fromEntries(
        args.flatMap((arg, index) =>
          arg === "--label" ? [args[index + 1].split("=")] : [],
        ),
      );
      state.lease = {
        Id: "d".repeat(64),
        Name: `/${args[args.indexOf("--name") + 1]}`,
        Image: args.at(-3),
        Config: {
          Image: args.at(-3),
          Labels: labels,
          Entrypoint: ["node"],
          Cmd: ["-e", "process.exit(0)"],
        },
        State: { Running: false },
        HostConfig: {
          NetworkMode: "none",
          ReadonlyRootfs: true,
          Privileged: false,
          PublishAllPorts: false,
          AutoRemove: false,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
        },
        Mounts: [],
      };
      result = state.lease.Id;
    } else if (args[0] === "inspect" && args[1] === state.lease?.Id)
      result = [state.lease];
    else if (args[0] === "rm" && args[1] === state.lease?.Id) {
      state.lease = null;
      result = "";
    } else return { status: 1, stdout: "" };
    return {
      status: 0,
      stdout: typeof result === "string" ? result : JSON.stringify(result),
    };
  };
  return { state, run, calls };
}
export function fakeLocalRelease(daemon, snapshot, { failAt = null } = {}) {
  const calls = [];
  const byService = (name) =>
    structuredClone(
      snapshot.containers.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === name,
      ),
    );
  const run = (bin, args, options) => {
    calls.push([bin, ...args]);
    const ok = (value = "") => ({
      status: 0,
      stdout: typeof value === "string" ? value : JSON.stringify(value),
    });
    if (bin !== "docker")
      return failAt === "signature" && bin === "cosign"
        ? { status: 1, stdout: "" }
        : ok();
    if (args[0] === "compose") {
      if (args.includes("--environment"))
        return ok("TASKDESK_IMAGE_TAG=v2.0.0");
      if (args.includes("config")) return ok(snapshot.config);
      if (args.includes("ps"))
        return ok(
          args.includes("postgres")
            ? "pgid"
            : args.includes("valkey")
              ? "cacheid"
              : args.includes("traefik")
                ? "proxyid"
                : "appid",
        );
      if (args.includes("pull"))
        return failAt === "pull" ? { status: 1, stdout: "" } : ok();
      if (args.includes("run")) return ok("a".repeat(64));
      if (args.includes("up")) {
        if (
          (failAt === "application" && args.includes("taskdesk")) ||
          (failAt === "proxy" && args.includes("traefik"))
        )
          return { status: 1, stdout: "" };
        if (args.includes("taskdesk")) {
          daemon.state.appExists = true;
          daemon.state.appRunning = true;
        }
        return ok();
      }
      if (args.includes("exec"))
        return failAt === "readiness" && args.includes("taskdesk")
          ? { status: 1, stdout: "" }
          : ok();
    }
    if (args[0] === "volume") {
      const name = args.at(-1);
      const key = name.split("_").at(-1);
      return ok([
        {
          Name: name,
          Labels: {
            "com.docker.compose.project": project,
            "com.docker.compose.volume": key,
          },
        },
      ]);
    }
    if (
      args[0] === "inspect" &&
      ["pgid", "cacheid", "proxyid", "appid"].includes(args[1])
    ) {
      const service = {
        pgid: "postgres",
        cacheid: "valkey",
        proxyid: "traefik",
        appid: "taskdesk",
      }[args[1]];
      const value = byService(service);
      if (service === "taskdesk") value.Image = `sha256:${"c".repeat(64)}`;
      return ok([value]);
    }
    if (args[0] === "wait") return ok(failAt === "migration" ? "1" : "0");
    if (args[0] === "rm" && args[1] === "a".repeat(64)) return ok();
    return daemon.run(bin, args, options);
  };
  return { run, calls };
}
export function removeFakeUserLease(active, envFile, daemon = null) {
  const intentFile = join(active, "daemon.json");
  if (!existsSync(intentFile)) return;
  const state = JSON.parse(
    readFileSync(
      existsSync(`${intentFile}.owned`) ? `${intentFile}.owned` : intentFile,
      "utf8",
    ),
  );
  const owner = `${state.ownerPid} ${state.token}\n`;
  if (
    (state.mode !== "host-only" &&
      state.imageId !== `sha256:${"c".repeat(64)}`) ||
    state.identity.daemonId !== "offline-daemon-one" ||
    readFileSync(join(active, "owner"), "utf8") !== owner ||
    readFileSync(`${envFile}.lock/owner`, "utf8") !== owner
  )
    throw new Error(
      "Refusing to clean a lease not proven to be this failed fake-daemon fixture.",
    );
  if (existsSync(`${intentFile}.owned`)) {
    if (!daemon)
      throw new Error(
        "The owning fake daemon is required for fixture cleanup.",
      );
    releaseRecordedDockerDaemonLease({
      stateFile: intentFile,
      token: state.token,
      ownerPid: state.ownerPid,
      run: daemon.run,
      env: { PATH: process.env.PATH },
      hostDirectory: state.host.directory,
    });
  } else unlinkSync(intentFile);
  if (existsSync(state.host.directory))
    borrowHostBootstrapFence(state.host).release();
  unlinkSync(join(active, "owner"));
  rmdirSync(active);
  unlinkSync(`${envFile}.lock/owner`);
  rmdirSync(`${envFile}.lock`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const file = process.argv[2];
  if (!file) throw new Error("Fake daemon state file is required.");
  const state = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { daemonId: "offline-daemon-one", lease: null };
  const daemon = fakeDaemon(state);
  const result = daemon.run("docker", process.argv.slice(3), {
    env: process.env,
  });
  writeFileSync(file, JSON.stringify(state));
  process.stdout.write(result.stdout);
  process.exitCode = result.status;
}
