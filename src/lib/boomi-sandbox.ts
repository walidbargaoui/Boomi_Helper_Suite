/**
 * @legacy Boomi Companion Transition — direct publish has been retired.
 * The Boomi API client and publish safety checks are preserved for
 * backward compatibility. The primary workflow now uses Companion
 * package generation instead. See docs/boomi-companion-transition-plan.md.
 *
 * When BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH is not set to "true",
 * the /api/boomi/publish route returns 410 Gone.
 */

import { XMLParser } from "fast-xml-parser";
import { diffLines } from "diff";
import { z } from "zod";
import type { BoomiComponentDraft, MappingSet, Project } from "@/lib/domain";
import {
  extractBoomiComponentId,
  extractProfileElementKeys,
  profileComponentType as profileComponentTypeForSafety,
} from "@/lib/boomi-xml";

export const boomiConnectionSchema = z.object({
  accountId: z.string().min(1).max(120),
  environmentName: z.string().min(1).max(120),
  baseUrl: z.string().url().max(500),
  authMode: z.enum(["Basic API Token"]).default("Basic API Token"),
  apiUsername: z.string().min(1).max(200),
  apiPassword: z.string().min(1).max(500),
  mode: z.enum(["mock", "sandbox"]).default("sandbox"),
});

export type BoomiConnectionInput = z.infer<typeof boomiConnectionSchema>;

export const boomiComponentLookupSchema = z.object({
  componentId: z.string().min(1).max(200).optional(),
  componentType: z.string().min(1).max(200).optional(),
  componentName: z.string().min(1).max(500).optional(),
});

export type BoomiComponentLookupInput = z.infer<typeof boomiComponentLookupSchema>;

export const boomiTemplateImportSchema = z.object({
  componentId: z.string().min(1).max(200),
  componentType: z.string().min(1).max(200),
  componentName: z.string().min(1).max(500),
  templateXml: z.string().optional(),
  version: z.number().int().min(1).optional(),
});

export type BoomiTemplateImportInput = z.infer<typeof boomiTemplateImportSchema>;

export type BoomiConnectionTestResult = {
  ok: boolean;
  message: string;
  accountId?: string;
  environmentName?: string;
  availableComponents?: number;
};

export type BoomiComponentInfo = {
  componentId: string;
  version: number;
  currentVersion: boolean;
  name: string;
  type: string;
  lastModified?: string;
  status: string;
};

export type BoomiTemplateImportResult = {
  componentId: string;
  componentName: string;
  componentType: string;
  templateXml: string;
  validationIssues: string[];
  size: number;
};

export type BoomiPublishResult = {
  ok: boolean;
  status: number;
  noop?: boolean;
  action: "create" | "update";
  componentId: string;
  componentName: string;
  componentType: string;
  version?: number;
  responseXml: string;
  errorDetail?: string;
};

import { logger } from "@/lib/logger";

const debugLog = (...args: unknown[]) => {
  if (process.env.BOOMI_HELPER_DEBUG === "1") {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    logger.debug(msg);
  }
};

/**
 * Strip any existing BOOMI_TOKEN. prefix from a username, then
 * re-add it. Companion scripts always use BOOMI_TOKEN.{username}
 * for Basic auth, and the .env username is stored without the prefix.
 * This helper makes our direct API calls match Companion behaviour.
 */
export function companionAuth(username: string, password: string): { user: string; auth: string } {
  const bare = username.replace(/^BOOMI_TOKEN\./i, "").trim();
  const user = `BOOMI_TOKEN.${bare}`;
  const auth = Buffer.from(`${user}:${password}`).toString("base64");
  return { user, auth };
}

export const BOOMI_ERRORS = {
  CONNECTION_FAILED: "Connection failed",
  AUTH_FAILED: "Authentication failed. Check API username and password.",
  ACCESS_DENIED: "Access denied. Check that the account ID is correct and the token has Build Read access.",
  ACCOUNT_NOT_FOUND: "Account not found. Check the account ID.",
  LOOKUP_FAILED: "Component lookup failed",
  IMPORT_FAILED: "Template import failed",
  PUBLISH_BLOCKED: "Connection is not in sandbox mode.",
  TIMEOUT: "Connection timed out after 10 seconds.",
} as const;

