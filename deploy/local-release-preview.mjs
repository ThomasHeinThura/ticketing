// Trace the real release helper against a synthetic, fresh Compose state. No subprocess
// is executed. IDs and the proof marker are replaced when displaying the trace.
import { deployLocalLocked } from "./local-release.mjs";

const pg = "1".repeat(64);
const cache = "2".repeat(64);
const proof = "3".repeat(64);
const migration = "4".repeat(64);
const app = "5".repeat(64);
const imageId = `sha256:${"6".repeat(64)}`;
const project = "taskdesk-codex-testing";

export function previewLocalRelease({
  env,
  config,
  image,
  tag,
  contextName = "default",
}) {
  const commands = [];
  let createArgs = [];
  let running = false;
  const result = (value = "") => ({ status: 0, stdout: value });
  const json = (value) => result(JSON.stringify(value));
  const run = (bin, args) => {
    commands.push([bin, ...args]);
    if (bin !== "docker") return result();
    if (args[0] === "context")
      return args[1] === "show"
        ? result(contextName)
        : json([
            { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
          ]);
    if (args[0] === "compose") {
      if (args.includes("--environment"))
        return result(`TASKDESK_IMAGE_TAG=${tag}`);
      if (args.includes("config")) return json(config);
      if (args.includes("ps") && args.includes("postgres")) return result(pg);
      if (args.includes("ps") && args.includes("valkey")) return result(cache);
      if (args.includes("ps") && args.includes("traefik")) return result();
      if (args.includes("ps") && args.includes("taskdesk")) return result(app);
      if (args.includes("run")) return result(migration);
      return result();
    }
    if (args[0] === "volume" && args[1] === "inspect") {
      const name = args[2];
      return json([
        {
          Name: name,
          Labels: {
            "com.docker.compose.project": project,
            "com.docker.compose.volume": name.slice(project.length + 1),
          },
        },
      ]);
    }
    if (args[0] === "image")
      return json([{ Id: imageId, Config: { Env: [], Volumes: null } }]);
    if (args[0] === "ps") return result();
    if (args[0] === "create") {
      createArgs = args;
      return result(proof);
    }
    if (args[0] === "start") {
      running = true;
      return result();
    }
    if (args[0] === "wait") return result("0");
    if (args[0] === "inspect" && args[1] === pg)
      return json([
        {
          Config: { Labels: { "com.docker.compose.project": project } },
          State: { Health: { Status: "healthy" } },
          Mounts: [
            {
              Name: `${project}_postgres-data`,
              Destination: "/var/lib/postgresql",
            },
          ],
        },
      ]);
    if (args[0] === "inspect" && args[1] === cache)
      return json([
        {
          Config: { Labels: { "com.docker.compose.project": project } },
          State: { Health: { Status: "healthy" } },
        },
      ]);
    if (args[0] === "inspect" && args[1] === proof) {
      const bindings = {};
      for (let i = 0; i < createArgs.length; i++)
        if (createArgs[i] === "--publish") {
          const match = createArgs[i + 1].match(
            /^(\[::1\]|127\.0\.0\.1):(\d+):(\d+)\/tcp$/,
          );
          const key = `${match[3]}/tcp`;
          bindings[key] ??= [];
          bindings[key].push({
            HostIp: match[1].replace(/[[\]]/g, ""),
            HostPort: match[2],
          });
        }
      const label = createArgs[createArgs.indexOf("--label") + 1].split("=");
      return json([
        {
          Id: proof,
          Name: `/${createArgs[createArgs.indexOf("--name") + 1]}`,
          Config: {
            Labels: { [label[0]]: label[1] },
            Image: image,
            Healthcheck: { Test: ["NONE"] },
            Entrypoint: ["node"],
            Cmd: [
              "-e",
              "setInterval(() => {}, 60000); setTimeout(() => process.exit(0), 60000)",
            ],
            Env: [],
          },
          Image: imageId,
          HostConfig: {
            NetworkMode: "bridge",
            ReadonlyRootfs: true,
            Privileged: false,
            AutoRemove: false,
            SecurityOpt: ["no-new-privileges:true"],
            PublishAllPorts: false,
            CapDrop: ["ALL"],
            PortBindings: bindings,
          },
          Mounts: [],
          State: { Running: running },
          NetworkSettings: {
            Networks: running ? { bridge: {} } : {},
            Ports: running ? bindings : {},
          },
        },
      ]);
    }
    if (args[0] === "inspect" && args[1] === app)
      return json([
        {
          Id: app,
          Config: {
            Image: image,
            Labels: { "com.docker.compose.project": project },
          },
          Image: imageId,
          HostConfig: {},
          NetworkSettings: { Ports: {} },
          Mounts: [
            {
              Type: "volume",
              Name: `${project}_attachments`,
              Destination: "/app/data/attachments",
            },
          ],
        },
      ]);
    return result();
  };
  deployLocalLocked({ args: [], env, run, report: () => {} });
  const marker = commands
    .find((c) => c[1] === "create")
    ?.find((v) => v.startsWith("info.taskdesk.local-port-proof="))
    ?.split("=")[1];
  return commands.map((c) =>
    c.map((v) =>
      String(v)
        .replaceAll(pg, "<new-postgres-id>")
        .replaceAll(cache, "<new-valkey-id>")
        .replaceAll(proof, "<new-port-proof-id>")
        .replaceAll(migration, "<new-release-migration-id>")
        .replaceAll(app, "<new-application-id>")
        .replaceAll(marker || "\0", "<random-marker>"),
    ),
  );
}
