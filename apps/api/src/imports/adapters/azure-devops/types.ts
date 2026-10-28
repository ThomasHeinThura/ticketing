/** Record schema v2 caps; anything beyond is dropped and reported as a loss. */
export const RECORD_LIMITS = {
  comments: 500,
  attachments: 100,
  relations: 200,
  customFields: 100,
  history: 1000,
} as const;
