import { describe, expect, it } from "vitest";
import { resolveBreakGlassOperatorIdentity } from "../../apps/api/src/cli/operator-identity";

const servicePasswd =
  "root:x:0:0:root:/root:/bin/sh\ntaskdesk:x:10001:10001:TaskDesk:/app:/sbin/nologin\n";

describe("break-glass operator identity", () => {
  it("accepts only the configured service account and effective UID", () => {
    expect(
      resolveBreakGlassOperatorIdentity({
        passwdContents: servicePasswd,
        effectiveUid: 10_001,
        reportedUid: 10_001,
        reportedUsername: "taskdesk",
      }),
    ).toEqual({ uid: 10_001, passwdName: "taskdesk" });
  });

  it.each([
    ["root uid", { effectiveUid: 0, reportedUid: 0, reportedUsername: "root" }],
    [
      "mismatched effective uid",
      {
        effectiveUid: 10_002,
        reportedUid: 10_001,
        reportedUsername: "taskdesk",
      },
    ],
    [
      "mismatched reported uid",
      {
        effectiveUid: 10_001,
        reportedUid: 10_002,
        reportedUsername: "taskdesk",
      },
    ],
    [
      "mismatched passwd name",
      {
        effectiveUid: 10_001,
        reportedUid: 10_001,
        reportedUsername: "operator",
      },
    ],
    [
      "unsupported effective uid",
      {
        effectiveUid: undefined,
        reportedUid: 10_001,
        reportedUsername: "taskdesk",
      },
    ],
  ] as const)("rejects %s", (_label, identity) => {
    expect(() =>
      resolveBreakGlassOperatorIdentity({
        passwdContents: servicePasswd,
        ...identity,
      }),
    ).toThrow("effective process identity");
  });

  it.each([
    ["missing service account", "root:x:0:0:root:/root:/bin/sh\n"],
    [
      "duplicate service account",
      `${servicePasswd}taskdesk:x:10001:10001:duplicate:/app:/sbin/nologin\n`,
    ],
    [
      "invalid service uid",
      "taskdesk:x:service:10001:TaskDesk:/app:/sbin/nologin\n",
    ],
    ["root service uid", "taskdesk:x:0:0:TaskDesk:/app:/sbin/nologin\n"],
  ] as const)("rejects %s configuration", (_label, passwdContents) => {
    expect(() =>
      resolveBreakGlassOperatorIdentity({
        passwdContents,
        effectiveUid: 10_001,
        reportedUid: 10_001,
        reportedUsername: "taskdesk",
      }),
    ).toThrow("effective process identity");
  });
});
