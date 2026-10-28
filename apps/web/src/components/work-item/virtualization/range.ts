export function mergeVirtualRange(
  visibleIndexes: readonly number[],
  itemCount: number,
  pinnedIndexes: readonly number[],
): number[] {
  const indexes = new Set(visibleIndexes);
  for (const index of pinnedIndexes) {
    if (Number.isInteger(index) && index >= 0 && index < itemCount)
      indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}
