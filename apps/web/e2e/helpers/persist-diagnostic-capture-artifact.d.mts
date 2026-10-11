export type DiagnosticCaptureArtifact = Readonly<Record<string, unknown>> & {
  schemaVersion: 1;
  diagnosticOnly: true;
  captureIndex: number;
  sourceAndBuild: Readonly<Record<string, unknown>>;
  capturedWindow: Readonly<Record<string, unknown>> & { name: string };
};

export type DiagnosticFailureArtifact = Readonly<Record<string, unknown>> & {
  schemaVersion: 1;
  diagnosticOnly: true;
  phase: "align-boundary-to-trace";
  sourceAndBuild: Readonly<Record<string, unknown>>;
  errorMessage: string;
  completedCaptureNames: readonly string[];
};

export function persistDiagnosticCaptureArtifact(
  directory: string,
  captureIndex: number,
  artifact: DiagnosticCaptureArtifact,
): Promise<string>;

export function persistDiagnosticFailureArtifact(
  directory: string,
  artifact: DiagnosticFailureArtifact,
): Promise<string>;

export function persistDiagnosticCapturesBestEffort(
  directory: string,
  artifacts: readonly DiagnosticCaptureArtifact[],
): Promise<void>;

export function aggregateDiagnosticCapturesWithFailureReceipt<
  Capture extends { name: string },
  Result,
>(
  directory: string,
  captures: readonly Capture[],
  sourceAndBuild: Readonly<Record<string, unknown>>,
  aggregate: (capture: Capture) => Result,
): Promise<Result[]>;
