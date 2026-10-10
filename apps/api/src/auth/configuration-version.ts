type VersionedConfigRow = {
  id: string;
  configVersion: number;
};

/**
 * Return a stable version vector for independently versioned auth rows.
 * Each row owns its counter, so comparing only the maximum can hide a lower
 * counter's change behind an unrelated row with a larger counter.
 */
export function authConfigurationVersion(
  pluginRows: readonly VersionedConfigRow[],
  connectionRows: readonly VersionedConfigRow[],
): string {
  const sortRows = (rows: readonly VersionedConfigRow[]) =>
    rows
      .map(({ id, configVersion }) => [id, configVersion] as const)
      .sort(([leftId], [rightId]) =>
        leftId < rightId ? -1 : leftId > rightId ? 1 : 0,
      );

  return JSON.stringify([sortRows(pluginRows), sortRows(connectionRows)]);
}
