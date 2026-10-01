export type SeedProfile = "minimal" | "realistic" | "hostile";

export type SeedProfileCounts = {
  projects: number;
  people: number;
  items: number;
};

export const SEED_PROFILE_COUNTS: Record<SeedProfile, SeedProfileCounts> = {
  minimal: { projects: 1, people: 0, items: 10 },
  realistic: { projects: 50, people: 200, items: 10_000 },
  hostile: { projects: 1, people: 0, items: 10 },
};

export const HOSTILE_TITLES = [
  "", // PostgreSQL permits an empty string in this NOT NULL text column.
  "東京の課題",
  "الْعَرَبِيَّة",
  "مرحبا بالعالم",
  "Issue 🚀🧪",
  "Задача",
  "नमस्ते",
] as const;

export const HOSTILE_TITLE_LENGTH = 500;
export const HOSTILE_HIERARCHY_DEPTH = 10;
