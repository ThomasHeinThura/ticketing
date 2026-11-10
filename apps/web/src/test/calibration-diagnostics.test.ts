import { describe, expect, it } from "vitest";
import { resolveJobCalibration } from "../../../../scripts/ci/lib/performance-calibration.mjs";
import {
  captureCalibrationPressure,
  observeCalibrationBatch,
} from "../../e2e/helpers/calibration-diagnostics";

describe("calibration diagnostics", () => {
  it("logs every raw batch before an unstable calibration fails", async () => {
    const logs: string[] = [];
    const batches: number[][] = [];
    const runs = [10, 10, 10, 10, 20];
    for (let index = 0; index < 3; index += 1) {
      batches.push(
        await observeCalibrationBatch(
          "unthrottled",
          index,
          async () => runs,
          (line) => logs.push(line),
          () => ({}),
        ),
      );
    }
    expect(() =>
      resolveJobCalibration({ batches, state: "unthrottled" }),
    ).toThrow(/unstable/);
    expect(logs).toHaveLength(3);
    expect(logs[2]).toContain("raw batch 3 [unthrottled]: [10,10,10,10,20]");
  });

  it("only reports allowlisted numeric counters and tolerates unavailable files", () => {
    const result = captureCalibrationPressure(() => {
      throw new Error("unavailable");
    });
    expect(result.cgroupScope).toEqual(["unavailable"]);
    expect(result.hostCpuPressure).toEqual([]);
  });

  it("captures nested process and ancestor counters without exposing paths", () => {
    let throttled = 3;
    const read = (file: string) => {
      if (file === "/proc/self/cgroup") return "0::/jobs/private/job\n";
      if (file === "/proc/self/mountinfo")
        return "30 20 0:27 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n";
      if (file === "/sys/fs/cgroup/jobs/private/job/cpu.stat")
        return `nr_throttled ${throttled}\nthrottled_usec 42\nsecret value\n`;
      if (file.endsWith("/cpu.stat")) return "nr_throttled 0\n";
      if (file.endsWith("/cpu.max")) return "100000 100000\n";
      throw new Error("unavailable");
    };
    const before = captureCalibrationPressure(read);
    throttled = 5;
    const after = captureCalibrationPressure(read);
    expect(before.cgroup0CpuStat).toEqual([
      "nr_throttled 3",
      "throttled_usec 42",
    ]);
    expect(after.cgroup0CpuStat).toEqual([
      "nr_throttled 5",
      "throttled_usec 42",
    ]);
    expect(after.cgroup3CpuStat).toEqual(["nr_throttled 0"]);
    expect(after.cgroup0CpuMax).toEqual(["100000 100000"]);
    expect(JSON.stringify(after)).not.toContain("private");
  });
});
