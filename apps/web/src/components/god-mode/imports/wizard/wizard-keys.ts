export const wizardKeys = {
  engine: (runId: string) => ["god-mode", "imports", "engine", runId] as const,
  mapping: (runId: string) =>
    ["god-mode", "imports", "mapping", runId] as const,
  dryRun: (runId: string) => ["god-mode", "imports", "dry-run", runId] as const,
  reconciliation: (runId: string) =>
    ["god-mode", "imports", "reconciliation", runId] as const,
  losses: (runId: string) => ["god-mode", "imports", "losses", runId] as const,
};
