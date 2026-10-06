export type JsonSchema = {
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
  const?: unknown;
  [key: string]: unknown;
};

function singletonLiteral(schema: JsonSchema | undefined): unknown | undefined {
  if (!schema) return undefined;
  if (Object.hasOwn(schema, "const")) return schema.const;
  return Array.isArray(schema.enum) && schema.enum.length === 1
    ? schema.enum[0]
    : undefined;
}

function areDisjoint(left: JsonSchema, right: JsonSchema): boolean {
  const leftRequired = new Set(left.required ?? []);
  const rightRequired = new Set(right.required ?? []);
  for (const property of leftRequired) {
    if (!rightRequired.has(property)) continue;
    const leftValue = singletonLiteral(left.properties?.[property]);
    const rightValue = singletonLiteral(right.properties?.[property]);
    if (
      leftValue !== undefined &&
      rightValue !== undefined &&
      leftValue !== rightValue
    )
      return true;
  }
  return false;
}

export function promoteDisjointAnyOf(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...schema };
  if (Array.isArray(result.anyOf) && result.anyOf.length > 1) {
    const branches = result.anyOf;
    const pairwiseDisjoint = branches.every((branch, index) =>
      branches.slice(index + 1).every((other) => areDisjoint(branch, other)),
    );
    if (pairwiseDisjoint) {
      delete result.anyOf;
      result.oneOf = branches;
    }
  }
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? promoteDisjointAnyOf(item as JsonSchema)
          : item,
      );
    } else if (value && typeof value === "object") {
      result[key] = promoteDisjointAnyOf(value as JsonSchema);
    }
  }
  return result;
}

export function retainStepUpChallengeOneOf(document: JsonSchema): JsonSchema {
  const paths = document.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths))
    return document;
  const route = (paths as Record<string, JsonSchema>)["/me/step-up/challenges"];
  const operation = route?.post;
  if (!operation || typeof operation !== "object" || Array.isArray(operation))
    return document;
  const body = (operation as JsonSchema).requestBody;
  if (!body || typeof body !== "object" || Array.isArray(body)) return document;
  const content = (body as JsonSchema).content;
  if (!content || typeof content !== "object" || Array.isArray(content))
    return document;
  const mediaType = (content as Record<string, JsonSchema>)["application/json"];
  if (!mediaType || typeof mediaType !== "object") return document;
  const schema = mediaType.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    return document;

  (mediaType as JsonSchema).schema = promoteDisjointAnyOf(schema as JsonSchema);
  return document;
}
