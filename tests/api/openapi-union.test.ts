import { describe, expect, it } from "vitest";
import {
  type JsonSchema,
  promoteDisjointAnyOf,
  retainStepUpChallengeOneOf,
} from "../../apps/api/src/openapi-union";

describe("promoteDisjointAnyOf", () => {
  it("retains oneOf when required operation literals prove branches disjoint", () => {
    const schema: JsonSchema = {
      anyOf: [
        {
          type: "object",
          required: ["kind", "operation"],
          properties: {
            kind: { type: "string", enum: ["operation"] },
            operation: { type: "string", enum: ["metrics_token_rotate"] },
          },
        },
        {
          type: "object",
          required: ["kind", "operation"],
          properties: {
            kind: { type: "string", enum: ["operation"] },
            operation: { type: "string", enum: ["mfa_reset"] },
          },
        },
        {
          type: "object",
          required: ["kind"],
          properties: { kind: { type: "string", enum: ["pending_action"] } },
        },
      ],
    };

    expect(promoteDisjointAnyOf(schema)).toEqual({ oneOf: schema.anyOf });
  });

  it("keeps anyOf when branch overlap cannot be ruled out", () => {
    const schema: JsonSchema = {
      anyOf: [
        { type: "object", properties: { value: { type: "string" } } },
        { type: "object", properties: { other: { type: "string" } } },
      ],
    };

    expect(promoteDisjointAnyOf(schema)).toEqual(schema);
  });

  it("corrects only the challenge request and preserves the step-up contract", () => {
    const disjoint = {
      anyOf: [
        {
          type: "object",
          required: ["operation"],
          properties: { operation: { type: "string", enum: ["rotate"] } },
        },
        {
          type: "object",
          required: ["operation"],
          properties: { operation: { type: "string", enum: ["revoke"] } },
        },
      ],
    };
    const document: JsonSchema = {
      paths: {
        "/me/step-up/challenges": {
          post: {
            requestBody: {
              content: {
                "application/json": { schema: structuredClone(disjoint) },
              },
            },
          },
        },
        "/me/step-up": {
          post: {
            requestBody: {
              content: {
                "application/json": { schema: structuredClone(disjoint) },
              },
            },
          },
        },
      },
    };

    const result = retainStepUpChallengeOneOf(document);
    const paths = result.paths as Record<string, JsonSchema>;
    const challenge = paths["/me/step-up/challenges"]!.post as JsonSchema;
    const stepUp = paths["/me/step-up"]!.post as JsonSchema;
    const challengeSchema = (
      (challenge.requestBody as JsonSchema).content as Record<
        string,
        JsonSchema
      >
    )["application/json"]!.schema as JsonSchema;
    const stepUpSchema = (
      (stepUp.requestBody as JsonSchema).content as Record<string, JsonSchema>
    )["application/json"]!.schema as JsonSchema;
    expect(challengeSchema.oneOf).toHaveLength(2);
    expect(challengeSchema.anyOf).toBeUndefined();
    expect(stepUpSchema.anyOf).toHaveLength(2);
    expect(stepUpSchema.oneOf).toBeUndefined();
  });
});
