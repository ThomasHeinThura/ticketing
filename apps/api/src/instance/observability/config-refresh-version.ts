export function isNewerObservabilityConfig(
  candidateVersion: number,
  appliedVersion: number,
): boolean {
  return candidateVersion > appliedVersion;
}

export type ObservabilityConfigSnapshot = {
  version: number;
  levels: unknown;
};

export function createObservabilityConfigRefresher<TLevels>(options: {
  read: () => Promise<ObservabilityConfigSnapshot | undefined>;
  validate: (levels: unknown) => TLevels;
  apply: (levels: TLevels) => void;
  onFailure: () => void;
  initialVersion: number;
}) {
  let appliedVersion = options.initialVersion;
  let nextSequence = 0;
  let latestCompletedSequence = 0;
  let latestFailureSequence = 0;
  let failureLogged = false;
  let active = true;

  return {
    async refresh(): Promise<void> {
      const sequence = ++nextSequence;
      try {
        const current = await options.read();
        if (!current) throw new Error("settings_missing");
        if (!Number.isSafeInteger(current.version) || current.version < 1) {
          throw new Error("settings_version_invalid");
        }
        const levels = options.validate(current.levels);
        if (!active || sequence < latestCompletedSequence) return;
        latestCompletedSequence = sequence;
        if (sequence >= latestFailureSequence) failureLogged = false;
        if (!isNewerObservabilityConfig(current.version, appliedVersion))
          return;
        options.apply(levels);
        appliedVersion = current.version;
      } catch {
        if (!active || sequence < latestCompletedSequence) return;
        latestCompletedSequence = sequence;
        latestFailureSequence = sequence;
        if (failureLogged) return;
        failureLogged = true;
        options.onFailure();
      }
    },
    stop(): void {
      active = false;
    },
  };
}
