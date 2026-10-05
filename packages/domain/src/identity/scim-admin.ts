import { parseScimProfileAttributeMapping } from "./profile-mapping.js";
import {
  parseScimMatchAttributes,
  type ScimMatchAttributes,
} from "./scim-match-attributes.js";
import type { ScimProfileAttributeMapping } from "./types.js";

export type ScimAdminRequest =
  | {
      configVersion: number;
      kind: "settings";
      enabled?: boolean;
      allowedResources?: readonly ("users" | "groups")[];
      lifecyclePolicy?: "end_memberships" | "keep_memberships";
      matchAttributes?: ScimMatchAttributes;
    }
  | {
      configVersion: number;
      kind: "mapping_create";
      externalGroupId: string;
      externalGroupNameSnapshot: string | null;
      roleId: string;
      scope: "organisation" | "workspace";
      scopeId?: string;
      enabled: boolean;
    }
  | {
      configVersion: number;
      kind: "mapping_update";
      mappingId: string;
      externalGroupNameSnapshot?: string | null;
      roleId?: string;
      scopeId?: string;
      enabled?: boolean;
    }
  | {
      configVersion: number;
      kind: "attribute_mapping";
      attributeMapping: ScimProfileAttributeMapping;
    };

export type ScimAdminValidation =
  | { ok: true; value: ScimAdminRequest }
  | {
      ok: false;
      reason:
        | "invalid_shape"
        | "invalid_version"
        | "invalid_settings"
        | "invalid_mapping"
        | "invalid_attribute_mapping";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeDisplay(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const bytes = new TextEncoder().encode(value).length;
  return (
    bytes > 0 &&
    bytes <= 255 &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  );
}

function isNonEmptyOpaqueId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const bytes = new TextEncoder().encode(value).length;
  return (
    bytes > 0 &&
    bytes <= 255 &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  );
}

export function validateScimAdminRequest(raw: unknown): ScimAdminValidation {
  if (!isRecord(raw) || !Number.isSafeInteger(raw.configVersion))
    return { ok: false, reason: "invalid_version" };
  const configVersion = raw.configVersion as number;
  if (configVersion < 1) return { ok: false, reason: "invalid_version" };
  if (raw.kind === "settings") {
    const fields = [
      "enabled",
      "allowedResources",
      "lifecyclePolicy",
      "matchAttributes",
    ] as const;
    if (
      !hasOnlyKeys(raw, ["configVersion", "kind", ...fields]) ||
      !fields.some((field) => Object.hasOwn(raw, field)) ||
      (Object.hasOwn(raw, "enabled") && typeof raw.enabled !== "boolean") ||
      (Object.hasOwn(raw, "lifecyclePolicy") &&
        raw.lifecyclePolicy !== "end_memberships" &&
        raw.lifecyclePolicy !== "keep_memberships")
    )
      return { ok: false, reason: "invalid_settings" };
    let allowedResources: readonly ("users" | "groups")[] | undefined;
    if (Object.hasOwn(raw, "allowedResources")) {
      if (
        !Array.isArray(raw.allowedResources) ||
        raw.allowedResources.some(
          (item) => item !== "users" && item !== "groups",
        ) ||
        !raw.allowedResources.includes("users") ||
        new Set(raw.allowedResources).size !== raw.allowedResources.length
      )
        return { ok: false, reason: "invalid_settings" };
      allowedResources = [
        "users",
        ...(raw.allowedResources.includes("groups") ? ["groups" as const] : []),
      ];
    }
    let matchAttributes: ScimMatchAttributes | undefined;
    if (Object.hasOwn(raw, "matchAttributes")) {
      const parsed = parseScimMatchAttributes(raw.matchAttributes);
      if (!parsed.ok) return { ok: false, reason: "invalid_settings" };
      matchAttributes = parsed.value;
    }
    return {
      ok: true,
      value: {
        configVersion,
        kind: "settings",
        ...(Object.hasOwn(raw, "enabled")
          ? { enabled: raw.enabled as boolean }
          : {}),
        ...(allowedResources ? { allowedResources } : {}),
        ...(Object.hasOwn(raw, "lifecyclePolicy")
          ? {
              lifecyclePolicy: raw.lifecyclePolicy as
                | "end_memberships"
                | "keep_memberships",
            }
          : {}),
        ...(matchAttributes ? { matchAttributes } : {}),
      },
    };
  }
  if (raw.kind === "mapping_create") {
    if (
      !hasOnlyKeys(raw, [
        "configVersion",
        "kind",
        "externalGroupId",
        "externalGroupNameSnapshot",
        "roleId",
        "scope",
        "scopeId",
        "enabled",
      ]) ||
      !isNonEmptyOpaqueId(raw.externalGroupId) ||
      !(
        raw.externalGroupNameSnapshot === undefined ||
        isSafeDisplay(raw.externalGroupNameSnapshot)
      ) ||
      typeof raw.roleId !== "string" ||
      raw.roleId.length === 0 ||
      (raw.scope !== "organisation" && raw.scope !== "workspace") ||
      (raw.scope === "workspace" &&
        (typeof raw.scopeId !== "string" || raw.scopeId.length === 0)) ||
      (raw.scope === "organisation" && Object.hasOwn(raw, "scopeId")) ||
      (raw.enabled !== undefined && typeof raw.enabled !== "boolean")
    )
      return { ok: false, reason: "invalid_mapping" };
    return {
      ok: true,
      value: {
        configVersion,
        kind: "mapping_create",
        externalGroupId: raw.externalGroupId,
        externalGroupNameSnapshot: raw.externalGroupNameSnapshot ?? null,
        roleId: raw.roleId,
        scope: raw.scope,
        ...(raw.scopeId === undefined
          ? {}
          : { scopeId: raw.scopeId as string }),
        enabled: raw.enabled ?? true,
      },
    };
  }
  if (raw.kind === "mapping_update") {
    const fields = [
      "externalGroupNameSnapshot",
      "roleId",
      "scopeId",
      "enabled",
    ] as const;
    if (
      !hasOnlyKeys(raw, ["configVersion", "kind", "mappingId", ...fields]) ||
      typeof raw.mappingId !== "string" ||
      raw.mappingId.length === 0 ||
      !fields.some((field) => Object.hasOwn(raw, field)) ||
      (Object.hasOwn(raw, "externalGroupNameSnapshot") &&
        !isSafeDisplay(raw.externalGroupNameSnapshot)) ||
      (Object.hasOwn(raw, "roleId") &&
        (typeof raw.roleId !== "string" || raw.roleId.length === 0)) ||
      (Object.hasOwn(raw, "scopeId") &&
        (typeof raw.scopeId !== "string" || raw.scopeId.length === 0)) ||
      (Object.hasOwn(raw, "enabled") && typeof raw.enabled !== "boolean")
    )
      return { ok: false, reason: "invalid_mapping" };
    return {
      ok: true,
      value: {
        configVersion,
        kind: "mapping_update",
        mappingId: raw.mappingId,
        ...(Object.hasOwn(raw, "externalGroupNameSnapshot")
          ? {
              externalGroupNameSnapshot: raw.externalGroupNameSnapshot as
                | string
                | null,
            }
          : {}),
        ...(Object.hasOwn(raw, "roleId")
          ? { roleId: raw.roleId as string }
          : {}),
        ...(Object.hasOwn(raw, "scopeId")
          ? { scopeId: raw.scopeId as string }
          : {}),
        ...(Object.hasOwn(raw, "enabled")
          ? { enabled: raw.enabled as boolean }
          : {}),
      },
    };
  }
  if (raw.kind === "attribute_mapping") {
    if (!hasOnlyKeys(raw, ["configVersion", "kind", "attributeMapping"]))
      return { ok: false, reason: "invalid_attribute_mapping" };
    const mapping = parseScimProfileAttributeMapping(raw.attributeMapping);
    return mapping.ok
      ? {
          ok: true,
          value: {
            configVersion,
            kind: "attribute_mapping",
            attributeMapping: mapping.value,
          },
        }
      : { ok: false, reason: "invalid_attribute_mapping" };
  }
  return { ok: false, reason: "invalid_shape" };
}

