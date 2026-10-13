import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createTaskDeskLogger,
  type TaskDeskLogEvent,
} from "../../../apps/api/src/observability/logger.js";
import { registeredRouteKey } from "../../../apps/api/src/observability/metrics.js";
import { defaultLogLevels } from "../../../apps/api/src/observability/settings.js";

const workspacesRoute = registeredRouteKey("GET", "/api/workspaces");
const assetRoute = registeredRouteKey("GET", "/api/asset/{id}");
const registeredRoutes = new Set([workspacesRoute]);

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { lines, stream };
}

describe("allowlisted structured logger", () => {
  it("accepts HTTP lifecycle failures without request or exception details", () => {
    const sink = capture();
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      registeredRoutes,
      sink.stream,
    );
    logger.log({
      module: "http",
      message: "http.lifecycle_failure",
      level: "error",
      result: "failed",
    });

    expect(JSON.parse(sink.lines[0] as string)).toMatchObject({
      module: "http",
      messageKey: "http.lifecycle_failure",
      msg: "http.lifecycle_failure",
      level: 50,
      result: "failed",
    });
    expect(sink.lines).toHaveLength(1);
  });

  it("emits only closed fields and suppresses messages below module level", () => {
    const sink = capture();
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      registeredRoutes,
      sink.stream,
    );
    logger.log({
      module: "http",
      message: "http.request",
      level: "info",
      traceId: "01J8XQ-safe-trace",
      result: "ok",
      statusClass: "2xx",
      durationMs: 17,
      route: workspacesRoute,
      auditOperation: "pending_action_decision",
    });
    logger.setLogLevels({ default: "info", modules: { http: "error" } });
    logger.log({
      module: "http",
      message: "http.request",
      level: "info",
    });
    logger.log({
      module: "http",
      message: "database.failure",
      level: "error",
      result: "failed",
    });

    expect(sink.lines).toHaveLength(2);
    const record = JSON.parse(sink.lines[0] as string) as Record<
      string,
      unknown
    >;
    expect(record).toMatchObject({
      module: "http",
      messageKey: "http.request",
      msg: "http.request",
      traceId: "01J8XQ-safe-trace",
      result: "ok",
      statusClass: "2xx",
      durationMs: 17,
      route: "GET /api/workspaces",
      auditOperation: "pending_action_decision",
    });
    expect(Object.keys(record).sort()).toEqual(
      [
        "level",
        "time",
        "pid",
        "hostname",
        "module",
        "messageKey",
        "msg",
        "traceId",
        "result",
        "statusClass",
        "durationMs",
        "route",
        "auditOperation",
      ].sort(),
    );
  });

  it("rejects arbitrary request/error fields without copying secret patterns", () => {
    const sink = capture();
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      registeredRoutes,
      sink.stream,
    );
    const secret = "sk_live_do_not_log_7f2a";
    expect(() =>
      logger.log({
        module: "database",
        message: "database.failure",
        level: "error",
        error: new Error(secret),
        requestBody: { password: secret },
      } as never),
    ).toThrow("Invalid structured log event");
    expect(sink.lines.join("\n")).not.toContain(secret);
  });

  it("does not partially apply invalid runtime level updates", () => {
    const sink = capture();
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      registeredRoutes,
      sink.stream,
    );
    expect(() =>
      logger.setLogLevels({ default: "debug", modules: { http: "bogus" } }),
    ).toThrow("Invalid observability log levels");
    logger.log({ module: "http", message: "http.request", level: "debug" });
    expect(sink.lines).toHaveLength(0);
  });

  it("admits only trusted route templates and the finite unmatched bucket", () => {
    const sink = capture();
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      registeredRoutes,
      sink.stream,
    );
    logger.log({
      module: "http",
      message: "http.request",
      level: "info",
      route: "unmatched",
    });

    const secretRoute = "GET /private/sk_live_do_not_log_7f2a";
    expect(() =>
      logger.log({
        module: "http",
        message: "http.request",
        level: "info",
        route: secretRoute as never,
      }),
    ).toThrow("Invalid structured log event");
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('"route":"unmatched"');
    expect(sink.lines.join("\n")).not.toContain("sk_live_do_not_log_7f2a");
  });

  it("accepts only canonical audit operation labels", () => {
    const sink = capture();
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      registeredRoutes,
      sink.stream,
    );
    logger.log({
      module: "audit",
      message: "audit.write_failure",
      level: "error",
      result: "failed",
      auditOperation: "audit_read",
    });
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('"auditOperation":"audit_read"');

    expect(() =>
      logger.log({
        module: "audit",
        message: "audit.write_failure",
        level: "error",
        auditOperation: "raw-audit-id" as never,
      }),
    ).toThrow("Invalid structured log event");
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines.join("\n")).not.toContain("raw-audit-id");
  });

  it("rejects malformed route sets before creating a logger", () => {
    expect(() =>
      createTaskDeskLogger(
        defaultLogLevels(),
        new Set(["GET /raw?secret=x"] as never),
      ),
    ).toThrow("Invalid registered HTTP routes");
  });

  it("emits only a closed strict-policy witness on the request log", () => {
    const sink = capture();
    const source = "apps/api/src/asset/policy.ts";
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      new Set([assetRoute, workspacesRoute]),
      sink.stream,
      new Map([
        [assetRoute, source],
        [workspacesRoute, "apps/api/src/workspace/policy.ts"],
      ]),
    );
    logger.log({
      module: "http",
      message: "http.request",
      level: "info",
      traceId: "0123456789abcdef0123456789abcdef",
      route: assetRoute,
      strictPolicyWitness: {
        requestId: "0123456789abcdef0123456789abcdef",
        route: assetRoute,
        policySource: source,
        decisionCategory: "denied",
        provenanceValidationResult: "complete",
      },
    });
    const record = JSON.parse(sink.lines[0] as string) as Record<
      string,
      unknown
    >;
    expect(record.strictPolicyWitness).toEqual({
      requestId: "0123456789abcdef0123456789abcdef",
      route: assetRoute,
      policySource: source,
      decisionCategory: "denied",
      provenanceValidationResult: "complete",
    });
  });

  it("rejects forged, stale, or non-finite strict-policy witnesses", () => {
    const sink = capture();
    const source = "apps/api/src/asset/policy.ts";
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      new Set([assetRoute, workspacesRoute]),
      sink.stream,
      new Map([
        [assetRoute, source],
        [workspacesRoute, "apps/api/src/workspace/policy.ts"],
      ]),
    );
    const base: TaskDeskLogEvent = {
      module: "http",
      message: "http.request",
      level: "info",
      traceId: "0123456789abcdef0123456789abcdef",
      route: assetRoute,
      strictPolicyWitness: {
        requestId: "0123456789abcdef0123456789abcdef",
        route: assetRoute,
        policySource: source,
        decisionCategory: "denied",
        provenanceValidationResult: "complete",
      },
    };
    for (const witness of [
      { ...base.strictPolicyWitness, requestId: "forged" },
      {
        ...base.strictPolicyWitness,
        policySource: "apps/api/src/evil/policy.ts",
      },
      {
        ...base.strictPolicyWitness,
        policySource: "apps/api/src/workspace/policy.ts",
      },
      { ...base.strictPolicyWitness, route: "GET /raw/path" as never },
      { ...base.strictPolicyWitness, decisionCategory: "maybe" as never },
      { ...base.strictPolicyWitness, tenantId: "raw-row-id" } as never,
    ]) {
      expect(() =>
        logger.log({ ...base, strictPolicyWitness: witness } as never),
      ).toThrow("Invalid structured log event");
    }
    expect(() =>
      logger.log({ ...base, route: "GET /api/raw" as never }),
    ).toThrow("Invalid structured log event");
    expect(sink.lines).toHaveLength(0);
  });

  it("snapshots only own data fields and never serializes hostile witness objects", () => {
    const sink = capture();
    const source = "apps/api/src/asset/policy.ts";
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      new Set([assetRoute, workspacesRoute]),
      sink.stream,
      new Map([
        [assetRoute, source],
        [workspacesRoute, "apps/api/src/workspace/policy.ts"],
      ]),
    );
    const base: TaskDeskLogEvent = {
      module: "http",
      message: "http.request",
      level: "info",
      traceId: "0123456789abcdef0123456789abcdef",
      route: assetRoute,
      strictPolicyWitness: {
        requestId: "0123456789abcdef0123456789abcdef",
        route: assetRoute,
        policySource: source,
        decisionCategory: "denied",
        provenanceValidationResult: "complete",
      },
    };
    let serializationCalls = 0;
    const extra = { leakedTenant: "tenant-secret" };
    const inherited = Object.assign(
      Object.create({
        toJSON() {
          serializationCalls += 1;
          return extra;
        },
      }),
      base.strictPolicyWitness,
    );
    const nonEnumerableToJson = { ...base.strictPolicyWitness };
    Object.defineProperty(nonEnumerableToJson, "toJSON", {
      enumerable: false,
      value() {
        serializationCalls += 1;
        return extra;
      },
    });
    const accessorWitness = { ...base.strictPolicyWitness } as Record<
      string,
      unknown
    >;
    delete accessorWitness.requestId;
    Object.defineProperty(accessorWitness, "requestId", {
      enumerable: true,
      get() {
        serializationCalls += 1;
        return "0123456789abcdef0123456789abcdef";
      },
    });
    const typedValue = {
      toJSON() {
        serializationCalls += 1;
        return "apps/api/src/asset/policy.ts";
      },
    };
    const missingField = { ...base.strictPolicyWitness } as Record<
      string,
      unknown
    >;
    delete missingField.provenanceValidationResult;

    for (const witness of [
      inherited,
      nonEnumerableToJson,
      accessorWitness,
      { ...base.strictPolicyWitness, policySource: typedValue },
      missingField,
    ]) {
      expect(() =>
        logger.log({ ...base, strictPolicyWitness: witness } as never),
      ).toThrow("Invalid structured log event");
    }

    let eventGetterCalls = 0;
    const accessorEvent = { ...base } as Record<string, unknown>;
    delete accessorEvent.module;
    Object.defineProperty(accessorEvent, "module", {
      enumerable: true,
      get() {
        eventGetterCalls += 1;
        return "http";
      },
    });
    expect(() =>
      logger.log(accessorEvent as unknown as TaskDeskLogEvent),
    ).toThrow("Invalid structured log event");
    expect(serializationCalls).toBe(0);
    expect(eventGetterCalls).toBe(0);
    expect(sink.lines).toHaveLength(0);

    logger.log(base);
    const emitted = JSON.parse(sink.lines[0] as string) as Record<
      string,
      unknown
    >;
    expect(emitted.strictPolicyWitness).toEqual(base.strictPolicyWitness);
    expect(sink.lines[0]).not.toContain("leakedTenant");
    expect(sink.lines[0]).not.toContain("tenant-secret");
  });
});
