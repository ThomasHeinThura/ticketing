export function median(values) {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      "A G11 sample set must contain exactly three finite measurements.",
    );
  }
  return [...values].sort((left, right) => left - right)[1];
}

export async function medianOfThreeWithRetry(sample, budget) {
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("A G11 metric budget must be a positive finite number.");
  }
  const sampleSet = async () => {
    const values = [];
    for (let index = 0; index < 3; index += 1) values.push(await sample());
    return values;
  };
  let values = await sampleSet();
  let result = median(values);
  let retried = false;
  if (result >= budget) {
    values = await sampleSet();
    result = median(values);
    retried = true;
  }
  return { result, values, retried };
}
