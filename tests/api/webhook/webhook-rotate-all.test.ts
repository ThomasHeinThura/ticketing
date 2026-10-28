import { describe, expect, it } from "vitest";
import {
  canonicalWebhookSecretRotationSet,
  matchesExactWebhookSecretRotationSet,
  rotateAllWebhookSecretsBody,
  webhookSecretRotationSetDigest,
} from "../../../apps/api/src/webhook/rotate-all";

const body = {
  webhooks: [
    {
      webhookId: "wh-b",
      expectedVersion: 4,
      secret: "replacement-secret-for-webhook-b-0001",
    },
    {
      webhookId: "wh-a",
      expectedVersion: 2,
      secret: "replacement-secret-for-webhook-a-0001",
    },
  ],
};
const [firstEntry, secondEntry] = body.webhooks;
if (!firstEntry || !secondEntry)
  throw new Error("rotation test entries missing");

describe("rotate all webhook secrets request contract", () => {
  it("accepts exact write-only replacement entries with distinct secrets", () => {
    expect(rotateAllWebhookSecretsBody.parse(body)).toEqual(body);
  });

  it("rejects duplicate webhook ids, duplicate replacement secrets, and extra body fields", () => {
    expect(() =>
      rotateAllWebhookSecretsBody.parse({
        webhooks: [firstEntry, { ...firstEntry, expectedVersion: 5 }],
      }),
    ).toThrow();
    expect(() =>
      rotateAllWebhookSecretsBody.parse({
        webhooks: [firstEntry, { ...secondEntry, secret: firstEntry.secret }],
      }),
    ).toThrow();
    expect(() =>
      rotateAllWebhookSecretsBody.parse({
        ...body,
        secret: "should-not-be-ignored",
      }),
    ).toThrow();
  });

  it("canonicalizes replacement sets independent of input order and binds versions/secrets", () => {
    const reversed = { webhooks: [...body.webhooks].reverse() };
    expect(canonicalWebhookSecretRotationSet(reversed)).toBe(
      canonicalWebhookSecretRotationSet(body),
    );
    expect(webhookSecretRotationSetDigest(reversed)).toBe(
      webhookSecretRotationSetDigest(body),
    );
    expect(
      webhookSecretRotationSetDigest({
        webhooks: body.webhooks.map((entry) => ({
          ...entry,
          expectedVersion: entry.expectedVersion + 1,
        })),
      }),
    ).not.toBe(webhookSecretRotationSetDigest(body));
    expect(
      webhookSecretRotationSetDigest({
        webhooks: body.webhooks.map((entry) => ({
          ...entry,
          secret: `${entry.secret}-changed`,
        })),
      }),
    ).not.toBe(webhookSecretRotationSetDigest(body));
  });

  it("requires exact current ids and versions, without omissions or stale entries", () => {
    const replacements = body.webhooks.map(
      ({ webhookId, expectedVersion }) => ({
        webhookId,
        expectedVersion,
      }),
    );
    expect(
      matchesExactWebhookSecretRotationSet(replacements, [
        { id: "wh-a", version: 2 },
        { id: "wh-b", version: 4 },
      ]),
    ).toBe(true);
    expect(
      matchesExactWebhookSecretRotationSet(replacements.slice(1), [
        { id: "wh-a", version: 2 },
        { id: "wh-b", version: 4 },
      ]),
    ).toBe(false);
    expect(
      matchesExactWebhookSecretRotationSet(replacements, [
        { id: "wh-a", version: 3 },
        { id: "wh-b", version: 4 },
      ]),
    ).toBe(false);
    expect(
      matchesExactWebhookSecretRotationSet(replacements, [
        { id: "wh-a", version: 2 },
        { id: "wh-b", version: 4 },
        { id: "wh-c", version: 1 },
      ]),
    ).toBe(false);
  });
});
