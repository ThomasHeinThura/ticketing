import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const chart = path.join(root, "charts/taskdesk");
// Use the YAML parser already supplied by the pinned Redocly development tool.
const require = createRequire(path.join(root, "package.json"));
const { parseAllDocuments } = createRequire(
  require.resolve("@redocly/cli/package.json"),
)("yaml");
const bootstrap = [
  "taskdesk.env.authSecret=synthetic-local-chart-test-secret-32-bytes",
  "taskdesk.env.encryptionKey=synthetic-local-chart-encryption-32-bytes",
  "taskdesk.env.database.appPassword=synthetic-application-scan-password",
  "taskdesk.env.clientUrl=https://agent.example.test",
  "taskdesk.env.portalUrl=https://portal.example.test",
].flatMap((value) => ["--set-string", value]);

function render(...overrides) {
  const output = execFileSync(
    "helm",
    [
      "template",
      "taskdesk",
      chart,
      ...bootstrap,
      ...overrides.flatMap((value) => ["--set", value]),
    ],
    { encoding: "utf8" },
  );
  return parseAllDocuments(output)
    .map((document) => {
      assert.deepEqual(document.errors, []);
      return document.toJSON();
    })
    .filter(Boolean);
}
function deployment(resources, name = "taskdesk") {
  const value = resources.find(
    (resource) =>
      resource.kind === "Deployment" && resource.metadata.name === name,
  );
  assert.ok(value, `deployment ${name} must render`);
  return value.spec.template.spec;
}
function mounts(container) {
  return new Map(
    container.volumeMounts.map((mount) => [mount.mountPath, mount]),
  );
}
function volumes(pod) {
  return new Map(pod.volumes.map((volume) => [volume.name, volume]));
}
function env(container) {
  return new Map(container.env.map((value) => [value.name, value]));
}
function assertRestricted(container, uid) {
  assert.equal(container.securityContext.runAsNonRoot, true);
  assert.equal(container.securityContext.runAsUser, uid);
  assert.equal(container.securityContext.runAsGroup, uid);
  assert.equal(container.securityContext.allowPrivilegeEscalation, false);
  assert.equal(container.securityContext.readOnlyRootFilesystem, true);
  assert.deepEqual(container.securityContext.capabilities.drop, ["ALL"]);
}

test("shipping app and migration stay non-root with separate writable temp and owner credential isolation", () => {
  const resources = render();
  const pod = deployment(resources);
  const app = pod.containers[0];
  const migrate = pod.initContainers[0];
  assertRestricted(app, 10001);
  assertRestricted(migrate, 10001);
  assert.equal(pod.securityContext.fsGroup, 10001);
  assert.equal(pod.securityContext.seccompProfile.type, "RuntimeDefault");
  assert.equal(pod.securityContext.fsGroupChangePolicy, "OnRootMismatch");
  assert.notEqual(
    mounts(app).get("/tmp").name,
    mounts(migrate).get("/tmp").name,
  );
  assert.deepEqual(volumes(pod).get(mounts(app).get("/tmp").name).emptyDir, {});
  assert.deepEqual(
    volumes(pod).get(mounts(migrate).get("/tmp").name).emptyDir,
    {},
  );
  assert.equal(mounts(migrate).has("/app/data/attachments"), false);
  assert.equal(env(app).has("TASKDESK_MIGRATION_DATABASE_URL"), false);
  assert.equal(env(migrate).get("TASKDESK_ROLE").value, "migrate");
  assert.ok(env(migrate).has("TASKDESK_MIGRATION_DATABASE_URL"));
  assert.equal(app.livenessProbe.httpGet.path, "/api/public/health/live");
  assert.equal(app.readinessProbe.httpGet.path, "/api/public/health/ready");
  assert.equal(app.ports[0].containerPort, 5173);
});

