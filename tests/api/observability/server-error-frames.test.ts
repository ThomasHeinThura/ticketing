import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createTaskDeskLogger } from "../../../apps/api/src/observability/logger.js";
import { serverErrorFrames } from "../../../apps/api/src/observability/server-error-frames.js";
import { defaultLogLevels } from "../../../apps/api/src/observability/settings.js";

describe("server error frames", () => {
  it("drops message text and serializes only bounded existing locations", () => {
    const file = fileURLToPath(import.meta.url);
    const secret = "person@example.com token-012345678901234567890123456789";
    const err = new Error(secret);
    err.stack = `Error: ${secret}\n    at failure (${file}:12:34)\nnot a frame ${secret}`;
    const frames = serverErrorFrames(err.stack);
    expect(frames).toHaveLength(1);
    expect(
      serverErrorFrames(
        `Error: ignored\n    at token-secret (${file}:1:2)`,
      ).join("\n"),
    ).not.toContain("token-secret");
    expect(frames[0]).toContain("server-error-frames.test.ts:12:34");
    const lines: string[] = [];
    const logger = createTaskDeskLogger(
      defaultLogLevels(),
      new Set(),
      new Writable({
        write(chunk, _encoding, callback) {
          lines.push(String(chunk));
          callback();
        },
      }),
    );
    logger.log({
      module: "http",
      message: "http.server_error",
      level: "error",
      frames,
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string).frames).toEqual(frames);
    expect(lines[0]).not.toContain("person@example.com");
    expect(lines[0]).not.toContain("token-012345678901234567890123456789");
  });
});

it("rejects accessor-backed frame arrays without evaluating them", () => {
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const logger = createTaskDeskLogger(defaultLogLevels(), new Set(), sink);
  const frames: string[] = [];
  const getter = vi.fn(() => "private");
  Object.defineProperty(frames, "0", { get: getter, enumerable: true });
  expect(() =>
    logger.log({
      module: "http",
      message: "http.server_error",
      level: "error",
      frames,
    }),
  ).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
