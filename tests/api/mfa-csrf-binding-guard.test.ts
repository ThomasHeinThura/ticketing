import { describe, expect, it } from "vitest";
import { isDisposableLoopbackBinding } from "../e2e/helpers/mfa-csrf-app-fixture";

const requested = [{ HostIp: "127.0.0.1", HostPort: "0" }];
const active = (HostPort: string, HostIp = "127.0.0.1") => [
  { HostIp, HostPort },
];

describe("disposable PostgreSQL binding guard", () => {
  it("accepts one dynamic loopback binding that matches the mapped port", () => {
    expect(
      isDisposableLoopbackBinding(
        requested,
        active("49152"),
        49152,
        "localhost",
      ),
    ).toBe(true);
  });

  it.each([
    ["the live port 62870", requested, active("62870"), 62870, "127.0.0.1"],
    [
      "a non-loopback active binding",
      requested,
      active("49152", "0.0.0.0"),
      49152,
      "127.0.0.1",
    ],
    [
      "a non-loopback request",
      [{ HostIp: "0.0.0.0", HostPort: "0" }],
      active("49152"),
      49152,
      "127.0.0.1",
    ],
    ["a mapped-port mismatch", requested, active("49152"), 49153, "127.0.0.1"],
    ["a non-numeric port", requested, active("abc"), 0, "127.0.0.1"],
    [
      "more than one binding",
      requested,
      [...active("49152"), ...active("49153")],
      49152,
      "127.0.0.1",
    ],
    ["a remote host", requested, active("49152"), 49152, "db.example.com"],
  ])("rejects %s", (_name, req, act, mapped, host) => {
    expect(isDisposableLoopbackBinding(req, act, mapped, host)).toBe(false);
  });
});
