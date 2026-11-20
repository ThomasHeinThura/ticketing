import { describe, expect, it } from "vitest";
import {
  assertMembershipDatabaseBinding,
  withMembershipDatabase,
} from "../../apps/web/e2e/settings-history-membership-fixture";
import { invokeMfaCsrfAppFixtureCallback } from "../e2e/helpers/mfa-csrf-app-fixture";

const name = "mfa_csrf_0123456789abcdef0123456789abcdef_test";
const binding = Object.freeze({
  containerId: "a".repeat(64),
  host: "127.0.0.1",
  port: 49152,
  databaseName: name,
});
const databaseUrl = `postgresql://taskdesk_e2e_app:secret@127.0.0.1:49152/${name}`;

describe("membership fixture database binding", () => {
  it("hands the same inspected binding to the journey callback", async () => {
    const received = await invokeMfaCsrfAppFixtureCallback(
      async (fixture) => fixture,
      {
        databaseBinding: binding,
        databaseUrl,
        fixtureDir: "/synthetic-fixture",
        origin: "http://localhost:49153",
        spawnChild: async () => {
          throw new Error("offline callback must not spawn");
        },
      },
      {
        email: "synthetic@example.test",
        password: "synthetic-password",
        setupUrl: new URL("http://localhost:49153/auth/sign-up"),
        setupToken: "synthetic-token",
      },
    );
    expect(received.databaseBinding).toBe(binding);
    expect(Object.isFrozen(received.databaseBinding)).toBe(true);
    expect(received.databaseUrl).toBe(databaseUrl);
  });

  it("never starts a connection without the binding", async () => {
    await expect(
      withMembershipDatabase({ databaseUrl }, async () => {
        throw new Error("opened");
      }),
    ).rejects.toThrow("inspected disposable");
  });

  it("accepts only the frozen inspected disposable application binding", () => {
    expect(() =>
      assertMembershipDatabaseBinding({
        databaseBinding: binding,
        databaseUrl,
      }),
    ).not.toThrow();
    for (const bad of [
      databaseUrl.replace("49152", "62870"),
      databaseUrl.replace("127.0.0.1", "example.com"),
      databaseUrl.replace(name, "taskdesk_browser_journey_1022_test"),
      databaseUrl.replace("taskdesk_e2e_app", "postgres"),
      `${databaseUrl}?x=1`,
      `${databaseUrl}#fragment`,
    ])
      expect(() =>
        assertMembershipDatabaseBinding({
          databaseBinding: binding,
          databaseUrl: bad,
        }),
      ).toThrow();
    expect(() => assertMembershipDatabaseBinding({ databaseUrl })).toThrow();
    expect(() =>
      assertMembershipDatabaseBinding({
        databaseBinding: { ...binding },
        databaseUrl,
      }),
    ).toThrow();
    expect(() =>
      assertMembershipDatabaseBinding({
        databaseBinding: Object.freeze({ ...binding, port: 62870 }),
        databaseUrl,
      }),
    ).toThrow();
  });
});
