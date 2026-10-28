export type PersistedFixture = {
  projectId: string;
  projectKey: string;
  items: { id: string; key: string }[];
};
export type PersistedManifest = {
  version: 1;
  syntheticOnly: true;
  runId: string;
  workspaceId: string;
  organisationId: string;
  staffEmail: string;
  credentialsFile: string;
  agentOrigin: string;
  portalOrigin: string;
  list: PersistedFixture;
  board: PersistedFixture;
};
export declare function readPrivateJson(
  filename: string,
  root?: string,
): unknown;
export declare function validateManifest(input: unknown): PersistedManifest;
export declare function loadManifest(filename: string): PersistedManifest;