test("default attachment mount has a persistent claim, and an existing claim is not recreated", () => {
  const resources = render();
  const pod = deployment(resources);
  const mount = mounts(pod.containers[0]).get("/app/data/attachments");
  assert.ok(mount);
  assert.notEqual(mount.readOnly, true);
  assert.equal(
    volumes(pod).get(mount.name).persistentVolumeClaim.claimName,
    "taskdesk-attachments",
  );
  const claim = resources.find(
    (resource) =>
      resource.kind === "PersistentVolumeClaim" &&
      resource.metadata.name === "taskdesk-attachments",
  );
  assert.deepEqual(claim.spec.accessModes, ["ReadWriteOnce"]);
  assert.equal(claim.spec.resources.requests.storage, "8Gi");
  const existing = render(
    "taskdesk.persistence.existingClaim=owned-attachments",
    "taskdesk.persistence.storageClass=-",
  );
  assert.equal(
    existing.some(
      (resource) =>
        resource.kind === "PersistentVolumeClaim" &&
        resource.metadata.name === "taskdesk-attachments",
    ),
    false,
  );
  assert.equal(
    volumes(deployment(existing)).get("taskdesk-attachments")
      .persistentVolumeClaim.claimName,
    "owned-attachments",
  );
});

test("bundled Alpine PostgreSQL keeps its actual uid and writable data, socket and temp paths", () => {
  const pod = deployment(render(), "taskdesk-postgresql");
  const postgres = pod.containers[0];
  assertRestricted(postgres, 70);
  assert.equal(pod.securityContext.fsGroup, 70);
  assert.equal(pod.securityContext.seccompProfile.type, "RuntimeDefault");
  assert.equal(postgres.image, "postgres:16-alpine");
  assert.equal(postgres.ports[0].containerPort, 5432);
  for (const location of [
    "/var/lib/postgresql/data",
    "/var/run/postgresql",
    "/tmp",
  ]) {
    const mount = mounts(postgres).get(location);
    assert.ok(
      mount,
      `${location} must be writable without writing the root filesystem`,
    );
    assert.notEqual(mount.readOnly, true);
    assert.ok(volumes(pod).has(mount.name));
  }
  assert.equal(
    env(postgres).get("PGDATA").value,
    "/var/lib/postgresql/data/pgdata",
  );
  assert.ok(volumes(pod).get("postgresql-data").persistentVolumeClaim);
  assert.deepEqual(volumes(pod).get("postgresql-run").emptyDir, {});
  assert.deepEqual(volumes(pod).get("postgresql-tmp").emptyDir, {});
  assert.ok(postgres.readinessProbe.exec.command.at(-1).includes("pg_isready"));
});

test("explicit ephemeral profiles keep writable paths even with a read-only root", () => {
  const resources = render(
    "taskdesk.persistence.enabled=false",
    "postgresql.persistence.enabled=false",
  );
  assert.equal(
    resources.some((resource) => resource.kind === "PersistentVolumeClaim"),
    false,
  );
  for (const [name, volume] of [
    ["taskdesk", "taskdesk-attachments"],
    ["taskdesk-postgresql", "postgresql-data"],
  ]) {
    const pod = deployment(resources, name);
    assert.deepEqual(volumes(pod).get(volume).emptyDir, {});
    assert.equal(
      pod.containers[0].securityContext.readOnlyRootFilesystem,
      true,
    );
  }
});

test("migration-disabled profile renders no unused migration volume or credentials", () => {
  const pod = deployment(render("migrate.enabled=false"));
  assert.equal(pod.initContainers, undefined);
  assert.equal(volumes(pod).has("migrate-tmp"), false);
  assert.equal(
    env(pod.containers[0]).has("TASKDESK_MIGRATION_DATABASE_URL"),
    false,
  );
});

test("external PostgreSQL profile omits bundled storage while preserving migration isolation", () => {
  const resources = render(
    "postgresql.enabled=false",
    "taskdesk.env.database.external.enabled=true",
    "taskdesk.env.database.external.host=db.example.test",
    "taskdesk.env.database.external.password=synthetic-external-database-password",
    "taskdesk.env.database.external.migration.enabled=true",
    "taskdesk.env.database.external.migration.host=db.example.test",
    "taskdesk.env.database.external.migration.username=owner_role",
    "taskdesk.env.database.external.migration.password=synthetic-owner-database-password",
  );
  assert.equal(
    resources.some(
      (resource) => resource.metadata?.name === "taskdesk-postgresql",
    ),
    false,
  );
  const pod = deployment(resources);
  assert.ok(env(pod.initContainers[0]).has("TASKDESK_MIGRATION_DATABASE_URL"));
  assert.equal(
    env(pod.containers[0]).has("TASKDESK_MIGRATION_DATABASE_URL"),
    false,
  );
  assertRestricted(pod.containers[0], 10001);
});

