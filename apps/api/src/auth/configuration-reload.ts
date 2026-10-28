async function logReloadHintFailure(): Promise<void> {
  try {
    const { logTaskDesk } = await import("../instance/observability/runtime");
    logTaskDesk({
      module: "auth",
      message: "auth.failure",
      level: "error",
      result: "failed",
    });
  } catch {
    // A committed configuration must remain successful even if logging is unavailable.
  }
}

/**
 * Refresh this process and notify peer replicas after an auth configuration
 * transaction commits. The control message intentionally contains no config
 * values, provider identifiers, or secrets. The periodic DB poll remains the
 * fallback when Redis is unavailable.
 */
export async function publishCommittedAuthConfigurationReload(): Promise<void> {
  try {
    const { reloadAuthConfiguration } = await import("../auth");
    await reloadAuthConfiguration();
  } catch {
    await logReloadHintFailure();
  }

  try {
    const { publishAuthReload } = await import("../ws");
    await publishAuthReload();
  } catch {
    await logReloadHintFailure();
  }
}
