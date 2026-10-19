// The advisory family lock is a label statement and lives in the repository (issue #580).
// Re-exported here so existing importers outside the label module keep their path.
export {
  lockWorkspaceLabelNames,
  WORKSPACE_LABEL_NAME_LOCK_NAMESPACE,
} from "./repository";
