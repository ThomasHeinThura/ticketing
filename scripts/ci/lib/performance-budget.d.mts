export declare function median(values: number[]): number;

export declare function medianOfThreeWithRetry(
  sample: () => Promise<number>,
  budget: number,
): Promise<{ result: number; values: number[]; retried: boolean }>;
