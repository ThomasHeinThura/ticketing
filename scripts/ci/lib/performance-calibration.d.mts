export type CalibrationScale = "none" | "full" | "post-dcl";
export type CalibrationState = "throttled" | "unthrottled";
export type CalibrationSample = number | { value: number; floorMs?: number };

export type PerformanceReference = {
  readonly sourceSha256: string | null;
  readonly optionsSha256: string | null;
  readonly unthrottledMs: number | null;
  readonly throttledMs: number | null;
  readonly evidence: string | null;
};

export type Calibration = {
  mode: "calibration-only" | "calibrated";
  state: CalibrationState;
  factor: number;
  referenceMs: number | null;
  runs: number[];
  medianMs: number;
  spread: number;
  note?: string;
};

export type CalibratedSet = {
  calibration: Calibration;
  raw: number[];
  normalised: number[];
  rawMedian: number;
  result: number;
};

export declare const CALIBRATION_FACTOR_MIN: number;
export declare const CALIBRATION_FACTOR_MAX: number;
export declare const CALIBRATION_MAX_SPREAD: number;
export declare const CALIBRATION_WARMUP_RUNS: number;
export declare const CALIBRATION_RUNS: number;
export declare const CALIBRATION_ROWS: number;
export declare const CALIBRATION_COLUMNS: number;
export declare const CALIBRATION_SOURCE: string;
export declare const CALIBRATION_SOURCE_SHA256: string;
export declare const CALIBRATION_OPTIONS_SHA256: string;
export declare const CALIBRATION_OPTIONS: Readonly<{
  warmups: number;
  runs: number;
  rows: number;
  columns: number;
}>;
export type CalibratedMetricId =
  | "list"
  | "board"
  | "lcp"
  | "route"
  | "create"
  | "palette"
  | "paletteNav"
  | "taskState"
  | "taskAssign";
export type CalibratedMetricEntry = {
  readonly state: CalibrationState;
  readonly scale: Exclude<CalibrationScale, "none">;
  readonly k: number;
};
export declare const CALIBRATED_METRICS: Readonly<
  Record<CalibratedMetricId, CalibratedMetricEntry>
>;
export declare function calibrationOptionsSha256(options?: {
  warmups: number;
  runs: number;
  rows: number;
  columns: number;
}): string;
export declare const PERFORMANCE_REFERENCE: PerformanceReference;

export declare function sha256Hex(text: string): string;
export declare function assertCalibrationSourcePinned(
  source?: string,
  expected?: string,
): string;
export declare function summariseCalibration(
  runs: number[],
  expectedRuns?: number,
): { runs: number[]; medianMs: number; spread: number };
export declare function resolveCalibration(options: {
  runs: number[];
  state: CalibrationState;
  reference?: PerformanceReference;
  sourceSha256?: string;
  optionsSha256?: string;
  maxSpread?: number;
  factorMin?: number;
  factorMax?: number;
}): Calibration;
export declare function normaliseSample(
  sample: CalibrationSample,
  calibration: Calibration,
  scale: CalibrationScale,
  sensitivity: number,
): number;
export declare function calibratedMedianOfThreeWithRetry(options: {
  sample: () => Promise<CalibrationSample>;
  budget: number;
  metric: string;
  calibrate: () => Promise<number[]>;
  metrics?: Readonly<Record<string, CalibratedMetricEntry>>;
  reference?: PerformanceReference;
  sourceSha256?: string;
  optionsSha256?: string;
}): Promise<{ result: number; retried: boolean; sets: CalibratedSet[] }>;
export declare function describeHost(options: {
  cpuinfoText?: string;
  osCpuModel?: string;
  parallelism?: number;
}): { cpuModel: string; nproc: number | null };
