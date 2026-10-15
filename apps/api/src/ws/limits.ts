/**
 * Open realtime connections one person may hold per socket kind: the native socket and the
 * legacy project socket share this number so a client cannot use the older endpoint to dodge
 * the cap (#748).
 */
export const MAX_REALTIME_CONNECTIONS_PER_PERSON = 5;
