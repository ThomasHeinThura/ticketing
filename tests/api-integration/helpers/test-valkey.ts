import Redis from "../../../apps/api/node_modules/ioredis";
import {
  GenericContainer,
  Wait,
} from "../../../apps/api/node_modules/testcontainers";

export const TEST_VALKEY_ALIAS = "taskdesk-test-valkey";
export const TEST_VALKEY_PORT = 6379;

export type TestValkeyServer = {
  url: string;
  stop: () => Promise<void>;
};

class LoopbackValkeyContainer extends GenericContainer {
  protected override async beforeContainerCreated(): Promise<void> {
    this.hostConfig.PortBindings = {
      ...this.hostConfig.PortBindings,
      "6379/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
    };
  }
}

/** Validate only the dedicated authenticated endpoint provided by the isolated Linux runner. */
export function validateTestValkeyUrl(
  value: string,
  nodeEnvironment = process.env.NODE_ENV,
): string {
  if (nodeEnvironment !== "test")
    throw new Error("TASKDESK_TEST_VALKEY_URL is allowed only in tests");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TASKDESK_TEST_VALKEY_URL is invalid");
  }

  if (
    url.protocol !== "redis:" ||
    url.hostname.toLowerCase() !== TEST_VALKEY_ALIAS ||
    url.port !== String(TEST_VALKEY_PORT) ||
    !["/", "/0"].includes(url.pathname) ||
    url.search ||
    url.hash ||
    (url.username !== "" && url.username !== "default") ||
    !url.password
  ) {
    throw new Error(
      "TASKDESK_TEST_VALKEY_URL must target the isolated test Valkey",
    );
  }

  return url.toString();
}

async function assertExternalValkeyReachable(url: string): Promise<void> {
  const client = new Redis(url, {
    connectTimeout: 3_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await client.ping();
  } catch {
    throw new Error(
      "The isolated test Valkey endpoint is unreachable or rejected authentication",
    );
  } finally {
    client.disconnect();
  }
}

/**
 * Use the runner-owned authenticated service when present; otherwise retain the
 * existing local Testcontainers fallback and its loopback-only published port.
 */
export async function startTestValkey(): Promise<TestValkeyServer> {
  const configuredUrl = process.env.TASKDESK_TEST_VALKEY_URL;
  if (configuredUrl) {
    const url = validateTestValkeyUrl(configuredUrl);
    await assertExternalValkeyReachable(url);
    return { url, stop: async () => undefined };
  }

  const container = await new LoopbackValkeyContainer("valkey/valkey:9-alpine")
    .withExposedPorts(TEST_VALKEY_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(TEST_VALKEY_PORT)}`;

  return {
    url,
    stop: async () => {
      await container.stop({
        timeout: 5_000,
        remove: true,
        removeVolumes: true,
      });
    },
  };
}