export { escapeXml } from "@/lib/xml-utils";

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        debugLog(`[Boomi Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

let lastBoomiCallTime = 0;

export function boomiQueue<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const delay = Math.max(0, 100 - (now - lastBoomiCallTime));
  lastBoomiCallTime = now + delay;
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      fn().then(resolve, reject);
    }, delay);
  });
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
});

export function normalizeBoomiBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "").replace(/\/api\/rest\/v\d+$/i, "");
}

function parseBoomiBoolean(value: unknown) {
  return value === true || String(value).toLowerCase() === "true";
}

export function validateComponentXml(xml: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!xml.trim()) issues.push("XML is empty.");
  if (!xml.includes("Component")) issues.push("Expected a Boomi Component XML root.");

  try {
    const parsed = xmlParser.parse(xml);
    const component = parsed.Component ?? parsed["bns:Component"];
    const type = component?.type;
    const supportedTypes = [
      "transform.map",
      "transform.function",
      "profile.flatfile",
      "profile.xml",
      "profile.json",
      "profile.db",
      "process",
      "processproperty",
      "connector-settings",
      "connector-action",
    ];
    if (type && !supportedTypes.includes(type)) {
      issues.push(`Unsupported component type: ${type}.`);
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Invalid XML.");
  }

  return { ok: issues.length === 0, issues };
}

export async function testBoomiConnection(input: BoomiConnectionInput): Promise<BoomiConnectionTestResult> {
  if (input.mode === "mock") {
    return {
      ok: true,
      message: "Mock connection test successful. No real API calls made.",
      accountId: input.accountId,
      environmentName: input.environmentName,
      availableComponents: 0,
    };
  }

  try {
    const { auth } = companionAuth(input.apiUsername, input.apiPassword);
    const baseUrl = normalizeBoomiBaseUrl(input.baseUrl);
    const url = `${baseUrl}/api/rest/v1/${input.accountId}/ComponentMetadata/query`;
    const queryBody = {
      QueryFilter: {
        expression: {
          operator: "EQUALS",
          property: "currentVersion",
          argument: ["true"],
        },
      },
    };

    debugLog(`[Boomi Connection Test] URL: ${url}`);

    const response = await withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(queryBody),
          signal: controller.signal,
        });
        if (res.status >= 500) {
          throw new Error(`${BOOMI_ERRORS.CONNECTION_FAILED}: HTTP ${res.status}`);
        }
        return res;
      } finally {
        clearTimeout(timeout);
      }
    });

    const responseText = await response.text().catch(() => "");
    debugLog(`[Boomi Connection Test] Status: ${response.status}`);
    debugLog(`[Boomi Connection Test] Body: ${responseText.slice(0, 500)}`);

    if (response.ok) {
      try {
        const data = JSON.parse(responseText) as { numberOfResults?: number };
        return {
          ok: true,
          message: `Connected to ${input.environmentName} (${input.accountId}). Found ${data.numberOfResults ?? 0} components.`,
          accountId: input.accountId,
          environmentName: input.environmentName,
          availableComponents: data.numberOfResults ?? 0,
        };
      } catch {
        return {
          ok: true,
          message: `Connected to ${input.environmentName} (${input.accountId}).`,
          accountId: input.accountId,
          environmentName: input.environmentName,
        };
      }
    }

    if (response.status === 401) {
      return {
        ok: false,
        message: BOOMI_ERRORS.AUTH_FAILED,
      };
    }

    if (response.status === 403) {
      return {
        ok: false,
        message: BOOMI_ERRORS.ACCESS_DENIED,
      };
    }

    if (response.status === 404) {
      return {
        ok: false,
        message: BOOMI_ERRORS.ACCOUNT_NOT_FOUND,
      };
    }

    return {
      ok: false,
      message: `${BOOMI_ERRORS.CONNECTION_FAILED}: HTTP ${response.status}. ${responseText.slice(0, 200)}`,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, message: BOOMI_ERRORS.TIMEOUT };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown connection error.",
    };
  }
}

export async function lookupBoomiComponents(
  input: BoomiConnectionInput,
  lookup: BoomiComponentLookupInput,
): Promise<{ components: BoomiComponentInfo[]; total: number }> {
  if (input.mode === "mock") {
    const mockComponents: BoomiComponentInfo[] = [
      { componentId: "mock-map-001", version: 1, currentVersion: true, name: "Order Intake Map", type: "transform.map", status: "sandbox" },
      { componentId: "mock-profile-src", version: 1, currentVersion: true, name: "PO_SEIREN TSV", type: "profile.flatfile", status: "sandbox" },
      { componentId: "mock-profile-dst", version: 1, currentVersion: true, name: "ServiceNow Order", type: "profile.json", status: "sandbox" },
      { componentId: "mock-process-001", version: 1, currentVersion: true, name: "SRSN001 Process", type: "process", status: "sandbox" },
    ];

    let filtered = mockComponents;
    if (lookup.componentType) {
      filtered = filtered.filter((c) => c.type === lookup.componentType);
    }
    if (lookup.componentName) {
      const term = lookup.componentName.toLowerCase();
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(term));
    }

    return { components: filtered, total: filtered.length };
  }

  try {
    const { auth } = companionAuth(input.apiUsername, input.apiPassword);
    const baseUrl = normalizeBoomiBaseUrl(input.baseUrl);
    const url = `${baseUrl}/api/rest/v1/${input.accountId}/ComponentMetadata/query`;

    let queryBody: Record<string, unknown>;

    if (lookup.componentId || (lookup.componentName && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lookup.componentName))) {
      const cid = lookup.componentId || lookup.componentName!;
      queryBody = {
        QueryFilter: {
          expression: {
            operator: "EQUALS",
            property: "componentId",
            argument: [cid],
          },
        },
      };
    } else if (lookup.componentName) {
      queryBody = {
        QueryFilter: {
          expression: {
            operator: "LIKE",
            property: "name",
            argument: [`%${lookup.componentName}%`],
          },
        },
      };
    } else if (lookup.componentType) {
      queryBody = {
        QueryFilter: {
          expression: {
            operator: "EQUALS",
            property: "type",
            argument: [lookup.componentType],
          },
        },
      };
    } else {
      queryBody = {
        QueryFilter: {
          expression: {
            operator: "EQUALS",
            property: "currentVersion",
            argument: ["true"],
          },
        },
      };
    }

    debugLog(`[Boomi Lookup] URL: ${url}`);
    debugLog(`[Boomi Lookup] Body: ${JSON.stringify(queryBody)}`);

    const response = await withRetry(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(queryBody),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status >= 500) {
        throw new Error(`${BOOMI_ERRORS.LOOKUP_FAILED}: HTTP ${res.status}`);
      }
      return res;
    });

    const responseText = await response.text().catch(() => "");
    debugLog(`[Boomi Lookup] Status: ${response.status}`);
    debugLog(`[Boomi Lookup] Body: ${responseText.slice(0, 500)}`);

    if (!response.ok) {
      throw new Error(`${BOOMI_ERRORS.LOOKUP_FAILED}: HTTP ${response.status}. ${responseText.slice(0, 200)}`);
    }

    const data = JSON.parse(responseText) as { result?: Array<Record<string, unknown>>; numberOfResults?: number };
    const items = data.result ?? [];

    let components = items.map((item) => ({
      componentId: String(item.componentId ?? ""),
      version: Number(item.version ?? 0),
      currentVersion: parseBoomiBoolean(item.currentVersion),
      name: String(item.name ?? ""),
      type: String(item.type ?? ""),
      lastModified: item.modifiedDate ? String(item.modifiedDate) : undefined,
      status: parseBoomiBoolean(item.deleted) ? "deleted" : "active",
    }));

    if (lookup.componentType) {
      components = components.filter((component) => component.type === lookup.componentType);
    }

    components = components.filter((component) => component.status !== "deleted");

    components.sort((a, b) => {
      if (a.currentVersion !== b.currentVersion) return a.currentVersion ? -1 : 1;
      return b.version - a.version;
    });

    return {
      components,
      total: components.length,
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Unknown lookup error.");
  }
}

export async function importBoomiTemplate(
  input: BoomiConnectionInput,
  templateInput: BoomiTemplateImportInput,
): Promise<BoomiTemplateImportResult> {
  if (input.mode === "mock") {
    const templateXml =
      templateInput.templateXml?.trim() ||
      `<bns:Component type="${templateInput.componentType}" name="${templateInput.componentName}"><bns:object /></bns:Component>`;
    const validation = validateComponentXml(templateXml);
    return {
      componentId: templateInput.componentId,
      componentName: templateInput.componentName,
      componentType: templateInput.componentType,
      templateXml,
      validationIssues: validation.issues,
      size: templateXml.length,
    };
  }

  try {
    const { auth } = companionAuth(input.apiUsername, input.apiPassword);
    const baseUrl = normalizeBoomiBaseUrl(input.baseUrl);
    const versionSuffix = templateInput.version ? `~${templateInput.version}` : "";
    const url = `${baseUrl}/api/rest/v1/${input.accountId}/Component/${templateInput.componentId}${versionSuffix}`;

    debugLog(`[Boomi Import] URL: ${url}`);

    const response = await withRetry(async () => {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/xml",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status >= 500) {
        throw new Error(`${BOOMI_ERRORS.IMPORT_FAILED}: HTTP ${res.status}`);
      }
      return res;
    });

    if (!response.ok) {
      throw new Error(`${BOOMI_ERRORS.IMPORT_FAILED}: HTTP ${response.status}`);
    }

    const xml = await response.text();
    const validation = validateComponentXml(xml);
    return {
      componentId: templateInput.componentId,
      componentName: templateInput.componentName,
      componentType: templateInput.componentType,
      templateXml: xml,
      validationIssues: validation.issues,
      size: xml.length,
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Unknown import error.");
  }
}

export function publishTargetComponentId(draft: Pick<BoomiComponentDraft, "componentId"> & { proposedXml?: string }): string {
  const xmlComponentId = draft.proposedXml ? extractBoomiComponentId(draft.proposedXml) : null;
  if (xmlComponentId && !xmlComponentId.startsWith("draft-") && !xmlComponentId.startsWith("cmp-")) {
    return xmlComponentId;
  }
  return draft.componentId;
}

export function publishActionForDraft(draft: Pick<BoomiComponentDraft, "componentId"> & { proposedXml?: string }): "create" | "update" {
  const componentId = publishTargetComponentId(draft);
  if (componentId.startsWith("draft-") || componentId.startsWith("cmp-")) return "create";
  return "update";
}

function parsePublishedComponentMetadata(xml: string) {
  if (!xml.trim()) return {};
  try {
    const parsed = xmlParser.parse(xml);
    const component = parsed.Component ?? parsed["bns:Component"];
    const version = Number(component?.version);
    return {
      componentId: typeof component?.componentId === "string" ? component.componentId : undefined,
      version: Number.isFinite(version) ? version : undefined,
    };
  } catch {
    return {};
  }
}

export async function publishBoomiComponent(
  input: BoomiConnectionInput,
  draft: Pick<BoomiComponentDraft, "componentId" | "componentName" | "componentType" | "proposedXml">,
): Promise<BoomiPublishResult> {
  if (input.mode !== "sandbox") {
    return {
      ok: false,
      status: 0,
      action: publishActionForDraft(draft),
      componentId: draft.componentId,
      componentName: draft.componentName,
      componentType: draft.componentType,
      responseXml: "",
      errorDetail: BOOMI_ERRORS.PUBLISH_BLOCKED,
    };
  }

  const { auth } = companionAuth(input.apiUsername, input.apiPassword);
  const baseUrl = normalizeBoomiBaseUrl(input.baseUrl);
  const action = publishActionForDraft(draft);
  const targetComponentId = publishTargetComponentId(draft);
  const path = action === "create"
    ? "Component"
    : `Component/${encodeURIComponent(targetComponentId)}`;
  const url = `${baseUrl}/api/rest/v1/${input.accountId}/${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/xml",
      "Accept": "application/xml, text/xml, application/json",
    },
    body: draft.proposedXml,
  });
  const responseXml = await response.text().catch(() => "");
  const metadata = parsePublishedComponentMetadata(responseXml);

  if (!response.ok) {
    if (response.status === 403 && /same configuration values as the previous version/i.test(responseXml)) {
      return {
        ok: true,
        noop: true,
        status: response.status,
        action,
        componentId: metadata.componentId ?? targetComponentId,
        componentName: draft.componentName,
        componentType: draft.componentType,
        version: metadata.version,
        responseXml,
      };
    }
    return {
      ok: false,
      status: response.status,
      action,
      componentId: metadata.componentId ?? targetComponentId,
      componentName: draft.componentName,
      componentType: draft.componentType,
      version: metadata.version,
      responseXml,
      errorDetail: `Boomi publish failed: HTTP ${response.status}. ${responseXml.slice(0, 500)}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    action,
    componentId: metadata.componentId ?? targetComponentId,
    componentName: draft.componentName,
    componentType: draft.componentType,
    version: metadata.version,
    responseXml,
  };
}

/**
 * Rollback a component to a prior version by re-publishing the templateXml
 * from a publish history event as an update. Boomi versions are forward-only;
 * this is functionally a revert via re-publish.
 */
export async function rollbackBoomiComponent(
  input: BoomiConnectionInput,
  historyEvent: { componentId: string; componentName: string; componentType: string; requestXml: string },
): Promise<BoomiPublishResult> {
  if (input.mode !== "sandbox") {
    return {
      ok: false,
      status: 0,
      action: "update",
      componentId: historyEvent.componentId,
      componentName: historyEvent.componentName,
      componentType: historyEvent.componentType,
      responseXml: "",
      errorDetail: BOOMI_ERRORS.PUBLISH_BLOCKED,
    };
  }

  if (!historyEvent.requestXml?.trim()) {
    return {
      ok: false,
      status: 0,
      action: "update",
      componentId: historyEvent.componentId,
      componentName: historyEvent.componentName,
      componentType: historyEvent.componentType,
      responseXml: "",
      errorDetail: "No request XML in publish history event.",
    };
  }

  const { auth } = companionAuth(input.apiUsername, input.apiPassword);
  const baseUrl = normalizeBoomiBaseUrl(input.baseUrl);
  const url = `${baseUrl}/api/rest/v1/${input.accountId}/Component/${encodeURIComponent(historyEvent.componentId)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/xml",
      "Accept": "application/xml, text/xml, application/json",
    },
    body: historyEvent.requestXml,
  });
  const responseXml = await response.text().catch(() => "");
  const metadata = parsePublishedComponentMetadata(responseXml);

  if (!response.ok) {
    if (response.status === 403 && /same configuration values as the previous version/i.test(responseXml)) {
      return {
        ok: true,
        noop: true,
        status: response.status,
        action: "update",
        componentId: metadata.componentId ?? historyEvent.componentId,
        componentName: historyEvent.componentName,
        componentType: historyEvent.componentType,
        version: metadata.version,
        responseXml,
      };
    }
    return {
      ok: false,
      status: response.status,
      action: "update",
      componentId: metadata.componentId ?? historyEvent.componentId,
      componentName: historyEvent.componentName,
      componentType: historyEvent.componentType,
      version: metadata.version,
      responseXml,
      errorDetail: `Rollback publish failed: HTTP ${response.status}. ${responseXml.slice(0, 500)}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    action: "update",
    componentId: metadata.componentId ?? historyEvent.componentId,
    componentName: historyEvent.componentName,
    componentType: historyEvent.componentType,
    version: metadata.version,
    responseXml,
  };
}

/**
 * Scan a Boomi process XML for referenced component UUIDs.
 *
 * Boomi processes carry their dependencies in two main shapes:
 *   - `<shape shapetype="..."><configuration componentId="UUID" .../></shape>` for
 *     connector actions, maps, decisions referencing rules, etc.
 *   - Attribute-level references inside shape config: `<map componentId="UUID"/>`,
 *     `<route componentId="UUID"/>`, `<connector connectorId="UUID"/>`.
 *
 * Returns deduped UUIDs with an inferred role hint based on the nearest `<shape>` ancestor's
 * `shapetype`. `selfComponentId` is excluded from the result.
 */
export function extractProcessDependencies(
  processXml: string,
  selfComponentId?: string,
): Array<{ componentId: string; role: string; shapeType?: string }> {
  if (!processXml || !processXml.trim()) return [];
  const uuidPattern = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  const out = new Map<string, { componentId: string; role: string; shapeType?: string }>();

  // Walk the XML linearly, tracking the most recent <shape shapetype="..."> opening.
  // When we see a componentId/connectorId attribute, attribute it to that shape.
  const shapeOpenRe = /<shape\s+([^>]*)>/g;
  const shapeCloseIdx: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = shapeOpenRe.exec(processXml))) {
    shapeCloseIdx.push(match.index);
  }

  // Pull every UUID-bearing attribute, then assign role from the most recent shape.
  const refRe = /(componentId|connectorId|componentReference|mapId|profileId)="([^"]+)"/g;
  while ((match = refRe.exec(processXml))) {
    const value = match[2];
    if (!uuidPattern.test(value)) continue;
    if (selfComponentId && value === selfComponentId) continue;
    // Find nearest preceding shape opening tag
    const pos = match.index;
    let shapeType: string | undefined;
    for (let i = shapeCloseIdx.length - 1; i >= 0; i -= 1) {
      if (shapeCloseIdx[i] >= pos) continue;
      // Inspect the shape tag we found to get shapetype
      const tag = processXml.slice(shapeCloseIdx[i], pos);
      const stMatch = tag.match(/shapetype="([^"]+)"/);
      if (stMatch) shapeType = stMatch[1];
      break;
    }
    const role = (() => {
      if (!shapeType) return "unknown";
      if (shapeType === "map") return "transform.map";
      if (shapeType === "connectoraction") return "connector-action";
      if (shapeType === "connectorshape" || shapeType === "start") return "connector-settings";
      if (shapeType === "businessrules") return "business-rule";
      if (shapeType === "subprocess" || shapeType === "processroute") return "process";
      return shapeType;
    })();
    const existing = out.get(value);
    if (!existing) {
      out.set(value, { componentId: value, role, shapeType });
    } else if (existing.role === "unknown" && role !== "unknown") {
      existing.role = role;
      existing.shapeType = shapeType;
    }
  }
  return [...out.values()];
}

export function computeXmlDiff(templateXml: string, proposedXml: string): string {
  return diffLines(templateXml, proposedXml)
    .map((part) => {
      const prefix = part.added ? "+" : part.removed ? "-" : " ";
      return part.value
        .split("\n")
        .filter(Boolean)
        .map((line) => `${prefix} ${line}`)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

export type PublishSafetyContext = {
  connectionMode?: "mock" | "sandbox";
  mappingSet?: MappingSet;
  sourceProfileTemplateXml?: string;
  destinationProfileTemplateXml?: string;
};

function normalizedFieldName(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Generic template-draft finder used by the dry-run route.
 *
 * Looks up by stable componentId first, then by exact componentName match,
 * then falls back to a singleton rule for transform.map drafts.
 */
export function findTemplateDraft(
  drafts: BoomiComponentDraft[],
  stableComponentId: string,
  componentType: BoomiComponentDraft["componentType"],
  componentName: string,
) {
  const stableDraft = drafts.find((draft) => draft.componentId === stableComponentId && draft.templateXml?.trim());
  if (stableDraft) return stableDraft;
  const normalizedName = componentName.trim().toLowerCase();
  const exactNameDraft = drafts.find(
    (draft) =>
      draft.componentType === componentType
      && draft.componentName.trim().toLowerCase() === normalizedName
      && draft.templateXml?.trim(),
  );
  if (exactNameDraft) return exactNameDraft;

  if (componentType === "transform.map") {
    const mapTemplates = drafts.filter((draft) => draft.componentType === componentType && draft.templateXml?.trim());
    if (mapTemplates.length === 1) return mapTemplates[0];
  }

  return undefined;
}

export function findProfileTemplateDraft(
  drafts: BoomiComponentDraft[],
  profile: Project["profiles"][number] | undefined,
) {
  if (!profile) return undefined;
  const stableComponentId = `draft-profile-${profile.id}`;
  const componentType = profileComponentTypeForSafety(profile);

  // Delegate to the generic finder for the stable-id and exact-name layers.
  const generic = findTemplateDraft(drafts, stableComponentId, componentType, profile.name);
  if (generic) return generic;

  const candidates = drafts.filter(
    (candidate) => candidate.componentType === componentType && candidate.templateXml?.trim(),
  );
  const localFields = new Set(profile.fields.map((field) => normalizedFieldName(field.name)).filter(Boolean));
  if (localFields.size > 0) {
    const scored = candidates
      .map((candidate) => {
        const templateFields = extractProfileElementKeys(candidate.templateXml ?? "");
        let score = 0;
        for (const templateField of templateFields.keys()) {
          if (localFields.has(normalizedFieldName(templateField))) score += 1;
        }
        return { candidate, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1 || scored[0]?.score > (scored[1]?.score ?? 0)) {
      return scored[0].candidate;
    }
  }

  if (profile.fields.length === 0 && candidates.length === 1) {
    return candidates[0];
  }

  return undefined;
}

export function buildPublishSafetyContext(
  project: Project,
  draft: Pick<BoomiComponentDraft, "componentId" | "componentType">,
  connectionMode?: "mock" | "sandbox",
): PublishSafetyContext {
  const mappingSet = draft.componentType === "transform.map" && draft.componentId.startsWith("draft-map-")
    ? project.mappingSets.find((set) => `draft-map-${set.id}` === draft.componentId)
    : undefined;
  const sourceProfile = mappingSet
    ? project.profiles.find((profile) => profile.id === mappingSet.sourceProfileId)
    : undefined;
  const destinationProfile = mappingSet
    ? project.profiles.find((profile) => profile.id === mappingSet.destinationProfileId)
    : undefined;

  return {
    connectionMode,
    mappingSet,
    sourceProfileTemplateXml: findProfileTemplateDraft(project.boomiDrafts, sourceProfile)?.templateXml,
    destinationProfileTemplateXml: findProfileTemplateDraft(project.boomiDrafts, destinationProfile)?.templateXml,
  };
}

function hasXml(value: string | undefined) {
  return Boolean(value?.trim());
}

/**
 * Component types we are willing to PUBLISH to a Boomi sandbox.
 *
 * Deliberately narrow: only transform.map and the four profile flavors we have
 * generators + reconciliation + tests for. Other types (process, connector-settings,
 * connector-action, processproperty) are read/import only — they can be fetched
 * via `GET /Component/{id}` and stored as drafts so dry-run can reference them
 * (e.g. SqlLookup connection UUID resolution), but the app refuses to write them.
 *
 * To enable publish for additional types: (a) implement a real XML generator for
 * the type, (b) add a type-specific test covering shape + reconciliation, and
 * (c) widen this list. See the M8.1 publish-gate lockdown notes in progress.md.
 */
export const PUBLISH_ALLOWED_TYPES = [
  "transform.map",
  "profile.flatfile",
  "profile.json",
  "profile.xml",
  "profile.db",
  // processproperty: deferred until a real XML generator + test are implemented (M9.7.27).
] as const;

/**
 * Component types we are willing to IMPORT into the workspace (template fetch
 * stored on a BoomiComponentDraft so dry-run / SqlLookup can read it). Importing
 * is read-only; publishing is gated by PUBLISH_ALLOWED_TYPES above.
 */
export const IMPORT_ALLOWED_TYPES = [
  ...PUBLISH_ALLOWED_TYPES,
  "process",
  "processproperty",
  "connector-settings",
  "connector-action",
] as const;

export function validatePublishSafety(draft: {
  componentType: string;
  validationStatus: string;
  templateXml?: string;
  diff: string;
}, context?: PublishSafetyContext): { ok: boolean; blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!(PUBLISH_ALLOWED_TYPES as readonly string[]).includes(draft.componentType)) {
    if ((IMPORT_ALLOWED_TYPES as readonly string[]).includes(draft.componentType)) {
      blockers.push(
        `Component type "${draft.componentType}" is read/import-only. Publish is restricted to: ${PUBLISH_ALLOWED_TYPES.join(", ")}.`,
      );
    } else {
      blockers.push(`Component type "${draft.componentType}" is not allowed for sandbox publish.`);
    }
  }

  if (!hasXml(draft.templateXml)) {
    blockers.push("No template XML attached. Import a sandbox template first.");
  }

  if (draft.validationStatus !== "Dry-run valid") {
    blockers.push(`Validation status is "${draft.validationStatus}". Must be "Dry-run valid".`);
  }

  if (context) {
    if (!context.connectionMode) {
      blockers.push("No Boomi connection selected. Select a sandbox connection before publish.");
    } else if (context.connectionMode !== "sandbox") {
      blockers.push("Connection is in mock mode. Switch to a sandbox connection before publish.");
    }
  }

  if (draft.componentType === "transform.map" && context) {
    const mappingSet = context.mappingSet;
    if (!mappingSet) {
      blockers.push("No local mapping set is linked to this map draft.");
    } else {
      if (mappingSet.status !== "Ready for Boomi") {
        blockers.push(`Mapping set status is "${mappingSet.status}". Must be "Ready for Boomi".`);
      }

      if (!hasXml(context.sourceProfileTemplateXml)) {
        blockers.push("Source profile template XML is missing. Import the source profile template first.");
      }

      if (!hasXml(context.destinationProfileTemplateXml)) {
        blockers.push("Destination profile template XML is missing. Import the destination profile template first.");
      }

      const rulesByDestination = new Map<string, string[]>();
      for (const rule of mappingSet.rules) {
        const destinationId = rule.destinationFieldId?.trim();
        if (!destinationId) {
          blockers.push(`Mapping rule ${rule.id} has no destination field.`);
        } else {
          const ids = rulesByDestination.get(destinationId) ?? [];
          ids.push(rule.id);
          rulesByDestination.set(destinationId, ids);
        }

        if (rule.qualityStatus === "error") {
          blockers.push(`Mapping rule ${rule.id} has a mapping-quality error.`);
        } else if (rule.qualityStatus === "warning") {
          warnings.push(`Mapping rule ${rule.id} has a mapping-quality warning.`);
        } else if (rule.qualityStatus === "unchecked") {
          warnings.push(`Mapping rule ${rule.id} has not been checked by mapping quality.`);
        }

        if (rule.reviewed === false || rule.reviewed === undefined) {
          warnings.push(`Mapping rule ${rule.id} is not marked Reviewed.`);
        }

        if (rule.mappingType === "constant") {
          if (!rule.defaultValue?.trim() && !rule.expression?.trim()) {
            blockers.push(`Mapping rule ${rule.id} is a constant without a value.`);
          }
        } else if (!rule.sourceFieldId?.trim() && !rule.expression?.trim()) {
          blockers.push(`Mapping rule ${rule.id} has no source field or expression.`);
        }
      }

      for (const [destinationId, ruleIds] of rulesByDestination) {
        if (ruleIds.length > 1) {
          blockers.push(`Destination field ${destinationId} is mapped by multiple rules: ${ruleIds.join(", ")}.`);
        }
      }

      // Aggregate the per-rule "not reviewed" warnings into a blocker when the
      // ratio crosses a threshold — keeps a single unchecked rule a warning
      // (developer probably just forgot one box) but stops a wholesale publish
      // where the user clearly hasn't done the review pass.
      const allRules = mappingSet.rules;
      if (allRules.length > 0) {
        const unreviewed = allRules.filter((r) => r.reviewed !== true).length;
        if (unreviewed === allRules.length) {
          blockers.push(`No mapping rules are marked Reviewed (${allRules.length} rules). Review and check off rules in the mapping studio before publish.`);
        } else if (unreviewed / allRules.length > 0.5) {
          blockers.push(`More than half of mapping rules (${unreviewed}/${allRules.length}) are not marked Reviewed.`);
        }
      }
    }
  }

  const addedLines = draft.diff.split("\n").filter((line) => line.startsWith("+ ")).length;
  const removedLines = draft.diff.split("\n").filter((line) => line.startsWith("- ")).length;
  if (removedLines > addedLines * 2) {
    warnings.push("Large deletion detected — more than 2x lines removed vs added. Review carefully.");
  }

  if (addedLines > 200) {
    warnings.push(`Large addition (${addedLines} lines). Verify the proposed XML is correct.`);
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

export {
  profileComponentType,
  buildProfileXml as buildProfilePreviewXml,
  buildTransformMapXml as buildMapPreviewXml,
  buildDbProfileXml,
  buildProposedXml,
  patchFlatFileProfile,
  patchJsonProfile,
  patchXmlProfile,
  patchDbProfile,
  patchTransformMap,
  extractBoomiComponentId,
  extractProfileElementKeys,
} from "@/lib/boomi-xml";

export function createDraftFromTemplate(
  project: Project,
  componentName: string,
  componentType: BoomiComponentDraft["componentType"],
  templateXml: string | undefined,
  proposedXml: string,
) {
  const validation = validateComponentXml(proposedXml);
  const diff = templateXml ? computeXmlDiff(templateXml, proposedXml) : `+ ${proposedXml}`;

  return {
    id: `draft-${componentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    componentId: `cmp-${componentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    componentType,
    componentName,
    templateXml,
    proposedXml,
    diff,
    validationStatus: validation.ok && templateXml ? "Dry-run valid" : "Needs template",
    notes:
      validation.issues.length > 0
        ? validation.issues.join(" ")
        : `Generated for ${project.processId}; publish is disabled until a sandbox template is attached.`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies BoomiComponentDraft;
}


