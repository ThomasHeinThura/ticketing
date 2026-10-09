import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";

type Operation = {
  operationId?: string;
  summary?: string;
  responses: Record<string, unknown>;
  security?: unknown[];
};
type Spec = {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  paths: Record<
    string,
    Record<string, Operation> & { servers?: Array<{ url: string }> }
  >;
  security?: Array<Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, { type: string; scheme?: string }>;
  };
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function operations(spec: Spec): Array<[string, string, Operation]> {
  const out: Array<[string, string, Operation]> = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (HTTP_METHODS.includes(method))
        out.push([method, path, operation as Operation]);
    }
  }
  return out;
}

let spec: Spec;

beforeAll(async () => {
  const { app } = createApp();
  const response = await app.request("/api/openapi");
  expect(response.status).toBe(200);
  spec = (await response.json()) as Spec;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TaskDesk API OpenAPI spec", () => {
  it("serves the document on the configured agent host only", async () => {
    const configuredAgentUrl = process.env.TASKDESK_AGENT_URL;
    const configuredPortalUrl = process.env.TASKDESK_PORTAL_URL;
    if (!configuredAgentUrl || !configuredPortalUrl) {
      throw new Error("The integration host fixtures are not configured.");
    }

    const agentOrigin = new URL(configuredAgentUrl);
    const portalOrigin = new URL(configuredPortalUrl);
    const { app } = createApp();
    const agentResponse = await app.request(
      new URL("/api/openapi", agentOrigin).toString(),
      { headers: { host: agentOrigin.host } },
    );
    const portalResponse = await app.request(
      new URL("/api/openapi", portalOrigin).toString(),
      { headers: { host: portalOrigin.host } },
    );

    expect(agentResponse.status).toBe(200);
    expect(portalResponse.status).toBe(404);
  });

  it("keeps runtime clients on the same origin when no API URL is configured", async () => {
    vi.stubEnv("KANEO_API_URL", undefined);

    const { app } = createApp();
    const response = await app.request("/api/openapi");
    expect(response.status).toBe(200);
    const runtimeSpec = (await response.json()) as Spec;

    expect(runtimeSpec.servers[0]?.url).toBe("/api");
  });

  it("uses the configured API URL when one is explicitly set", async () => {
    vi.stubEnv("KANEO_API_URL", "https://api.customer.example");

    const { app } = createApp();
    const response = await app.request("/api/openapi");
    expect(response.status).toBe(200);
    const runtimeSpec = (await response.json()) as Spec;

    expect(runtimeSpec.servers[0]?.url).toBe(
      "https://api.customer.example/api",
    );
  });

  it("keeps SCIM server metadata on the configured agent origin", async () => {
    const agentOrigin = "https://agent.taskdesk.test";
    vi.stubEnv("TASKDESK_AGENT_URL", agentOrigin);

    const { app } = createApp();
    const response = await app.request("/api/openapi");
    expect(response.status).toBe(200);
    const runtimeSpec = (await response.json()) as Spec;

    expect(runtimeSpec.paths["/scim/v2/Users"]?.servers?.[0]?.url).toBe(
      agentOrigin,
    );
  });

  it("is a valid OpenAPI 3.1 document", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("TaskDesk API");
  });

  it("requires bearer auth globally", () => {
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(spec.security).toContainEqual({ bearerAuth: [] });
  });

  it("documents the routes the clients depend on", () => {
    const keys = new Set(
      operations(spec).map(
        ([method, path]) => `${method.toUpperCase()} ${path}`,
      ),
    );
    for (const op of [
      "GET /config",
      "GET /label/{id}",
      "POST /label",
      "GET /project",
      "GET /task/tasks/{projectId}",
      "PATCH /task/bulk",
      "GET /search",
      "GET /notification",
      "POST /workspace",
    ]) {
      expect(keys.has(op), `missing operation ${op}`).toBe(true);
    }
  });

  it("gives every operation a unique operationId and a summary", () => {
    const ids: string[] = [];
    for (const [method, path, operation] of operations(spec)) {
      expect(
        operation.operationId,
        `${method} ${path} has no operationId`,
      ).toBeTruthy();
      expect(
        operation.summary,
        `${method} ${path} has no summary`,
      ).toBeTruthy();
      ids.push(operation.operationId as string);
    }
    expect(new Set(ids).size, "operationIds must be unique").toBe(ids.length);
  });

  it("names its entity schemas as reusable components", () => {
    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining([
        "Task",
        "Project",
        "Label",
        "Column",
        "Comment",
        "Activity",
        "TimeEntry",
        "Notification",
        "Config",
        "SearchResult",
        "WorkspaceMember",
      ]),
    );
  });

  it("documents a 401 on every operation that requires auth", () => {
    const missing: string[] = [];
    for (const [method, path, operation] of operations(spec)) {
      const isPublic =
        Array.isArray(operation.security) && operation.security.length === 0;
      if (isPublic) continue;
      if (!operation.responses["401"])
        missing.push(`${method.toUpperCase()} ${path}`);
    }
    expect(missing).toEqual([]);
  });
});
