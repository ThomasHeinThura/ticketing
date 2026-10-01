import { randomUUID } from "node:crypto";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  GenericContainer,
  Network,
  type StartedTestContainer,
  Wait,
} from "../../apps/api/node_modules/testcontainers";

const POSTGRES_IMAGE = "postgres:18-alpine";
const PGBOUNCER_IMAGE =
  "pgbouncer/pgbouncer@sha256:c0c55b277858ca308eb5df7baf8b83fbaea60b2c666604f29d8fe25e9decac68";
const PROBE_ROLE = "taskdesk_rls_probe";

class LoopbackPostgreSqlContainer extends PostgreSqlContainer {
  protected override async beforeContainerCreated(): Promise<void> {
    this.hostConfig.PortBindings = {
      ...this.hostConfig.PortBindings,
      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
    };
  }
}

class LoopbackPgBouncerContainer extends GenericContainer {
  protected override async beforeContainerCreated(): Promise<void> {
    this.hostConfig.PortBindings = {
      ...this.hostConfig.PortBindings,
      "6432/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
    };
  }
}

export default async function setup() {
  const runId = randomUUID().replaceAll("-", "");
  const databaseName = `taskdesk_rls_${runId.slice(0, 16)}`;
  const postgresPassword = `tdp0-owner-${runId}`;
  const probePassword = `tdp0-probe-${runId}`;
  const baselinePassword = `tdp0-base-${runId}`;
  const network = await new Network().start();
  let postgres: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;
  let pgbouncer: StartedTestContainer | undefined;

  const cleanup = async () => {
    const errors: unknown[] = [];
    for (const container of [pgbouncer, postgres]) {
      if (!container) continue;
      try {
        await container.stop({
          timeout: 10_000,
          remove: true,
          removeVolumes: true,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await network.stop();
    } catch (error) {
      errors.push(error);
    }
    delete process.env.RLS_PROTOTYPE_DATABASE_URL;
    delete process.env.RLS_PROTOTYPE_PGBOUNCER_URL;
    delete process.env.RLS_PROTOTYPE_PROBE_PASSWORD;
    delete process.env.RLS_PROTOTYPE_BASELINE_PASSWORD;
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "RLS prototype Testcontainers cleanup failed",
      );
    }
  };

  try {
    postgres = await new LoopbackPostgreSqlContainer(POSTGRES_IMAGE)
      .withName(`taskdesk-p0-rls-pg-${runId.slice(0, 16)}`)
      .withLabels({
        "taskdesk.purpose": "p0-rls-prototype",
        "taskdesk.run": runId,
      })
      .withNetwork(network)
      .withNetworkAliases(`taskdesk-p0-rls-pg-${runId.slice(0, 16)}`)
      .withDatabase(databaseName)
      .withUsername("postgres")
      .withPassword(postgresPassword)
      .start();

    const pgbouncerDatabase =
      `probe = host=taskdesk-p0-rls-pg-${runId.slice(0, 16)} ` +
      `port=5432 dbname=${databaseName} user=${PROBE_ROLE} ` +
      `password=${probePassword} pool_size=1 pool_mode=transaction`;
    pgbouncer = await new LoopbackPgBouncerContainer(PGBOUNCER_IMAGE)
      .withName(`taskdesk-p0-rls-pgb-${runId.slice(0, 16)}`)
      .withLabels({
        "taskdesk.purpose": "p0-rls-prototype",
        "taskdesk.run": runId,
      })
      .withNetwork(network)
      .withNetworkAliases(`taskdesk-p0-rls-pgb-${runId.slice(0, 16)}`)
      .withEnvironment({
        QUIET: "1",
        DATABASES: pgbouncerDatabase,
        PGBOUNCER_AUTH_TYPE: "any",
        PGBOUNCER_POOL_MODE: "transaction",
        PGBOUNCER_DEFAULT_POOL_SIZE: "1",
        PGBOUNCER_MAX_CLIENT_CONN: "20",
        PGBOUNCER_LISTEN_PORT: "6432",
      })
      .withExposedPorts(6432)
      .withWaitStrategy(Wait.forListeningPorts())
      .withStartupTimeout(120_000)
      .start();

    const networkId = network.getId();
    if (
      postgres.getNetworkId(network.getName()) !== networkId ||
      pgbouncer.getNetworkId(network.getName()) !== networkId ||
      !postgres.getNetworkNames().includes(network.getName()) ||
      !pgbouncer.getNetworkNames().includes(network.getName())
    ) {
      throw new Error(
        "RLS prototype containers are not attached to their unique network",
      );
    }
    const loopbackHosts = new Set(["127.0.0.1", "localhost"]);
    if (
      postgres.getMappedPort(5432) < 1 ||
      pgbouncer.getMappedPort(6432) < 1 ||
      !loopbackHosts.has(postgres.getHost()) ||
      !loopbackHosts.has(pgbouncer.getHost())
    ) {
      throw new Error(
        "RLS prototype host mappings are not random loopback-only ports",
      );
    }

    const pgbouncerUrl = new URL(postgres.getConnectionUri());
    pgbouncerUrl.hostname = pgbouncer.getHost();
    pgbouncerUrl.port = String(pgbouncer.getMappedPort(6432));
    pgbouncerUrl.username = PROBE_ROLE;
    pgbouncerUrl.password = probePassword;
    pgbouncerUrl.pathname = "/probe";

    const postgresUrl = new URL(postgres.getConnectionUri());
    postgresUrl.hostname = "127.0.0.1";
    process.env.RLS_PROTOTYPE_DATABASE_URL = postgresUrl.toString();
    process.env.RLS_PROTOTYPE_PGBOUNCER_URL = pgbouncerUrl.toString();
    process.env.RLS_PROTOTYPE_PROBE_PASSWORD = probePassword;
    process.env.RLS_PROTOTYPE_BASELINE_PASSWORD = baselinePassword;

    return cleanup;
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "RLS prototype startup and cleanup both failed",
      );
    }
    throw error;
  }
}
