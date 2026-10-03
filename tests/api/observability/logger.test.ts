import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createTaskDeskLogger } from "../../../apps/api/src/observability/logger.js";
import { defaultLogLevels } from "../../../apps/api/src/observability/settings.js";

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
  it("emits only closed fields and suppresses messages below module level", () => {
    const sink = capture();
    const logger = createTaskDeskLogger(defaultLogLevels(), sink.stream);
    logger.log({
      module: "http",
      message: "http.request",
      level: "info",
      traceId: "01J8XQ-safe-trace",
      result: "ok",
      statusClass: "2xx",
      durationMs: 17,
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
      ].sort(),
    );
  });

  it("rejects arbitrary request/error fields without copying secret patterns", () => {
    const sink = capture();
    const logger = createTaskDeskLogger(defaultLogLevels(), sink.stream);
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
    const logger = createTaskDeskLogger(defaultLogLevels(), sink.stream);
    expect(() =>
      logger.setLogLevels({ default: "debug", modules: { http: "bogus" } }),
    ).toThrow("Invalid observability log levels");
    logger.log({ module: "http", message: "http.request", level: "debug" });
    expect(sink.lines).toHaveLength(0);
  });
});
