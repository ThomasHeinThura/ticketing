import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupDisposableContainers,
  disposableChildEnv,
  isDisposableDatabaseUrl,
  isDisposableLoopbackBinding,
} from "../e2e/helpers/mfa-csrf-app-fixture";

const name = `mfa_csrf_${"a".repeat(32)}_test`;
const uri = `postgres://postgres:password@127.0.0.1:49152/${name}`;

describe("disposable database safety", () => {
  it("accepts only the exact generated database and inspected loopback endpoint", () => {
    expect(isDisposableDatabaseUrl(uri, "127.0.0.1", 49152, name)).toBe(true);
    for (const bad of [
      uri.replace("49152", "62870"),
      uri.replace("127.0.0.1", "localhost"),
      uri.replace(name, "taskdesk_browser_journey_1022_test"),
      `${uri}?host=other`,
      uri.replace("postgres:", "http:"),
    ])
      expect(isDisposableDatabaseUrl(bad, "127.0.0.1", 49152, name)).toBe(
        false,
      );
    expect(isDisposableDatabaseUrl(uri, "127.0.0.1", 62870, name)).toBe(false);
    expect(isDisposableDatabaseUrl(uri, "127.0.0.1", 49152, "other_test")).toBe(
      false,
    );
  });

  it("accepts the application role only when explicitly requested on the verified binding", () => {
    const app = uri.replace("postgres:password@", "taskdesk_e2e_app:password@");
    expect(isDisposableDatabaseUrl(app, "127.0.0.1", 49152, name)).toBe(false);
    expect(
      isDisposableDatabaseUrl(
        app,
        "127.0.0.1",
        49152,
        name,
        "taskdesk_e2e_app",
      ),
    ).toBe(true);
    for (const bad of [
      app.replace("49152", "62870"),
      app.replace("127.0.0.1", "example.com"),
      `${app}?x=1`,
      `${app}#x`,
      app.replace(name, "taskdesk_browser_journey_1022_test"),
      app.replace("taskdesk_e2e_app", "other"),
    ])
      expect(
        isDisposableDatabaseUrl(
          bad,
          "127.0.0.1",
          49152,
          name,
          "taskdesk_e2e_app",
        ),
      ).toBe(false);
  });

  it("requires one dynamically requested and assigned loopback binding", () => {
    const requested = [{ HostIp: "127.0.0.1", HostPort: "0" }];
    const active = [{ HostIp: "127.0.0.1", HostPort: "49152" }];
    expect(
      isDisposableLoopbackBinding(requested, active, 49152, "127.0.0.1"),
    ).toBe(true);
    expect(
      isDisposableLoopbackBinding(
        [{ HostIp: "127.0.0.1", HostPort: "49152" }],
        active,
        49152,
        "127.0.0.1",
      ),
    ).toBe(false);
    expect(
      isDisposableLoopbackBinding(
        requested,
        [...active, ...active],
        49152,
        "127.0.0.1",
      ),
    ).toBe(false);
    expect(
      isDisposableLoopbackBinding(
        requested,
        [{ HostIp: "0.0.0.0", HostPort: "49152" }],
        49152,
        "127.0.0.1",
      ),
    ).toBe(false);
    expect(
      isDisposableLoopbackBinding(
        requested,
        [{ HostIp: "127.0.0.1", HostPort: "62870" }],
        62870,
        "127.0.0.1",
      ),
    ).toBe(false);
  });
});

describe("disposable child and teardown safety", () => {
  it("keeps dotenv-mono from walking up to parent env files", async () => {
    const root = await mkdtemp(join(tmpdir(), "fixture-dotenv-test-"));
    try {
      const child = join(root, "child");
      await mkdir(child);
      await writeFile(join(root, ".env"), "FIXTURE_SENTINEL=external\n");
      await writeFile(
        join(root, ".env.defaults"),
        "FIXTURE_DEFAULT_SENTINEL=external\n",
      );
      await writeFile(join(child, ".env"), "");
      await writeFile(join(child, ".env.defaults"), "");
      const requireApi = createRequire(resolve(process.cwd(), "package.json"));
      const { Dotenv } = requireApi(
        "dotenv-mono",
      ) as typeof import("dotenv-mono");
      const result = new Dotenv({ cwd: child }).load(false);
      expect(result.env).not.toHaveProperty("FIXTURE_SENTINEL");
      expect(result.env).not.toHaveProperty("FIXTURE_DEFAULT_SENTINEL");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("drops inherited integrations and database aliases", () => {
    expect(
      disposableChildEnv({
        PATH: "/bin",
        TASKDESK_DATABASE_URL: "fixture",
        SMTP_HOST: "external",
        DATABASE_URL: "external",
        NODE_OPTIONS: "--require=evil",
      }),
    ).toEqual({ PATH: "/bin", TASKDESK_DATABASE_URL: "fixture" });
  });

  it("attempts exact-ID removal and final verification after stop failure", async () => {
    let present = true;
    let removed = "";
    let listings = 0;
    const docker = {
      listContainers: async () => {
        listings++;
        return present
          ? [{ Id: "owned", Labels: { "taskdesk.disposable-fixture": "run" } }]
          : [];
      },
      getContainer: (id: string) => ({
        inspect: async () => ({}),
        remove: async () => {
          removed = id;
          present = false;
        },
      }),
    };
    await expect(
      cleanupDisposableContainers(
        docker,
        "run",
        "owned",
        async () => {
          throw new Error("stop failed");
        },
        async () => {},
      ),
    ).rejects.toThrow();
    expect(removed).toBe("owned");
    expect(listings).toBeGreaterThanOrEqual(2);
    expect(present).toBe(false);
  });

  it("journals only newly discovered IDs and removes both known and discovered containers", async () => {
    const present = new Set(["owned", "discovered"]);
    const recorded: string[] = [];
    const removed: string[] = [];
    const docker = {
      listContainers: async () =>
        [...present].map((Id) => ({
          Id,
          Labels: { "taskdesk.disposable-fixture": "run" },
        })),
      getContainer: (id: string) => ({
        inspect: async () => ({}),
        remove: async () => {
          removed.push(id);
          present.delete(id);
        },
      }),
    };
    await cleanupDisposableContainers(
      docker,
      "run",
      "owned",
      undefined,
      async (id) => {
        recorded.push(id);
      },
    );
    expect(recorded).toEqual(["discovered"]);
    expect(removed).toEqual(["owned", "discovered"]);
    expect(present.size).toBe(0);
  });

  it("fails closed when removal leaves the container present", async () => {
    let listings = 0;
    const docker = {
      listContainers: async () => {
        listings++;
        return [
          { Id: "owned", Labels: { "taskdesk.disposable-fixture": "run" } },
        ];
      },
      getContainer: () => ({
        inspect: async () => ({}),
        remove: async () => {
          throw new Error("remove failed");
        },
      }),
    };
    await expect(
      cleanupDisposableContainers(
        docker,
        "run",
        "owned",
        undefined,
        async () => {},
      ),
    ).rejects.toThrow();
    expect(listings).toBeGreaterThanOrEqual(2);
  });
});
