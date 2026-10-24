/**
 * CF-8: a deleted custom field and its values stay restorable for this long, and the
 * `custom-field-purge` job hard-deletes them only after it. One constant serves both sides so a
 * field can never be restorable and already purged, or refused a restore yet still stored.
 */
export const CUSTOM_FIELD_RESTORE_WINDOW_DAYS = 30;
export const CUSTOM_FIELD_RESTORE_WINDOW_MS =
  CUSTOM_FIELD_RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
