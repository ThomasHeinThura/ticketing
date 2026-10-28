export type TerminologyPreviewExample = {
  category: string;
  count: number;
  label: string;
};

function candidateCounts() {
  const counts = [
    1, 2, 0, 3, 4, 5, 10, 11, 21, 100, 101, 1_000, 10_000, 100_000, 1_000_000,
    1_000_000_000,
  ];
  for (let count = 0; count <= 200; count += 1) counts.push(count);
  for (let integer = 0; integer <= 20; integer += 1) {
    for (let tenth = 1; tenth <= 9; tenth += 1) {
      counts.push(integer + tenth / 10);
    }
  }
  for (const magnitude of [100, 1_000, 1_000_000]) {
    counts.push(magnitude + 0.1, magnitude + 0.5, magnitude + 1.1);
  }
  return [...new Set(counts)];
}

export function buildTerminologyPreviewExamples(input: {
  locale: string;
  forms: Record<string, string>;
}): TerminologyPreviewExample[] | null {
  const categories = new Intl.PluralRules(input.locale).resolvedOptions()
    .pluralCategories;
  const countsByCategory = new Map<string, number>();
  const rules = new Intl.PluralRules(input.locale);
  for (const count of candidateCounts()) {
    const category = rules.select(count);
    if (!countsByCategory.has(category)) countsByCategory.set(category, count);
    if (countsByCategory.size === categories.length) break;
  }

  if (
    countsByCategory.size !== categories.length ||
    Object.keys(input.forms).length !== categories.length
  )
    return null;

  const examples: TerminologyPreviewExample[] = [];
  for (const category of categories) {
    const count = countsByCategory.get(category);
    const label = input.forms[category];
    if (count === undefined || typeof label !== "string" || !label.trim())
      return null;
    examples.push({ category, count, label });
  }
  return examples;
}
