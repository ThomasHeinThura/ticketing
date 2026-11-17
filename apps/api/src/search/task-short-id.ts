// A task's short id is its project key plus the task number, e.g. "DEP-23".
// Preserve Unicode and other legacy project keys in short-ID searches, even though
// new project keys are restricted to uppercase ASCII letters.
export const TASK_SHORT_ID_PATTERN = /^(\p{L}[\p{L}\p{N}\p{M}_-]*)-(\d+)$/u;
