/**
 * Largest `POST /import-sources` body. A source carries its file inline (`config.csvText`, up to
 * 5 MiB; `config.exportText`, up to 8 MB), and JSON escaping of quotes and newlines can double a
 * file, so this leaves headroom while still bounding what one request can make the server buffer.
 *
 * It lives in its own module because two layers enforce it: the route's `bodyLimit` and the
 * app-wide idempotency middleware, which runs first and must not buffer an oversize body.
 */
export const IMPORT_SOURCE_BODY_LIMIT_BYTES = 20 * 1024 * 1024;
