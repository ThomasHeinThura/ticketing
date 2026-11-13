// Pure ownership checks for a future fresh-install executor. No Docker calls.
export const PROJECT = "taskdesk-codex-testing";
const volumeKeys = new Set(["postgres-data", "attachments", "mailpit-data"]);

export function planRemoval({ confirmation, containers, volumes, config }) {
  if (confirmation !== PROJECT)
    throw new Error(`Confirm wipe with ${PROJECT}.`);
  if (config?.name !== PROJECT) throw new Error("Unexpected Compose project.");
  for (const service of Object.values(config.services || {})) {
    if (
      service.network_mode === "host" ||
      service.ports?.some((p) => String(p.published) === "62870")
    ) {
      throw new Error("Protected native database port may be touched.");
    }
  }
  const ids = containers.map((container) => {
    if (
      !/^[a-f0-9]{64}$/.test(container.Id || "") ||
      container.Config?.Labels?.["com.docker.compose.project"] !== PROJECT ||
      container.HostConfig?.NetworkMode === "host" ||
      container.HostConfig?.PublishAllPorts ||
      Object.values(container.NetworkSettings?.Ports || {})
        .flat()
        .some((p) => p?.HostPort === "62870") ||
      Object.values(container.HostConfig?.PortBindings || {})
        .flat()
        .some((p) => p?.HostPort === "62870")
    ) {
      throw new Error("Unsafe container ownership or port binding.");
    }
    return container.Id;
  });
  const names = volumes.map((volume) => {
    const key = volume.Labels?.["com.docker.compose.volume"];
    if (
      !volumeKeys.has(key) ||
      volume.Name !== `${PROJECT}_${key}` ||
      volume.Labels?.["com.docker.compose.project"] !== PROJECT
    ) {
      throw new Error("Unsafe volume ownership.");
    }
    return volume.Name;
  });
  if (new Set(ids).size !== ids.length || new Set(names).size !== names.length)
    throw new Error("Duplicate resource.");
  return { containers: ids, volumes: names };
}

export function buildFreshPlan(facts) {
  const selected = planRemoval(facts);
  return [
    { phase: "verify" },
    { phase: "backup" },
    { phase: "reinspect" },
    ...selected.containers.map((id) => ({ phase: "remove-container", id })),
    ...selected.volumes.map((name) => ({ phase: "remove-volume", name })),
    { phase: "start-dependencies" },
    { phase: "migrate" },
    { phase: "start-app-and-proxy" },
    { phase: "seed" },
    { phase: "readiness" },
    { phase: "smoke" },
  ];
}
