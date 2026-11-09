import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase } from "../../../tests/api-integration/helpers/database";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../src/auth";
import db, { getDatabasePool, schema } from "../src/database";
import { createApp } from "../src/index";
import { DEMO_ACCOUNTS } from "./seed-demo-data";

const execute = promisify(execFile);
const app = createApp().app;
type Account = { email: string; password: string; side: "staff" | "customer" };
const sessions = new Map<string, { origin: string; cookie: string }>();
let directory = "";

function request(key: string, route: string, init: RequestInit = {}) {
  const session = sessions.get(key);
  if (!session) throw new Error(`Missing session for ${key}`);
  return app.request(`${session.origin}${route}`, {
    ...init,
    headers: {
      host: new URL(session.origin).host,
      cookie: session.cookie,
      ...init.headers,
    },
  });
}

describe("demo seed real authentication and reach", () => {
  beforeAll(async () => {
    await resetTestDatabase({ defaultOffFeatures: false });
    // Synthetic completed bootstrap baseline; this suite exercises demo account sign-in.
    await db.insert(schema.organisationTable).values({
      id: "bootstrap-org",
      key: "internal",
      name: "Internal",
      isInternal: true,
    });
    await db.insert(schema.userTable).values({
      id: "bootstrap-admin",
      name: "Bootstrap admin",
      email: "bootstrap@example.test",
      emailVerified: true,
      role: "admin",
      twoFactorEnabled: true,
    });
    await db.insert(schema.personTable).values({
      id: "bootstrap-person",
      userId: "bootstrap-admin",
      organisationId: "bootstrap-org",
      side: "staff",
      displayName: "Bootstrap admin",
    });
    await db.insert(schema.twoFactorTable).values({
      id: "bootstrap-factor",
      userId: "bootstrap-admin",
      secret: "test-encrypted-secret",
      backupCodes: "test-encrypted-codes",
      verified: true,
    });
    await db
      .insert(schema.instanceSettingTable)
      .values({ id: "singleton", setupCompletedAt: new Date() });
    directory = await mkdtemp(path.join(os.tmpdir(), "taskdesk-demo-auth-"));
    const credentials = path.join(directory, "credentials.json");
    await execute(
      "pnpm",
      [
        "exec",
        "tsx",
        "scripts/seed-demo.mjs",
        "--demo",
        "--enable-customer-password",
        "--credentials-file",
        credentials,
      ],
      { cwd: path.resolve(import.meta.dirname, ".."), timeout: 180_000 },
    );
    await reloadAuthConfiguration();
    const parsed = JSON.parse(await readFile(credentials, "utf8")) as {
      accounts: Account[];
    };
    expect(parsed.accounts).toHaveLength(11);
    for (const [index, account] of parsed.accounts.entries()) {
      const origin =
        account.side === "staff"
          ? getConfiguredAgentOrigin()
          : getConfiguredCustomerOrigin();
      const response = await app.request(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          host: new URL(origin).host,
          origin,
          "content-type": "application/json",
          "x-forwarded-for": `10.20.0.${index + 1}`,
        },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
        }),
      });
      expect(response.status, `sign-in persona ${index}`).toBe(200);
      const prefix =
        account.side === "staff"
          ? "__Host-tdk_agent_session="
          : "__Host-tdk_portal_session=";
      const cookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith(prefix))
        ?.split(";", 1)[0];
      expect(Boolean(cookie), `session persona ${index}`).toBe(true);
      const persona = DEMO_ACCOUNTS.find((row) => row.email === account.email);
      expect(Boolean(persona), `known persona ${index}`).toBe(true);
      const key = persona?.key ?? "unknown";
      expect(sessions.has(key)).toBe(false);
      sessions.set(key, { origin, cookie: cookie as string });
      const session = await request(key, "/api/auth/get-session");
      expect(session.status, `session persona ${index}`).toBe(200);
      const body = (await session.json()) as {
        user?: { email?: string };
      } | null;
      expect(
        body?.user?.email === account.email,
        `session identity persona ${index}`,
      ).toBe(true);
    }
  }, 180_000);

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    await getDatabasePool().end();
  });

  it("enables customer password sign-in", async () => {
    const origin = getConfiguredCustomerOrigin();
    const response = await app.request(`${origin}/api/portal/auth-methods`, {
      headers: { host: new URL(origin).host },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ password: true });
  });

  it("limits portal project collections and details to the customer's organisation", async () => {
    for (const [key, allowed, denied] of [
      ["contoso1", ["CSD", "MIG"], "FAB"],
      ["contoso2", ["CSD", "MIG"], "FAB"],
      ["fabrikam1", ["FAB"], "MIG"],
    ] as const) {
      const list = await request(key, "/api/portal/projects");
      expect(list.status).toBe(200);
      const body = (await list.json()) as { data: { key: string }[] };
      expect(body.data.map((row) => row.key).sort()).toEqual(
        [...allowed].sort(),
      );
      for (const project of allowed)
        expect(
          (await request(key, `/api/portal/projects/${project}`)).status,
        ).toBe(200);
      expect(
        (await request(key, `/api/portal/projects/${denied}`)).status,
      ).toBe(404);
      expect((await request(key, "/api/workspaces")).status).toBe(404);
    }
  });

  it("enforces selective staff reach and manager and viewer permissions", async () => {
    for (const [key, canSeeMigration] of [
      ["agent1", false],
      ["agent2", true],
    ] as const) {
      const list = await request(key, "/api/project?workspaceId=demo-ws");
      expect(list.status, await list.clone().text()).toBe(200);
      const projects = (await list.json()) as { id: string }[];
      expect(
        projects.some((project) => project.id === "demo-proj-contoso-m365"),
      ).toBe(canSeeMigration);
      expect(
        projects.some((project) => project.id === "demo-proj-contoso-desk"),
      ).toBe(true);
    }
    expect(
      (await request("agent2", "/api/project/demo-proj-contoso-m365/overview"))
        .status,
    ).toBe(200);
    expect([403, 404]).toContain(
      (await request("agent1", "/api/project/demo-proj-contoso-m365/overview"))
        .status,
    );
    const manager = await request(
      "manager",
      "/api/capabilities?workspaceId=demo-ws&projectId=demo-proj-contoso-desk",
    );
    expect(manager.status).toBe(200);
    expect(await manager.json()).toMatchObject({ manageProjectSettings: true });
    const viewer = await request(
      "viewer",
      "/api/capabilities?workspaceId=demo-ws&projectId=demo-proj-contoso-desk",
    );
    expect(viewer.status).toBe(200);
    expect(await viewer.json()).toMatchObject({ manageProjectSettings: false });
    const viewerSession = sessions.get("viewer");
    if (!viewerSession) throw new Error("Missing viewer session");
    const csrf = await request("viewer", "/api/me/csrf-token", {
      headers: { origin: viewerSession.origin },
    });
    expect(csrf.status).toBe(200);
    const { token } = (await csrf.json()) as { token: string };
    const csrfCookie = csrf.headers
      .getSetCookie()
      .find((value) => value.startsWith("tdk_csrf_dev="))
      ?.split(";", 1)[0];
    expect(Boolean(csrfCookie)).toBe(true);
    if (!csrfCookie) throw new Error("Missing CSRF cookie");
    const write = await request(
      "viewer",
      "/api/project/demo-proj-contoso-desk/summary",
      {
        method: "PATCH",
        headers: {
          cookie: `${viewerSession.cookie}; ${csrfCookie}`,
          origin: viewerSession.origin,
          "content-type": "application/json",
          "x-taskdesk-csrf": token,
        },
        body: JSON.stringify({ status: "closed" }),
      },
    );
    expect(write.status).toBe(403);
  });
});
