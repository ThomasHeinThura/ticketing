import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";

const pressurePattern =
  /^(?:some|full) avg10=([\d.]+) avg60=([\d.]+) avg300=([\d.]+) total=(\d+)$/gm;
const cpuStatPattern = /^(?:nr_periods|nr_throttled|throttled_usec) \d+$/gm;
const cpuMaxPattern = /^(?:max|\d+) \d+$/gm;

function readBounded(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(65537);
    const bytes = readSync(fd, buffer, 0, buffer.length, null);
    if (bytes === buffer.length) throw new Error("diagnostic input too large");
    return buffer.toString("utf8", 0, bytes);
  } finally {
    closeSync(fd);
  }
}

function safeAbsolutePath(value: string): boolean {
  return (
    value.startsWith("/") &&
    value.length <= 1024 &&
    !value.includes("\0") &&
    !value.split("/").some((part) => part === "." || part === "..")
  );
}

function decodeMountPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

// Resolve only cgroup v2 mounts containing this process's cgroup. Never emit paths.
function cgroupDirectories(read: (file: string) => string): string[] {
  const line = read("/proc/self/cgroup")
    .split("\n")
    .find((entry) => entry.startsWith("0::"));
  const group = line?.slice(3);
  if (!group || !safeAbsolutePath(group)) return [];
  const mounts = read("/proc/self/mountinfo")
    .split("\n")
    .flatMap((entry) => {
      const [prefix, suffix] = entry.split(" - ");
      if (!suffix?.startsWith("cgroup2 ")) return [];
      const fields = prefix.split(" ");
      if (fields.length < 5) return [];
      const root = decodeMountPath(fields[3]);
      const mount = decodeMountPath(fields[4]);
      if (!safeAbsolutePath(root) || !safeAbsolutePath(mount)) return [];
      const normalizedRoot = path.posix.normalize(root);
      const normalizedGroup = path.posix.normalize(group);
      if (
        normalizedRoot !== "/" &&
        normalizedGroup !== normalizedRoot &&
        !normalizedGroup.startsWith(`${normalizedRoot}/`)
      )
        return [];
      return [{ root: normalizedRoot, mount: path.posix.normalize(mount) }];
    })
    .sort((a, b) => b.root.length - a.root.length);
  const selected = mounts[0];
  if (!selected) return [];
  const relative = path.posix.relative(
    selected.root,
    path.posix.normalize(group),
  );
  let directory = path.posix.join(selected.mount, relative);
  const directories: string[] = [];
  // Bound work and output even if the process has an unusually deep hierarchy.
  while (directories.length < 16) {
    directories.push(directory);
    if (directory === selected.mount) break;
    directory = path.posix.dirname(directory);
  }
  return directories;
}

export function captureCalibrationPressure(
  read: (file: string) => string = readBounded,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const capture = (name: string, file: string, pattern: RegExp) => {
    try {
      result[name] = Array.from(
        read(file).matchAll(pattern),
        (match) => match[0],
      );
    } catch {
      result[name] = [];
    }
  };
  capture("hostCpuPressure", "/proc/pressure/cpu", pressurePattern);
  capture("hostMemoryPressure", "/proc/pressure/memory", pressurePattern);
  let directories: string[] = [];
  try {
    directories = cgroupDirectories(read);
  } catch {
    // Unsupported or inaccessible cgroup information remains explicitly unavailable.
  }
  result.cgroupScope = directories.length
    ? ["process-first; ancestors-follow; max-16"]
    : ["unavailable"];
  directories.forEach((directory, index) => {
    capture(
      `cgroup${index}CpuStat`,
      path.posix.join(directory, "cpu.stat"),
      cpuStatPattern,
    );
    capture(
      `cgroup${index}CpuMax`,
      path.posix.join(directory, "cpu.max"),
      cpuMaxPattern,
    );
    capture(
      `cgroup${index}MemoryPressure`,
      path.posix.join(directory, "memory.pressure"),
      pressurePattern,
    );
  });
  return result;
}

export async function observeCalibrationBatch(
  state: string,
  index: number,
  measure: () => Promise<number[]>,
  log: (line: string) => void = console.log,
  capture: typeof captureCalibrationPressure = captureCalibrationPressure,
): Promise<number[]> {
  const before = capture();
  const runs = await measure();
  const after = capture();
  log(
    `G11 calibration raw batch ${index + 1} [${state}]: ${JSON.stringify(runs)}; pressure ${JSON.stringify({ before, after })}`,
  );
  return runs;
}
