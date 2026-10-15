export const PRIVATE_FULLRUNNER_PROJECT_NAME: "hosted-board-drag-fullrunner-private";
export const FULLRUNNER_RESULT_DIRECTORY: string;

export function isPrivateFullrunnerProject(projectName: unknown): boolean;

export function persistPrivateBoardDragIntervals(input: {
  directory: string;
  projectName: string;
  sampleOrdinal: number;
  intervalsMs: number[];
}): Promise<boolean>;

export function readPrivateRawIntervalSamples(
  directory: string,
): Promise<Array<{ sampleOrdinal: number; intervalsMs: number[] }>>;

export function sanitizeFullRunnerSummary(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>;

export function writeSanitizedFullRunnerSummary(
  filename: string,
  summary: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>>;