test("existing-secret profile keeps values as secret references", () => {
  const pod = deployment(
    render(
      "taskdesk.env.existingSecret.enabled=true",
      "taskdesk.env.existingSecret.name=application-auth",
      "taskdesk.env.encryptionKeyExistingSecret.enabled=true",
      "taskdesk.env.encryptionKeyExistingSecret.name=application-encryption",
      "taskdesk.env.database.appExistingSecret.enabled=true",
      "taskdesk.env.database.appExistingSecret.name=application-db",
      "postgresql.auth.existingSecret=owner-db",
    ),
  );
  for (const container of [...pod.initContainers, ...pod.containers]) {
    assert.ok(
      env(container).get("TASKDESK_AUTH_SECRET").valueFrom.secretKeyRef,
    );
    assert.ok(
      env(container).get("TASKDESK_ENCRYPTION_KEY").valueFrom.secretKeyRef,
    );
  }
  assert.equal(
    env(pod.containers[0]).has("TASKDESK_MIGRATION_DATABASE_URL"),
    false,
  );
});

test("shared-storage HPA and explicit image identities remain configurable", () => {
  const resources = render(
    "autoscaling.enabled=true",
    "taskdesk.resources.requests.cpu=100m",
    "taskdesk.persistence.accessMode=ReadWriteMany",
    "taskdesk.securityContext.runAsUser=12001",
    "taskdesk.securityContext.runAsGroup=12001",
    "podSecurityContext.fsGroup=12001",
    "postgresql.securityContext.runAsUser=999",
    "postgresql.securityContext.runAsGroup=999",
    "postgresql.podSecurityContext.fsGroup=999",
  );
  assert.ok(
    resources.some((resource) => resource.kind === "HorizontalPodAutoscaler"),
  );
  const app = deployment(resources);
  assertRestricted(app.containers[0], 12001);
  assert.equal(app.securityContext.fsGroup, 12001);
  assertRestricted(
    deployment(resources, "taskdesk-postgresql").containers[0],
    999,
  );
  const claim = resources.find(
    (resource) =>
      resource.kind === "PersistentVolumeClaim" &&
      resource.metadata.name === "taskdesk-attachments",
  );
  assert.deepEqual(claim.spec.accessModes, ["ReadWriteMany"]);
});

test("attachment claim names remain valid for long release names", () => {
  const resources = render(`fullnameOverride=${"x".repeat(63)}`);
  const app = deployment(resources, "x".repeat(63));
  const name = volumes(app).get("taskdesk-attachments").persistentVolumeClaim
    .claimName;
  assert.ok(name.length <= 63);
  assert.ok(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name));
  assert.ok(
    resources.some(
      (resource) =>
        resource.kind === "PersistentVolumeClaim" &&
        resource.metadata.name === name,
    ),
  );
});

test("single-writer attachments recreate on upgrade and reject incompatible multiple pods", () => {
  const resource = render().find(
    (resource) =>
      resource.kind === "Deployment" && resource.metadata.name === "taskdesk",
  );
  assert.equal(resource.spec.strategy.type, "Recreate");
  assert.throws(
    () => render("replicaCount=2"),
    /Multiple TaskDesk pods require/,
  );
  assert.throws(
    () =>
      render(
        "autoscaling.enabled=true",
        "taskdesk.resources.requests.cpu=100m",
      ),
    /Multiple TaskDesk pods require/,
  );
  const shared = render(
    "replicaCount=2",
    "taskdesk.persistence.accessMode=ReadWriteMany",
  ).find(
    (resource) =>
      resource.kind === "Deployment" && resource.metadata.name === "taskdesk",
  );
  assert.equal(shared.spec.strategy, undefined);
});
