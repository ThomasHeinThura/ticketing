/**
 * Imports place history; they do not replay it (import-and-cutover.md: automations are recreated,
 * not replayed). Events the import writer emits carry `payload.source = "import"`, and the
 * automation and outbound-webhook consumers skip them, as does notification fan-out
 * (`materializeNotificationFanout`: no inbox, email, digest or external-channel delivery). The
 * outbox, audit and realtime records are kept.
 */
export function isImportSourcedEvent(envelope: { payload?: unknown }): boolean {
  const payload = envelope.payload;
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { source?: unknown }).source === "import"
  );
}
