export function isNewerObservabilityConfig(
  candidateVersion: number,
  appliedVersion: number,
): boolean {
  return candidateVersion > appliedVersion;
}