export function canonicalScimAdminRequest(
  connectionId: string,
  request: ScimAdminRequest,
): string {
  const routeKey = "PATCH /api/instance/identity-connections/{id}/scim";
  const canonicalRequest = (() => {
    switch (request.kind) {
      case "settings":
        return {
          configVersion: request.configVersion,
          kind: request.kind,
          ...(request.enabled === undefined
            ? {}
            : { enabled: request.enabled }),
          ...(request.allowedResources === undefined
            ? {}
            : { allowedResources: request.allowedResources }),
          ...(request.lifecyclePolicy === undefined
            ? {}
            : { lifecyclePolicy: request.lifecyclePolicy }),
          ...(request.matchAttributes === undefined
            ? {}
            : { matchAttributes: request.matchAttributes }),
        };
      case "mapping_create":
        return {
          configVersion: request.configVersion,
          kind: request.kind,
          externalGroupId: request.externalGroupId,
          externalGroupNameSnapshot: request.externalGroupNameSnapshot,
          roleId: request.roleId,
          scope: request.scope,
          ...(request.scopeId === undefined
            ? {}
            : { scopeId: request.scopeId }),
          enabled: request.enabled,
        };
      case "mapping_update":
        return {
          configVersion: request.configVersion,
          kind: request.kind,
          mappingId: request.mappingId,
          ...(request.externalGroupNameSnapshot === undefined
            ? {}
            : { externalGroupNameSnapshot: request.externalGroupNameSnapshot }),
          ...(request.roleId === undefined ? {} : { roleId: request.roleId }),
          ...(request.scopeId === undefined
            ? {}
            : { scopeId: request.scopeId }),
          ...(request.enabled === undefined
            ? {}
            : { enabled: request.enabled }),
        };
      case "attribute_mapping":
        return {
          configVersion: request.configVersion,
          kind: request.kind,
          attributeMapping: {
            version: request.attributeMapping.version,
            name: request.attributeMapping.name,
            email: request.attributeMapping.email,
            jobTitle: request.attributeMapping.jobTitle,
            locale: request.attributeMapping.locale,
          },
        };
    }
  })();
  return JSON.stringify({ routeKey, connectionId, request: canonicalRequest });
}
