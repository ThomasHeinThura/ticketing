/** Validated, normalized entries; secrets stay only in caller memory and the rotation POST. */
export type WebhookSecretRotationBindingEntry = {
  readonly webhookId: string;
  readonly expectedVersion: number;
  readonly secret: string;
};

/** Exact protocol bytes shared by browser WebCrypto and the server's SHA-256 digest. */
export function canonicalWebhookSecretRotationPayload(
  entries: readonly WebhookSecretRotationBindingEntry[],
): string {
  const sorted = [...entries].sort((left, right) =>
    left.webhookId < right.webhookId
      ? -1
      : left.webhookId > right.webhookId
        ? 1
        : 0,
  );
  return JSON.stringify({
    webhooks: sorted.map(({ webhookId, expectedVersion, secret }) => ({
      webhookId,
      expectedVersion,
      secret,
    })),
  });
}
