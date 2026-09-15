import { describe, expect, it } from "vitest";
import { resolvePort } from "../../apps/api/src/index";

describe("resolvePort", () => {
  it("uses the documented default when TASKDESK_PORT is unset", () => {
    expect(resolvePort(undefined)).toEqual({ port: 5173, invalid: false });
  });

  it("accepts a valid port", () => {
    expect(resolvePort("8080")).toEqual({ port: 8080, invalid: false });
  });

  it("accepts the boundary port 65535", () => {
    expect(resolvePort("65535")).toEqual({ port: 65535, invalid: false });
  });

  it("accepts the boundary port 1", () => {
    expect(resolvePort("1")).toEqual({ port: 1, invalid: false });
  });

  it("falls back and flags invalid for 0", () => {
    expect(resolvePort("0")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a negative number", () => {
    expect(resolvePort("-1")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a port above 65535", () => {
    expect(resolvePort("65536")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a very large number", () => {
    expect(resolvePort("4294967296")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a non-numeric string", () => {
    expect(resolvePort("not-a-port")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for an empty string", () => {
    expect(resolvePort("")).toEqual({ port: 5173, invalid: true });
  });

  it("falls back and flags invalid for a float", () => {
    expect(resolvePort("5173.5")).toEqual({ port: 5173, invalid: true });
  });

  it("does not flag invalid when the raw value already equals the default", () => {
    expect(resolvePort("5173")).toEqual({ port: 5173, invalid: false });
  });
});
