/**
 * @legacy Boomi Companion Transition — v1 direct XML generation has been retired.
 * This module is superseded by boomi-xml-engine.ts which generates Companion-
 * reference-based XML for the direct build pipeline.
 *
 * Preserved only for backward compatibility with the legacy dry-run path
 * and template-patching utilities. See docs/boomi-companion-transition-plan.md
 * and docs/boomi-companion-direct-build-plan.md for details.
 *
 * Two modes per component type:
 *   - From-scratch scaffold when no template is attached (Strategy A fallback).
 *   - Template patching when a template is attached (Strategy B preferred).
 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { BoomiComponentDraft, MappingSet, Profile, ProfileField, Project } from "@/lib/domain";
import { escapeXml } from "@/lib/xml-utils";

const BOOMI_NS = "http://api.platform.boomi.com/";
const BOOMI_XSI = "http://www.w3.org/2001/XMLSchema-instance";

function mapBoomiDataType(field: ProfileField): "character" | "number" | "datetime" | "boolean" {
  const t = (field.dataType ?? "").toLowerCase();
  if (/(^|\b)(int|integer|decimal|number|numeric|long|float|double|amount|price|quantity)(\b|$)/.test(t)) {
    return "number";
  }
  if (/(^|\b)(datetime|timestamp)(\b|$)/.test(t) || /(^|\b)(date|time)(\b|$)/.test(t)) {
    return "datetime";
  }
  if (/(^|\b)(bool|boolean)(\b|$)/.test(t)) {
    return "boolean";
  }
  return "character";
}

function defaultDateFormat(field: ProfileField): string {
  // Default to the Boomi standard pattern. Honor an explicit `format` if the
  // local field carries one (e.g., "yyyy-MM-dd HH:mm:ss" from FMD imports).
  const provided = field.format?.trim();
  if (provided) return provided;
  return "yyyy-MM-dd";
}

function dataFormatElement(boomiType: "character" | "number" | "datetime" | "boolean", field?: ProfileField): string {
  if (boomiType === "number") return "<DataFormat><ProfileNumberFormat/></DataFormat>";
  if (boomiType === "datetime") {
    const pattern = field ? defaultDateFormat(field) : "yyyy-MM-dd";
    return `<DataFormat><ProfileDateFormat dateFormat="${escapeXml(pattern)}"/></DataFormat>`;
  }
  // boolean and character both use ProfileCharacterFormat per real samples
  return "<DataFormat><ProfileCharacterFormat/></DataFormat>";
}

function normalizeJsonParentPath(parentPath?: string | null): string {
  const normalized = parentPath?.trim().replace(/\\/g, "/").replace(/\./g, "/") ?? "";
  const segments = normalized.split("/").map((segment) => segment.trim()).filter(Boolean);
  let index = 0;
  if (segments[index]?.toLowerCase() === "root") index += 1;
  if (segments[index]?.toLowerCase() === "object") index += 1;
  return segments.slice(index).join("/");
}

function joinJsonPath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function componentEnvelope(opts: {
  componentId: string;
  name: string;
  type: BoomiComponentDraft["componentType"];
  innerXml: string;
}): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<bns:Component xmlns:xsi="${BOOMI_XSI}" xmlns:bns="${BOOMI_NS}"` +
    ` componentId="${escapeXml(opts.componentId)}" version="1" name="${escapeXml(opts.name)}"` +
    ` type="${opts.type}" deleted="false" currentVersion="true" branchName="main">` +
    `<bns:encryptedValues/><bns:description></bns:description>` +
    `<bns:object>${opts.innerXml}</bns:object>` +
    `</bns:Component>`
  );
}

/**
 * Maps a local Profile type to the corresponding Boomi component type string.
 */
export function profileComponentType(profile: Profile): BoomiComponentDraft["componentType"] {
  switch (profile.type) {
    case "JSON":
    case "API":
      return "profile.json";
    case "XML":
      return "profile.xml";
    case "Database":
      return "profile.db";
    case "Flat File":
    default:
      return "profile.flatfile";
  }
}

// -----------------------------------------------------------------------------
// FROM-SCRATCH GENERATORS (no template attached)
// -----------------------------------------------------------------------------

/**
 * @param profile - The Flat File profile to serialize.
 * @returns A complete Boomi FlatFileProfile XML component envelope for sandbox publishing or dry-run preview.
 */
export function buildFlatFileProfileXml(profile: Profile): string {
  let key = 2; // 1 is Record, 2 is Elements; field keys start at 3
  const record = key++;
  const elements = key++;

  const fieldEls = profile.fields.map((field) => {
    // FlatFile in real samples only uses character or number — datetime/boolean fold to character.
    const inferred = mapBoomiDataType(field);
    const boomiType: "character" | "number" = inferred === "number" ? "number" : "character";
    const k = key++;
    const maxLen = field.length ? ` maxLength="${escapeXml(field.length)}"` : "";
    return (
      `<FlatFileElement dataType="${boomiType}" enforceUnique="false" identityValue=""` +
      ` isMappable="true" isNode="true" justification="left" key="${k}"` +
      ` mandatory="${field.required ? "true" : "false"}"${maxLen} minLength="0"` +
      ` name="${escapeXml(field.name)}" useToIdentifyFormat="false" validateData="true">` +
      dataFormatElement(boomiType) +
      `</FlatFileElement>`
    );
  }).join("");

  const isDelimited = !/fixed/i.test(profile.format ?? "");
  const delimiterAttr = (() => {
    const f = (profile.format ?? "").toLowerCase();
    if (f === "tsv" || f === "tab") return "tabdelimited";
    // "Pipe" in the UI maps to Boomi's bardelimited (verified against real samples).
    if (f === "pipe" || f === "bar") return "bardelimited";
    if (f === "csv") return "commadelimited";
    if (f === "star" || f === "asterisk") return "stardelimited";
    if (f === "semicolon") return "semicolondelimited";
    return "commadelimited";
  })();
  const generalInfo = isDelimited
    ? `<GeneralInfo fileType="delimited" useColumnHeaders="false"/>`
    : `<GeneralInfo fileType="fixedwidth" useColumnHeaders="false"/>`;
  const options = isDelimited
    ? `<Options><DataOptions/><DelimitedOptions fileDelimiter="${delimiterAttr}" removeEscape="false" textQualifier="na"/></Options>`
    : `<Options><DataOptions/><FixedLengthOptions/></Options>`;

  const inner =
    `<FlatFileProfile xmlns="" modelVersion="2" strict="true">` +
    `<ProfileProperties>${generalInfo}${options}</ProfileProperties>` +
    `<DataElements>` +
    `<FlatFileRecord detectFormat="numberofcolumns" isNode="true" key="${record}" name="Record">` +
    `<FlatFileElements isNode="true" key="${elements}" name="Elements">${fieldEls}</FlatFileElements>` +
    `</FlatFileRecord>` +
    `</DataElements>` +
    `</FlatFileProfile>`;

  return componentEnvelope({
    componentId: profile.id,
    name: profile.name,
    type: "profile.flatfile",
    innerXml: inner,
  });
}

/**
 * @param profile - The JSON profile to serialize, including nested field paths.
 * @returns A complete Boomi JSONProfile XML component envelope with nested objects and arrays.
 */
export function buildJsonProfileXml(profile: Profile): string {
  // Group fields by parentPath. Root/Object is the intrinsic Boomi JSON root.
  const byParent = new Map<string, ProfileField[]>();
  for (const field of profile.fields) {
    const parent = normalizeJsonParentPath(field.parentPath);
    const bucket = byParent.get(parent) ?? [];
    bucket.push(field);
    byParent.set(parent, bucket);
  }

  let key = 2; // 1 is Root, 2 is its inner Object
  const rootKey = 1;
  const rootObjectKey = key++;

  function renderEntries(parent: string): string {
    const children = byParent.get(parent) ?? [];
    return children.map((field) => {
      const fullPath = joinJsonPath(parent, field.name);
      const boomiType = mapBoomiDataType(field);
      const nested = byParent.get(fullPath);
      const entryKey = key++;
      const isArray = /array|list|collection/i.test(field.dataType ?? "");

      if (nested && nested.length > 0) {
        const containerKey = key++;
        const inner = renderEntries(fullPath);

        if (isArray) {
          return (
            `<JSONObjectEntry dataType="character" isMappable="true" isNode="true" key="${entryKey}" name="${escapeXml(field.name)}" validateData="false">` +
            `<DataFormat><ProfileCharacterFormat/></DataFormat>` +
            `<JSONArray isMappable="false" isNode="true" key="${containerKey}" name="Array">` +
            `<JSONArrayElement isMappable="false" isNode="true" key="${containerKey + 1}" name="Element">${inner}</JSONArrayElement>` +
            `</JSONArray>` +
            `<Qualifiers><QualifierList/></Qualifiers>` +
            `</JSONObjectEntry>`
          );
        }

        return (
          `<JSONObjectEntry dataType="character" isMappable="true" isNode="true" key="${entryKey}" name="${escapeXml(field.name)}" validateData="false">` +
          `<DataFormat><ProfileCharacterFormat/></DataFormat>` +
          `<JSONObject isMappable="false" isNode="true" key="${containerKey}" name="Object">${inner}</JSONObject>` +
          `<Qualifiers><QualifierList/></Qualifiers>` +
          `</JSONObjectEntry>`
        );
      }

      if (isArray) {
        const arrayKey = key++;
        const arrayElKey = key++;
        return (
          `<JSONObjectEntry dataType="character" isMappable="true" isNode="true" key="${entryKey}" name="${escapeXml(field.name)}" validateData="false">` +
          `<DataFormat><ProfileCharacterFormat/></DataFormat>` +
          `<JSONArray isMappable="true" isNode="true" key="${arrayKey}" name="Array">` +
          `<JSONArrayElement dataType="${boomiType}" isMappable="true" isNode="true" key="${arrayElKey}" name="Element">` +
          dataFormatElement(boomiType, field) +
          `</JSONArrayElement>` +
          `</JSONArray>` +
          `<Qualifiers><QualifierList/></Qualifiers>` +
          `</JSONObjectEntry>`
        );
      }
      return (
        `<JSONObjectEntry dataType="${boomiType}" isMappable="true" isNode="true" key="${entryKey}" name="${escapeXml(field.name)}" validateData="false">` +
        dataFormatElement(boomiType, field) +
        `<Qualifiers><QualifierList/></Qualifiers>` +
        `</JSONObjectEntry>`
      );
    }).join("");
  }

  const rootEntries = renderEntries("");
  const inner =
    `<JSONProfile xmlns="" strict="false">` +
    `<DataElements>` +
    `<JSONRootValue dataType="character" isMappable="false" isNode="true" key="${rootKey}" name="Root" validateData="false">` +
    `<JSONObject isMappable="false" isNode="true" key="${rootObjectKey}" name="Object">${rootEntries}</JSONObject>` +
    `<Qualifiers><QualifierList/></Qualifiers>` +
    `</JSONRootValue>` +
    `</DataElements>` +
    `<tagLists/>` +
    `</JSONProfile>`;

  return componentEnvelope({
    componentId: profile.id,
    name: profile.name,
    type: "profile.json",
    innerXml: inner,
  });
}

/**
 * @param profile - The XML profile with fields and optional root-path.
 * @returns A Boomi XMLProfile component envelope with a root XMLElement and inline children.
 */
export function buildXmlProfileXml(profile: Profile): string {
  // V1 scaffold for XML profiles: flat list of XMLElement children under a single
  // root XMLElement. Real Boomi XML profiles use Namespaces + Types tables; those
  // are emitted as empty stubs so the envelope parses correctly. Users are
  // expected to import the real template for an XML profile when accuracy matters.
  let key = 1;
  const rootKey = key++;
  const rootName = profile.rootPath || profile.name || "Root";

  const childEls = profile.fields.map((field) => {
    const k = key++;
    const boomiType = mapBoomiDataType(field);
    const maxLen = field.length ? ` maxLength="${escapeXml(field.length)}"` : "";
    return (
      `<XMLElement dataType="${boomiType}" isMappable="true" isNode="true" key="${k}"` +
      ` maxOccurs="1" minOccurs="${field.required ? "1" : "0"}"${maxLen}` +
      ` name="${escapeXml(field.name)}" typeKey="-1" useNamespace="-1" validateData="true">` +
      dataFormatElement(boomiType) +
      `</XMLElement>`
    );
  }).join("");

  const inner =
    `<XMLProfile xmlns="" modelVersion="2" strict="true">` +
    `<ProfileProperties><XMLGeneralInfo/><XMLOptions encoding="utf8" implicitElementOrdering="true" parseRespectMaxOccurs="true"/></ProfileProperties>` +
    `<DataElements>` +
    `<XMLElement dataType="character" isMappable="true" isNode="true" key="${rootKey}" maxOccurs="1" minOccurs="1"` +
    ` name="${escapeXml(rootName)}" typeKey="-1" useNamespace="-1">` +
    `<DataFormat><ProfileCharacterFormat/></DataFormat>` +
    childEls +
    `</XMLElement>` +
    `</DataElements>` +
    `<Namespaces><XMLNamespace key="-1" name="Empty Namespace" prefix="ns1"><Types/></XMLNamespace></Namespaces>` +
    `</XMLProfile>`;

  return componentEnvelope({
    componentId: profile.id,
    name: profile.name,
    type: "profile.xml",
    innerXml: inner,
  });
}

/**
 * @param profile - The Database profile whose role determines execution type (read vs write).
 * @returns A Boomi DatabaseProfile XML component envelope with DBStatement, DBFields, and optional DBConditions.
 */
export function buildDbProfileXml(profile: Profile): string {
  // Map local format → Boomi statementType.
  //   "Stored Procedure" → storedprocedure
  //   "View" / source → select
  //   "Table"     / source → select
  //                 / dest → dynamicinsert
  // Profile.role distinguishes read vs write. Source profiles SELECT; destination profiles INSERT.
  const fmt = (profile.format ?? "").toLowerCase();
  const isStoredProc = fmt.includes("stored");
  const isWrite = profile.role === "destination" && !isStoredProc;
  const executionType: "dbread" | "dbwrite" = isWrite ? "dbwrite" : "dbread";
  const statementType = isStoredProc
    ? "storedprocedure"
    : isWrite
    ? "dynamicinsert"
    : "select";
  const tableName = profile.rootPath ?? "";

  let key = 1;
  const statementKey = key++;
  const fieldsKey = key++;
  const fieldsTypeAttr = executionType === "dbread" ? ` type="result_set"` : "";
  const fieldEls = profile.fields.map((field) => {
    const elKey = key++;
    const boomiType = mapBoomiDataType(field);
    // DB elements only use character / number / datetime in samples; map booleans to character.
    const elementType: "character" | "number" | "datetime" =
      boomiType === "number" ? "number" : boomiType === "datetime" ? "datetime" : "character";
    return (
      `<DatabaseElement dataType="${elementType}" enforceUnique="false"` +
      ` isMappable="true" isNode="true" key="${elKey}"` +
      ` mandatory="${field.required ? "true" : "false"}" name="${escapeXml(field.name)}">` +
      // profile.db datetime uses <ProfileDateFormat/> without a pattern in samples
      (elementType === "datetime"
        ? `<DataFormat><ProfileDateFormat/></DataFormat>`
        : dataFormatElement(elementType))
      + `</DatabaseElement>`
    );
  }).join("");

  // Build optional sections based on statement type
  let extras = "";
  if (statementType === "select" || statementType === "storedprocedure") {
    const paramsKey = key++;
    extras += `<DBParameters isNode="true" key="${paramsKey}" name="Parameters"/>`;
  }
  if (isWrite && !isStoredProc) {
    // dynamicinsert / dynamicupdate: add DBConditions for the WHERE clause.
    // Uses the profile's key fields (or all required fields if none are marked key).
    const condFields = profile.fields.filter((f) => f.keyField || (!profile.fields.some((ff) => ff.keyField) && f.required));
    if (condFields.length > 0) {
      const condKey = key++;
      const condElements = condFields.map((f) => {
        const elKey = key++;
        return (
          `<DBConditionElement isNode="true" key="${elKey}" name="${escapeXml(f.name)}" operator="equal"` +
          ` statementOperator="and"/>`
        );
      }).join("");
      extras += `<DBConditions isNode="true" key="${condKey}" name="Conditions">${condElements}</DBConditions>`;
    }
  }

  const storedProcAttr = isStoredProc ? escapeXml(tableName || "") : "";
  const inner =
    `<DatabaseProfile xmlns="" strict="true" version="2">` +
    `<ProfileProperties><DatabaseGeneralInfo executionType="${executionType}"/></ProfileProperties>` +
    `<DataElements>` +
    `<DBStatement isNode="true" key="${statementKey}" name="Statement"` +
    ` statementType="${statementType}" storedProcedure="${storedProcAttr}"` +
    ` tableName="${escapeXml(isStoredProc ? "" : tableName)}">` +
    `<DBFields isNode="true" key="${fieldsKey}" name="Fields"${fieldsTypeAttr}>${fieldEls}</DBFields>` +
    extras +
    `<sql/>` +
    `</DBStatement>` +
    `</DataElements>` +
    `</DatabaseProfile>`;

  return componentEnvelope({
    componentId: profile.id,
    name: profile.name,
    type: "profile.db",
    innerXml: inner,
  });
}

/**
 * Generates a complete Boomi Component XML envelope for a profile.
 * Dispatches to the type-specific builder (flatfile, JSON, XML, DB).
 */
export function buildProfileXml(profile: Profile): { xml: string; componentType: BoomiComponentDraft["componentType"] } {
  const componentType = profileComponentType(profile);
  switch (componentType) {
    case "profile.flatfile":
      return { xml: buildFlatFileProfileXml(profile), componentType };
    case "profile.json":
      return { xml: buildJsonProfileXml(profile), componentType };
    case "profile.xml":
      return { xml: buildXmlProfileXml(profile), componentType };
    case "profile.db":
      return { xml: buildDbProfileXml(profile), componentType };
    default:
      return { xml: buildFlatFileProfileXml(profile), componentType };
  }
}

// -----------------------------------------------------------------------------
// PROCESS FLOW XML GENERATOR
// -----------------------------------------------------------------------------

const boomiShapeMap: Record<string, { shapetype: string; image: string; category: string; defaultLabel: string }> = {
  // Start shape variants
  "start":                 { shapetype: "start",        image: "start",          category: "Start",     defaultLabel: "Start" },
  "start-connector":       { shapetype: "start",        image: "connector_icon", category: "Start",     defaultLabel: "Connector Start" },
  "start-trading":         { shapetype: "start",        image: "trading_icon",   category: "Start",     defaultLabel: "Trading Partner Start" },
  "start-passthrough":     { shapetype: "start",        image: "passthrough",    category: "Start",     defaultLabel: "Data Passthrough" },
  "start-nodata":          { shapetype: "start",        image: "nodata",         category: "Start",     defaultLabel: "No Data" },

  // Execute steps
  "map":                   { shapetype: "map",          image: "map_icon",       category: "Execute",   defaultLabel: "Map" },
  "setproperties":         { shapetype: "setproperties",image: "setprops_icon",  category: "Execute",   defaultLabel: "Set Properties" },
  "message":               { shapetype: "message",      image: "message_icon",   category: "Execute",   defaultLabel: "Message" },
  "notify":                { shapetype: "notify",       image: "notify_icon",    category: "Execute",   defaultLabel: "Notify" },
  "programcmd":            { shapetype: "programcmd",   image: "programcmd_icon",category: "Execute",   defaultLabel: "Program Command" },
  "subprocess":            { shapetype: "subprocess",   image: "subprocess_icon",category: "Execute",   defaultLabel: "Process Call" },
  "processroute":          { shapetype: "processroute", image: "processroute_icon",category: "Execute", defaultLabel: "Process Route" },
  "dataprocess":           { shapetype: "dataprocess",  image: "dataprocess_icon",category: "Execute",  defaultLabel: "Data Process" },
  "agent":                 { shapetype: "agent",        image: "agent_icon",     category: "Execute",   defaultLabel: "Agent" },

  // Logic steps
  "branch":                { shapetype: "branch",       image: "branch_icon",    category: "Logic",     defaultLabel: "Branch" },
  "route":                 { shapetype: "route",        image: "route_icon",     category: "Logic",     defaultLabel: "Route" },
  "cleanse":               { shapetype: "cleanse",      image: "cleanse_icon",   category: "Logic",     defaultLabel: "Cleanse" },
  "decision":              { shapetype: "decision",     image: "decision_icon",  category: "Logic",     defaultLabel: "Decision" },
  "exception":             { shapetype: "exception",    image: "exception_icon", category: "Logic",     defaultLabel: "Exception" },
  "stop":                  { shapetype: "stop",         image: "stop_icon",      category: "Logic",     defaultLabel: "Stop" },
  "end":                   { shapetype: "stop",         image: "stop_icon",      category: "Logic",     defaultLabel: "Stop" },
  "return":                { shapetype: "return",       image: "return_icon",    category: "Logic",     defaultLabel: "Return Documents" },
  "flowcontrol":           { shapetype: "flowcontrol",  image: "flowcontrol_icon",category: "Logic",    defaultLabel: "Flow Control" },

  // Advanced (Professional/Enterprise Edition)
  "trycatch":              { shapetype: "trycatch",     image: "trycatch_icon",  category: "Advanced",  defaultLabel: "Try/Catch" },
  "businessrules":         { shapetype: "businessrules",image: "br_icon",        category: "Advanced",  defaultLabel: "Business Rules" },
  "findchanges":           { shapetype: "findchanges",  image: "findchg_icon",   category: "Advanced",  defaultLabel: "Find Changes" },
  "addtocache":            { shapetype: "addtocache",   image: "cache_icon",     category: "Advanced",  defaultLabel: "Add to Cache" },
  "retrievefromcache":     { shapetype: "retrievefromcache",image: "cache_icon", category: "Advanced",  defaultLabel: "Retrieve From Cache" },
  "removefromcache":       { shapetype: "removefromcache",image: "cache_icon",   category: "Advanced",  defaultLabel: "Remove From Cache" },

  // Connector (generic — real connectors have subtypes)
  "connector":             { shapetype: "connector",    image: "connector_icon", category: "Connector", defaultLabel: "Connector" },
};

/**
 * @param flow - The process flow with nodes and edges from the flow designer.
 * @returns A complete Boomi process XML component envelope with shapes, connectors, and dragpoints.
 */
/**
 * Generates Boomi process XML from a ProcessFlow definition.
 * Includes real `<shape>` elements with shapetype and dragpoints.
 */
export function buildProcessXml(
  project: Project | undefined,
  flow: Project["processFlows"][number],
): string {
  void project; // reserved for future use; currently only flow is serialized
  const shapes = flow.nodes.map((node) => {
    const shapeDef = boomiShapeMap[node.type] ?? { shapetype: "start", image: "start" };
    const x = Math.round(node.position.x);
    const y = Math.round(node.position.y);
    return (
      `<shape image="${shapeDef.image}" name="${escapeXml(node.id)}" shapetype="${shapeDef.shapetype}" userlabel="${escapeXml(node.label || shapeDef.defaultLabel)}" x="${x}" y="${y}">` +
      `<configuration>` +
      (node.type === "connector" || node.type === "start-connector"
        ? `<connector connection="" operation="" name="${escapeXml(node.label)}"/>`
        : node.type === "map"
        ? `<map/>`
        : node.type === "setproperties"
        ? `<setproperties/>`
        : node.type === "message"
        ? `<message/>`
        : node.type === "notify"
        ? `<notify/>`
        : node.type === "programcmd"
        ? `<programcmd/>`
        : node.type === "subprocess"
        ? `<subprocess/>`
        : node.type === "processroute"
        ? `<processroute/>`
        : node.type === "dataprocess"
        ? `<dataprocess/>`
        : node.type === "agent"
        ? `<agent/>`
        : node.type === "branch"
        ? `<branch/>`
        : node.type === "route"
        ? `<route/>`
        : node.type === "cleanse"
        ? `<cleanse/>`
        : node.type === "decision"
        ? `<condition/>`
        : node.type === "exception"
        ? `<exception/>`
        : node.type === "flowcontrol"
        ? `<flowcontrol/>`
        : node.type === "businessrules"
        ? `<businessrules/>`
        : node.type === "trycatch"
        ? `<trycatch/>`
        : node.type === "findchanges"
        ? `<findchanges/>`
        : node.type === "addtocache" || node.type === "retrievefromcache" || node.type === "removefromcache"
        ? `<cache/>`
        : node.type === "return"
        ? `<return/>`
        : node.type === "end" || node.type === "stop" || node.type === "start"
        ? `<stop continue="true"/>`
        : `<noaction/>`) +
      `</configuration>` +
      `<dragpoints>${flow.edges
        .filter((e) => e.source === node.id)
        .map((e) => {
          const targetNode = flow.nodes.find((n) => n.id === e.target);
          const tx = targetNode ? Math.round(targetNode.position.x) : x + 100;
          const ty = targetNode ? Math.round(targetNode.position.y) : y + 100;
          return `<dragpoint name="${escapeXml(e.id)}" toShape="${escapeXml(e.target)}" x="${tx}" y="${ty}"/>`;
        })
        .join("")}</dragpoints>` +
      `</shape>`
    );
  }).join("");

  const inner =
    `<process xmlns="" allowSimultaneous="false" enableUserLog="false"` +
    ` processLogOnErrorOnly="false" purgeDataImmediately="false" updateRunDates="true" workload="general">` +
    `<shapes>${shapes}</shapes>` +
    `</process>`;

  return componentEnvelope({
    componentId: flow.id,
    name: flow.name,
    type: "process",
    innerXml: inner,
  });
}

function profileKeyPath(profileName: string, field: ProfileField, fieldKey: number): { keyPath: string; namePath: string } {
  const segments: string[] = [];
  const names: string[] = [];
  if (field.parentPath) {
    const parts = field.parentPath.split(/[./]/).filter(Boolean);
    parts.forEach((part, idx) => {
      segments.push(`*[@key='${idx + 1}']`);
      names.push(part);
    });
  }
  segments.push(`*[@key='${fieldKey}']`);
  names.push(field.name);
  return {
    keyPath: segments.join("/"),
    namePath: [profileName, ...names].join("/"),
  };
}

// -----------------------------------------------------------------------------
// KEY RECONCILIATION + PROFILE UUID LINKAGE
// -----------------------------------------------------------------------------

const profileXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: true,
  allowBooleanAttributes: true,
  processEntities: true,
});

function findXmlNode(parent: unknown, tag: string): XmlNode | null {
  if (!Array.isArray(parent)) {
    if (parent && typeof parent === "object") {
      if (tag in parent) return parent as XmlNode;
      for (const value of Object.values(parent)) {
        const found = findXmlNode(value, tag);
        if (found) return found;
      }
    }
    return null;
  }
  for (const node of parent) {
    if (node && typeof node === "object") {
      if (tag in node) return node as XmlNode;
      const found = findXmlNode(node, tag);
      if (found) return found;
    }
  }
  return null;
}

function attrsOf(node: unknown): Record<string, string | boolean | unknown> | undefined {
  if (!node || typeof node !== "object") return undefined;
  const attrs = (node as XmlNode)[":@"] ?? (node as Record<string, unknown>)["@_"];
  return attrs && typeof attrs === "object" ? attrs as Record<string, string | boolean | unknown> : undefined;
}

function attrValue(attrs: Record<string, unknown> | undefined, name: string) {
  const value = attrs?.[name] ?? attrs?.[`@_${name}`];
  return value === undefined || value === null ? undefined : String(value);
}

/**
 * Extract the Boomi component ID from a template XML envelope.
 * @param templateXml - The raw component XML string (may be a full Boomi envelope or a fragment).
 * @returns The componentId attribute value, or null if none is found.
 */
/**
 * Extracts the Boomi componentId attribute from an imported template XML envelope.
 */
export function extractBoomiComponentId(templateXml: string): string | null {
  if (!templateXml.trim()) return null;
  try {
    const parsed = profileXmlParser.parse(templateXml) as unknown[];
    const component = parsed.find(
      (node) => typeof node === "object" && node !== null && ("bns:Component" in node || "Component" in node),
    ) as Record<string, unknown> | undefined;
    if (!component) return null;
    const directId = attrValue(attrsOf(component), "componentId");
    if (directId) return directId;
    const body = (component["bns:Component"] ?? component["Component"]) as unknown[];
    if (!Array.isArray(body)) return null;
    for (const attr of body) {
      const id = attrValue(attrsOf(attr), "componentId");
      if (id) return id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Walk a profile template XML and extract element-key → { key, keyPath, namePath } mappings for every mappable leaf element.
 * @param templateXml - The profile template XML to walk.
 * @returns A Map keyed by element name with its Boomi key number and XPath-style paths.
 */
/**
 * Walks a Boomi profile template XML and returns a map of field names to their
 * Boomi element keys and path strings. Used to reconcile real Boomi keys when
 * patching a transform.map template.
 */
export function extractProfileElementKeys(templateXml: string): Map<string, { key: number; keyPath: string; namePath: string }> {
  const result = new Map<string, { key: number; keyPath: string; namePath: string }>();
  if (!templateXml.trim()) return result;

  try {
    const parsed = profileXmlParser.parse(templateXml) as unknown[];

    // Find the profile-type root inside bns:object
    const profileTypes = [
      "FlatFileProfile", "JSONProfile", "XMLProfile",
      "DatabaseProfile", "JsonProfile",
    ];
    let profileRoot: unknown = null;
    for (const type of profileTypes) {
      profileRoot = findXmlNode(parsed, type);
      if (profileRoot) break;
    }
    if (!profileRoot) return result;

    // Walk all children to find element nodes with a key attribute
    function walk(node: unknown, parentName: string, parentKeyPath: string) {
      if (!node || typeof node !== "object") return;
      const childNode = node as XmlNode;
      const keys = Object.keys(childNode);
      for (const tag of keys) {
        if (tag === "#text" || tag === "@_" || tag === ":@") continue;
        const container = childNode[tag];
        const children = Array.isArray(container) ? container : [container];
        for (const child of children) {
          if (!child || typeof child !== "object") continue;
          const attrs = attrsOf(child);
          const name = attrValue(attrs, "name");

          const keyValue = attrValue(attrs, "key");
          const key = keyValue ? Number(keyValue) : undefined;

          // Determine if leaf element (has dataType and no further children of interest)
          const hasDataType = attrValue(attrs, "dataType") !== undefined;
          const hasNestedChildren = Object.keys(child).some(
            (k) => k !== "#text" && k !== "@_" && k !== ":@" && k !== "DataFormat" && k !== "tagLists" && k !== "Qualifiers",
          );
          const currentNamePath = name ? (parentName ? `${parentName}/${name}` : name) : parentName;
          const currentKeyPath = key !== undefined && Number.isFinite(key)
            ? (parentKeyPath ? `${parentKeyPath}/*[@key='${key}']` : `*[@key='${key}']`)
            : parentKeyPath;

          if (name && hasDataType && !hasNestedChildren && key !== undefined && Number.isFinite(key)) {
            result.set(name, { key, keyPath: currentKeyPath, namePath: currentNamePath });
          }

          // Recurse into containers
          if (hasNestedChildren) {
            walk(child, currentNamePath, currentKeyPath);
            // Also add the container element to the map for partial-container lookups
            if (name && key !== undefined && Number.isFinite(key)) {
              result.set(name, { key, keyPath: currentKeyPath, namePath: currentNamePath });
            }
          }
        }
      }
    }

    walk(profileRoot, "", "");
    return result;
  } catch {
    return result;
  }
}

/**
 * Extended options for buildTransformMapXml carrying reconciled keys + UUID linkage.
 */
export type TransformMapOptions = {
  sourceElementKeys?: Map<string, { key: number; keyPath: string; namePath: string }>;
  destinationElementKeys?: Map<string, { key: number; keyPath: string; namePath: string }>;
  sourceBoomiId?: string;
  destinationBoomiId?: string;
  lookupConnectionId?: string;
};

/**
 * @param project - The parent project carrying connections and drafts.
 * @param mappingSet - The mapping set with rules and transform nodes.
 * @param sourceProfile - The source profile providing field paths and keys.
 * @param destinationProfile - The destination profile for output mappings.
 * @param options - Optional reconciled element keys and Boomi component UUIDs to link profiles in the map envelope.
 * @returns A complete Boomi transform.map XML component envelope with Mappings, Functions, and Defaults.
 */
/**
 * Generates a complete Boomi transform.map Component XML.
 * Supports both from-scratch scaffold mode and template-patch mode with
 * reconciled profile element keys.
 */
export function buildTransformMapXml(
  project: Project,
  mappingSet: MappingSet,
  sourceProfile: Profile,
  destinationProfile: Profile,
  options?: TransformMapOptions,
): string {
  const reconciledSrcKeys = options?.sourceElementKeys;
  const reconciledDstKeys = options?.destinationElementKeys;
  const boomiSrcId = options?.sourceBoomiId;
  const boomiDstId = options?.destinationBoomiId;

  // Build fallback synthetic keys, then override with reconciled keys when available.
  const sourceFieldKeys = new Map<string, number>();
  const destFieldKeys = new Map<string, number>();
  let counter = 3;
  for (const f of sourceProfile.fields) {
    const reconciled = reconciledSrcKeys?.get(f.name);
    sourceFieldKeys.set(f.id, reconciled ? reconciled.key : counter++);
  }
  for (const f of destinationProfile.fields) {
    const reconciled = reconciledDstKeys?.get(f.name);
    destFieldKeys.set(f.id, reconciled ? reconciled.key : counter++);
  }

  const mappings: string[] = [];
  const defaults: string[] = [];
  const functionSteps: string[] = [];
  const warnings: string[] = [];
  let functionStepKey = 0;
  let functionPosition = 0;

  // Map local mappingType → Boomi FunctionStep (type, category, default Inputs/Outputs).
  // Backed by real samples in samples/boomi/transform-map*.xml.
  function functionStepFor(rule: MappingSet["rules"][number]): {
    type: string;
    category: string;
    inputs: Array<{ name: string; default?: string }>;
    outputs: Array<{ name: string }>;
    configuration: string;
  } {
    const expr = rule.expression?.trim() ?? "";

    if (rule.mappingType === "lookup") {
      const connId = options?.lookupConnectionId ?? "";
      return {
        type: "SqlLookup",
        category: "Lookup",
        inputs: [{ name: "input" }],
        outputs: [{ name: "output" }],
        configuration:
          `<SqlLookup connection="${escapeXml(connId)}" executionType="sql" spResultOption="resultset" storedProcedureName="">` +
          `<SqlToExecute>${escapeXml(expr)}</SqlToExecute>` +
          `<Input dataType="character" index="1" name="input"/>` +
          `<Output dataType="character" index="2" name="output"/>` +
          `</SqlLookup>`,
      };
    }

    if (rule.mappingType === "join") {
      // StringConcat — supports 2+ inputs
      const parts = expr ? expr.split(/\s*[\+,;]\s*/).filter(Boolean) : [];
      const inputCount = Math.max(2, parts.length);
      const inputs = Array.from({ length: inputCount }, (_, i) => ({
        name: `input${i + 1}`,
        default: parts[i] || undefined,
      }));
      return {
        type: "StringConcat",
        category: "String",
        inputs,
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    // mappingType === "function": infer function type from expression hints
    const lowerExpr = expr.toLowerCase();

    if (/(\bdateformat\b|\bformatdate\b|\bdatetimeformat\b)/.test(lowerExpr)) {
      // DateFormat — real Boomi type verified against samples
      return {
        type: "DateFormat",
        category: "Date",
        inputs: [
          { name: "Date String" },
          { name: "Input Mask", default: "yyyy-MM-dd HH:mm:ss.SSSSSS" },
          { name: "Output Mask", default: "yyyyMMdd" },
        ],
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    if (/(\bnumberformat\b|\bnumberconvert\b|\btodecimal\b|\btointeger\b|\bround\b|\bceil\b|\bfloor\b)/.test(lowerExpr)) {
      // NumberConversion
      return {
        type: "NumberConversion",
        category: "Number",
        inputs: [{ name: "input" }],
        outputs: [{ name: "output" }],
        configuration:
          `<NumberConversion inputType="decimal" outputType="decimal" inputPattern="" outputPattern="">` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</NumberConversion>`,
      };
    }

    if (/(\bstandardize\b|\bstandardise\b|\bnormalize\b|\breplace\b|\bsubstitute\b)/.test(lowerExpr)) {
      // Standardize
      return {
        type: "Standardize",
        category: "Standardize",
        inputs: [{ name: "input" }],
        outputs: [{ name: "output" }],
        configuration:
          `<Standardize>` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</Standardize>`,
      };
    }

    if (/(\bencode\b|\bdecode\b|\bcharset\b|\bencoding\b)/.test(lowerExpr)) {
      // TextEncoder
      return {
        type: "TextEncoder",
        category: "Encoding",
        inputs: [{ name: "input" }],
        outputs: [{ name: "output" }],
        configuration:
          `<TextEncoder defaultEncoding="UTF-8" inputEncoding="UTF-8" outputEncoding="UTF-8"` +
          ` encodeBase64="false">` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</TextEncoder>`,
      };
    }

    if (/(\bsplit\b|\btokenize\b)/.test(lowerExpr)) {
      // Split
      return {
        type: "Split",
        category: "String",
        inputs: [{ name: "input" }],
        outputs: [{ name: "output1" }, { name: "output2" }],
        configuration:
          `<Split delimiter=",">` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</Split>`,
      };
    }

    if (/(\bmathmultiply\b|\bmultiply\b)/.test(lowerExpr)) {
      return {
        type: "MathMultiply",
        category: "Numeric",
        inputs: [{ name: "Value" }, { name: "Value to Multiply", default: "1000" }],
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    if (/(\blineitemincrement\b|\bitem.*increment\b)/.test(lowerExpr)) {
      return {
        type: "LineItemIncrement",
        category: "Numeric",
        inputs: [{ name: "Increment Basis", default: "1" }, { name: "Reset Value" }],
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    if (/(\bmath\b|\bcalculate\b|\badd\b|\bsubtract\b|\bdivide\b|\bmod\b)/.test(lowerExpr)) {
      return {
        type: "MathOperation",
        category: "Math",
        inputs: [{ name: "input1" }, { name: "input2" }],
        outputs: [{ name: "result" }],
        configuration:
          `<MathOperation operation="add">` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</MathOperation>`,
      };
    }

    if (/(\bcompare\b|\bif\b|\bthen\b|\belse\b|\bcase\b|\bwhen\b|\bequals\b|\bgreater\b|\bless\b)/.test(lowerExpr)) {
      return {
        type: "Compare",
        category: "Logic",
        inputs: [{ name: "input1" }, { name: "input2" }],
        outputs: [{ name: "true" }, { name: "false" }],
        configuration:
          `<Compare operator="equals">` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</Compare>`,
      };
    }

    if (/(\bcoalesce\b|\bnvl\b|\bnullif\b|\bfirstnonnull\b|\bdefault\b)/.test(lowerExpr)) {
      return {
        type: "Coalesce",
        category: "Logic",
        inputs: [{ name: "input1" }, { name: "input2" }],
        outputs: [{ name: "output" }],
        configuration:
          `<Coalesce>` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</Coalesce>`,
      };
    }

    if (/(\bprecision\b|\broundto\b|\bdecimalplaces\b)/.test(lowerExpr)) {
      return {
        type: "MathPrecision",
        category: "Math",
        inputs: [{ name: "input" }],
        outputs: [{ name: "output" }],
        configuration:
          `<MathPrecision precision="2">` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</MathPrecision>`,
      };
    }

    if (/(\blefttrim\b|\btrimleft\b|\bleft.*trim\b)/.test(lowerExpr)) {
      return {
        type: "LeftTrim",
        category: "String",
        inputs: [{ name: "Original String" }, { name: "Fix to Length", default: "4" }],
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    if (/(\brighttrim\b|\btrimright\b|\bright.*trim\b)/.test(lowerExpr)) {
      return {
        type: "RightTrim",
        category: "String",
        inputs: [{ name: "Original String" }, { name: "Fix to Length", default: "4" }],
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    if (/(\bwhitespacetrim\b|\btrimwhitespace\b|\bwhitespace.*trim\b)/.test(lowerExpr)) {
      return {
        type: "WhitespaceTrim",
        category: "String",
        inputs: [{ name: "Original String" }],
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    if (/(\bcurrentdate\b|\bnow\b|\btoday\b)/.test(lowerExpr)) {
      return {
        type: "CurrentDate",
        category: "Date",
        inputs: [],
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    if (/(\bprepend\b|\bprefix\b|\bprefixwith\b)/.test(lowerExpr)) {
      return {
        type: "StringPrepend",
        category: "String",
        inputs: [{ name: "input" }],
        outputs: [{ name: "output" }],
        configuration:
          `<StringPrepend prefix="">` +
          `<FormatInput>${escapeXml(expr)}</FormatInput>` +
          `</StringPrepend>`,
      };
    }

    if (/(\bdocumentpropertyset\b|\bset.*document.*property\b)/.test(lowerExpr)) {
      return {
        type: "DocumentPropertySet",
        category: "ProcessProperty",
        inputs: [{ name: "Dynamic Document Property - Source_Ref_Number" }],
        outputs: [],
        configuration:
          `<DocumentProperty defaultValue="" persist="false" propertyId="dynamicdocument.Source_Ref_Number" propertyName="Dynamic Document Property - Source_Ref_Number"/>`,
      };
    }

    if (/(\bdocumentpropertyget\b|\bget.*document.*property\b)/.test(lowerExpr)) {
      return {
        type: "DocumentPropertyGet",
        category: "ProcessProperty",
        inputs: [],
        outputs: [{ name: "Dynamic Document Property - RECORD_ID" }],
        configuration:
          `<DocumentProperty defaultValue="" persist="false" propertyId="dynamicdocument.RECORD_ID" propertyName="Dynamic Document Property - RECORD_ID"/>`,
      };
    }

    if (/(\bpropertyget\b|\bget.*process.*property\b|\bprocessproperty\b)/.test(lowerExpr)) {
      return {
        type: "PropertyGet",
        category: "ProcessProperty",
        inputs: [{ name: "Property Name", default: "flow_filename" }, { name: "Default Value" }],
        outputs: [{ name: "Result" }],
        configuration: "",
      };
    }

    // Default: Scripting (inline JavaScript)
    return {
      type: "Scripting",
      category: "Scripting",
      inputs: [{ name: "input" }],
      outputs: [{ name: "output" }],
      configuration:
        `<Scripting language="javascript" useComponent="false">` +
        `<ScriptToExecute>${escapeXml(expr || "// expression not provided")}</ScriptToExecute>` +
        `</Scripting>`,
    };
  }

  // keyPaths: use reconciled namePaths when available (Boomi name-based paths)
  function fieldToPaths(
    profile: Profile,
    field: ProfileField,
    fieldKey: number,
    reconciledKeys: Map<string, { key: number; keyPath: string; namePath: string }> | undefined,
  ) {
    const reconciled = reconciledKeys?.get(field.name);
    if (reconciled) {
      return { keyPath: reconciled.keyPath, namePath: reconciled.namePath };
    }
    return profileKeyPath(profile.name, field, fieldKey);
  }

  for (const rule of mappingSet.rules) {
    const destField = destinationProfile.fields.find((f) => f.id === rule.destinationFieldId);
    if (!destField) continue;
    const toKey = destFieldKeys.get(destField.id);
    if (toKey === undefined) continue;
    const toPaths = fieldToPaths(destinationProfile, destField, toKey, reconciledDstKeys);

    if (rule.mappingType === "constant") {
      const value = rule.defaultValue ?? rule.expression ?? "";
      defaults.push(`<Default toKey="${toKey}" value="${escapeXml(value)}"/>`);
      continue;
    }

    const srcField = rule.sourceFieldId
      ? sourceProfile.fields.find((f) => f.id === rule.sourceFieldId)
      : undefined;
    if (!srcField) {
      warnings.push(`Rule ${rule.id}: ${rule.mappingType} without source field`);
      continue;
    }
    const fromKey = sourceFieldKeys.get(srcField.id);
    if (fromKey === undefined) continue;
    const fromPaths = fieldToPaths(sourceProfile, srcField, fromKey, reconciledSrcKeys);

    if (rule.mappingType === "direct") {
      mappings.push(
        `<Mapping fromKey="${fromKey}" fromKeyPath="${escapeXml(fromPaths.keyPath)}"` +
          ` fromNamePath="${escapeXml(fromPaths.namePath)}" fromType="profile"` +
          ` toKey="${toKey}" toKeyPath="${escapeXml(toPaths.keyPath)}"` +
          ` toNamePath="${escapeXml(toPaths.namePath)}" toType="profile"/>`,
      );
      continue;
    }

    // function / lookup / join — dual Mapping (field → function input, function output → field)
    // plus a real <FunctionStep> entry under <Functions> matching observed Boomi schema.
    functionStepKey += 1;
    functionPosition += 1;
    const stepKey = functionStepKey;
    const spec = functionStepFor(rule);
    const inputIndex = 1; // single primary input
    const outputIndex = spec.inputs.length + 1; // outputs come after inputs in the Input/Output key space

    mappings.push(
      `<Mapping fromKey="${fromKey}" fromKeyPath="${escapeXml(fromPaths.keyPath)}"` +
        ` fromNamePath="${escapeXml(fromPaths.namePath)}" fromType="profile"` +
        ` toFunction="${stepKey}" toKey="${inputIndex}" toType="function"/>`,
    );
    mappings.push(
      `<Mapping fromFunction="${stepKey}" fromKey="${outputIndex}" fromType="function"` +
        ` toKey="${toKey}" toKeyPath="${escapeXml(toPaths.keyPath)}"` +
        ` toNamePath="${escapeXml(toPaths.namePath)}" toType="profile"/>`,
    );

    const inputsXml = spec.inputs
      .map((input, idx) => {
        const defaultAttr = input.default !== undefined ? ` default="${escapeXml(input.default)}"` : "";
        return `<Input key="${idx + 1}" name="${escapeXml(input.name)}"${defaultAttr}/>`;
      })
      .join("");
    const outputsXml = spec.outputs
      .map((output, idx) => `<Output key="${spec.inputs.length + idx + 1}" name="${escapeXml(output.name)}"/>`)
      .join("");
    const configXml = spec.configuration
      ? `<Configuration>${spec.configuration}</Configuration>`
      : `<Configuration/>`;
    const commentAttr = rule.comment ? ` comment="${escapeXml(rule.comment)}"` : "";
    functionSteps.push(
      `<FunctionStep cacheEnabled="true" cacheOption="none" category="${spec.category}"` +
        ` key="${stepKey}" name="${escapeXml(rule.mappingType)}" position="${functionPosition}"` +
        ` sumEnabled="false" type="${spec.type}" x="10.0" y="10.0"${commentAttr}>` +
        `<Inputs>${inputsXml}</Inputs>` +
        `<Outputs>${outputsXml}</Outputs>` +
        configXml +
        `</FunctionStep>`,
    );
  }

  const fromProfileId = boomiSrcId ?? sourceProfile.id;
  const toProfileId = boomiDstId ?? destinationProfile.id;

  const hasCacheNodes = project.processFlows.some((flow) =>
    flow.nodes.some((n) => n.type === "addtocache" || n.type === "retrievefromcache" || n.type === "removefromcache"),
  );
  const documentCacheJoins = hasCacheNodes
    ? `<DocumentCacheJoins><!-- Cache shapes detected in process flow; real join metadata must be configured in the Boomi UI or imported from a template --></DocumentCacheJoins>`
    : `<DocumentCacheJoins/>`;

  const inner =
    `<Map xmlns="" fromProfile="${escapeXml(fromProfileId)}" toProfile="${escapeXml(toProfileId)}">` +
    `<Mappings>${mappings.join("")}</Mappings>` +
    `<Functions optimizeExecutionOrder="true">${functionSteps.join("")}</Functions>` +
    `<Defaults>${defaults.join("")}</Defaults>` +
    // M9.7.26: DocumentCacheJoins — emit a comment when cache shapes are present in process flows.
    documentCacheJoins +
    `</Map>`;

  // Warnings are intentionally not surfaced inside the XML; the dry-run route
  // reads mapping rules independently to attach them to the draft notes.
  if (warnings.length > 0 && project.processId === "__unused__") {
    // referenced to keep `project` in the typed signature for future use
  }

  return componentEnvelope({
    componentId: mappingSet.id,
    name: mappingSet.name,
    type: "transform.map",
    innerXml: inner,
  });
}

// -----------------------------------------------------------------------------
// TEMPLATE-AWARE PATCHING
// -----------------------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: true,
  allowBooleanAttributes: true,
  processEntities: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  suppressEmptyNode: false,
  suppressBooleanAttributes: false,
  format: false,
});

/**
 * Parses a template XML, locates a node, replaces its children with the
 * new-generation XML's matching subtree. Returns the patched XML as a string.
 *
 * For each component type, we serialize a freshly built component using
 * buildXxxXml(), then graft its inner DataElements / Mappings / etc. into the
 * template. This preserves any template-only attributes (folderFullPath,
 * createdBy, encryptedValues) while keeping local data authoritative for the
 * structure under DataElements / Mappings / Defaults / Functions.
 */
type XmlNode = Record<string, unknown> & { ":@"?: Record<string, unknown> };

function findFirstByTag(nodes: unknown, tag: string): XmlNode | null {
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes as XmlNode[]) {
    if (node && typeof node === "object" && tag in node) return node;
    for (const value of Object.values(node ?? {})) {
      if (Array.isArray(value)) {
        const inner = findFirstByTag(value, tag);
        if (inner) return inner;
      }
    }
  }
  return null;
}

function replaceChildrenByTag(template: unknown, tag: string, replacement: unknown[]): boolean {
  const node = findFirstByTag(template, tag);
  if (!node) return false;
  (node as Record<string, unknown>)[tag] = replacement;
  return true;
}

function parseFragment(xml: string): unknown[] {
  return xmlParser.parse(xml) as unknown[];
}

function getInnerObject(parsed: unknown[]): unknown {
  // parsed[0] is usually the <?xml?> declaration; the bns:Component sits at parsed[1]
  // (or later). Walk top-level entries to find the Component wrapper.
  const component = parsed.find(
    (node) => typeof node === "object" && node !== null && ("bns:Component" in node || "Component" in node),
  ) as Record<string, unknown> | undefined;
  if (!component) return null;
  const componentBody = (component["bns:Component"] ?? component["Component"]) as unknown[] | undefined;
  if (!Array.isArray(componentBody)) return null;
  const objNode = componentBody.find(
    (n) => typeof n === "object" && n !== null && ("bns:object" in n || "object" in n),
  ) as XmlNode | undefined;
  if (!objNode) return null;
  return (objNode["bns:object"] ?? objNode["object"]) as unknown;
}

function serialize(template: unknown[]): string {
  const built = xmlBuilder.build(template).replace(/^<\?xml[^>]*\?>\s*/i, "");
  // fast-xml-parser drops the XML decl by default in preserveOrder mode; add it back.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${built}`;
}

/**
 * @param templateXml - The existing Boomi FlatFileProfile template XML.
 * @param profile - The local profile whose DataElements should replace the template's.
 * @returns The patched XML with updated fields while preserving template-only metadata.
 */
/**
 * Patches an existing Boomi flatfile profile template XML with current field definitions.
 */
export function patchFlatFileProfile(templateXml: string, profile: Profile): string {
  const template = parseFragment(templateXml);
  const fresh = parseFragment(buildFlatFileProfileXml(profile));
  const freshObj = getInnerObject(fresh);
  const freshDataElements = findFirstByTag(freshObj, "DataElements");
  if (!freshDataElements) return templateXml;
  replaceChildrenByTag(template, "DataElements", freshDataElements["DataElements"] as unknown[]);
  return serialize(template);
}

/**
 * @param templateXml - The existing Boomi JSONProfile template XML.
 * @param profile - The local JSON profile whose DataElements should replace the template's.
 * @returns The patched XML with updated fields while preserving template-only metadata.
 */
/**
 * Patches an existing Boomi JSON profile template XML with current field definitions.
 */
export function patchJsonProfile(templateXml: string, profile: Profile): string {
  const template = parseFragment(templateXml);
  const fresh = parseFragment(buildJsonProfileXml(profile));
  const freshObj = getInnerObject(fresh);
  const freshDataElements = findFirstByTag(freshObj, "DataElements");
  if (!freshDataElements) return templateXml;
  replaceChildrenByTag(template, "DataElements", freshDataElements["DataElements"] as unknown[]);
  return serialize(template);
}

/**
 * @param templateXml - The existing Boomi XMLProfile template XML.
 * @param profile - The local XML profile whose field children are merged into the template root element.
 * @returns The merged XML, preserving template-only namespaces, types, and element keys.
 */
/**
 * Patches an existing Boomi XML profile template XML with current field definitions.
 * Performs a coarse merge-by-name on the Types/Namespaces table.
 */
function xmlNodeAttrs(node: XmlNode): Record<string, string> | undefined {
  return node?.["@_"] as Record<string, string> | undefined;
}

function xmlChildArray(node: XmlNode, tag: string): XmlNode[] {
  const child = node?.[tag];
  return Array.isArray(child) ? (child as XmlNode[]) : [];
}

/**
 * Recursively merge fresh XML nodes into template nodes by name.
 * Preserves template keys (key, typeKey, useNamespace) while overlaying
 * fresh structural attributes. Recurses into XMLElement and XMLAttribute.
 */
function mergeXmlNodes(templateChildren: XmlNode[], freshChildren: XmlNode[]): XmlNode[] {
  const templateByName = new Map<string, XmlNode>();
  for (const child of templateChildren) {
    const name = xmlNodeAttrs(child)?.name;
    if (name) templateByName.set(name.toLowerCase(), child);
  }

  const merged: XmlNode[] = [];
  const seenFresh = new Set<string>();

  for (const freshChild of freshChildren) {
    const freshName = xmlNodeAttrs(freshChild)?.name;
    if (!freshName) {
      merged.push(freshChild);
      continue;
    }
    seenFresh.add(freshName.toLowerCase());
    const existing = templateByName.get(freshName.toLowerCase());
    if (existing) {
      const existingAttrs = xmlNodeAttrs(existing) ?? {};
      const freshAttrs = xmlNodeAttrs(freshChild) ?? {};
      // Preserve key-related identifiers from the template
      for (const attr of ["key", "typeKey", "useNamespace"]) {
        if (attr in existingAttrs) freshAttrs[attr] = existingAttrs[attr];
      }
      // Overlay fresh structural attributes
      for (const attr of ["dataType", "mandatory", "maxLength", "minLength", "isMappable", "validateData", "maxOccurs", "minOccurs"]) {
        if (attr in freshAttrs) existingAttrs[attr] = freshAttrs[attr];
      }
      // Merge DataFormat
      const freshDataFormat = freshChild["DataFormat"];
      if (freshDataFormat !== undefined) {
        existing["DataFormat"] = Array.isArray(freshDataFormat) ? freshDataFormat : [freshDataFormat];
      }
      // Recurse into nested element containers
      for (const nestedTag of ["XMLElement", "XMLAttribute"]) {
        const freshNested = xmlChildArray(freshChild, nestedTag);
        const existingNested = xmlChildArray(existing, nestedTag);
        if (freshNested.length > 0 || existingNested.length > 0) {
          existing[nestedTag] = mergeXmlNodes(existingNested, freshNested);
        }
      }
      merged.push(existing);
    } else {
      merged.push(freshChild);
    }
  }

  // Keep template-only children not present in fresh
  for (const templateChild of templateChildren) {
    const name = xmlNodeAttrs(templateChild)?.name;
    if (name && !seenFresh.has(name.toLowerCase())) {
      merged.push(templateChild);
    }
  }

  return merged;
}

/**
 * Patches an existing Boomi XML profile template XML with current field definitions.
 * Recursively merges DataElements and Types/Namespaces while preserving template keys.
 */
export function patchXmlProfile(templateXml: string, profile: Profile): string {
  if (!templateXml.trim()) return buildXmlProfileXml(profile);

  try {
    const template = parseFragment(templateXml);
    const fresh = parseFragment(buildXmlProfileXml(profile));
    const freshObj = getInnerObject(fresh);

    // Patch DataElements
    const freshDataElements = findFirstByTag(freshObj, "DataElements");
    const templateDataElements = findFirstByTag(template, "DataElements");

    if (freshDataElements && templateDataElements) {
      const freshElementArray = freshDataElements["DataElements"] as unknown[] | undefined;
      const templateElementArray = templateDataElements["DataElements"] as unknown[] | undefined;

      if (Array.isArray(freshElementArray) && Array.isArray(templateElementArray)) {
        const freshRootEl = freshElementArray.find((el) => typeof el === "object" && el !== null && "XMLElement" in el) as XmlNode | undefined;
        const templateRootEl = templateElementArray.find((el) => typeof el === "object" && el !== null && "XMLElement" in el) as XmlNode | undefined;

        if (freshRootEl && templateRootEl) {
          const freshChildren = (freshRootEl["XMLElement"] ?? []) as XmlNode[];
          const templateChildren = (templateRootEl["XMLElement"] ?? []) as XmlNode[];
          if (Array.isArray(freshChildren) && Array.isArray(templateChildren)) {
            templateRootEl["XMLElement"] = mergeXmlNodes(templateChildren, freshChildren);
          }
        }
      } else {
        replaceChildrenByTag(template, "DataElements", freshElementArray ?? []);
      }
    }

    // M9.7.24: Deep Types/Namespaces patching — preserve typeKeys and recurse
    const freshTypes = findFirstByTag(freshObj, "Types");
    const templateTypes = findFirstByTag(template, "Types");
    if (freshTypes && templateTypes) {
      const freshTypeChildren = freshTypes["Types"] as unknown[] | undefined;
      const templateTypeChildren = templateTypes["Types"] as unknown[] | undefined;
      if (Array.isArray(freshTypeChildren) && Array.isArray(templateTypeChildren)) {
        const templateByName = new Map<string, XmlNode>();
        for (const t of templateTypeChildren) {
          const name = xmlNodeAttrs(t as XmlNode)?.name;
          if (name) templateByName.set(name.toLowerCase(), t as XmlNode);
        }

        const merged: XmlNode[] = [];
        const seen = new Set<string>();

        for (const freshType of freshTypeChildren) {
          const name = xmlNodeAttrs(freshType as XmlNode)?.name;
          if (name) {
            seen.add(name.toLowerCase());
            const existing = templateByName.get(name.toLowerCase());
            if (existing) {
              const existingAttrs = xmlNodeAttrs(existing) ?? {};
              const freshAttrs = xmlNodeAttrs(freshType as XmlNode) ?? {};
              if ("typeKey" in existingAttrs) freshAttrs["typeKey"] = existingAttrs["typeKey"];
              for (const attr of ["dataType", "mandatory", "maxLength", "minLength", "isMappable", "validateData"]) {
                if (attr in freshAttrs) existingAttrs[attr] = freshAttrs[attr];
              }
              // Recurse into nested XMLElement / XMLAttribute
              for (const nestedTag of ["XMLElement", "XMLAttribute"]) {
                const freshNested = xmlChildArray(freshType as XmlNode, nestedTag);
                const existingNested = xmlChildArray(existing, nestedTag);
                if (freshNested.length > 0 || existingNested.length > 0) {
                  existing[nestedTag] = mergeXmlNodes(existingNested, freshNested);
                }
              }
              merged.push(existing);
            } else {
              merged.push(freshType as XmlNode);
            }
          } else {
            merged.push(freshType as XmlNode);
          }
        }

        for (const t of templateTypeChildren) {
          const name = xmlNodeAttrs(t as XmlNode)?.name;
          if (name && !seen.has(name.toLowerCase())) {
            merged.push(t as XmlNode);
          }
        }

        templateTypes["Types"] = merged;
      }
    }

    return serialize(template);
  } catch {
    return templateXml;
  }
}

/**
 * @param templateXml - The existing Boomi DatabaseProfile template XML.
 * @param profile - The local Database profile whose DataElements should replace the template's.
 * @returns The patched XML with updated DBFields while preserving template-only metadata.
 */
/**
 * Patches an existing Boomi database profile template XML with current field definitions.
 */
export function patchDbProfile(templateXml: string, profile: Profile): string {
  const template = parseFragment(templateXml);
  const fresh = parseFragment(buildDbProfileXml(profile));
  const freshObj = getInnerObject(fresh);
  // For DB profiles we swap the entire DataElements subtree (the DBStatement + DBFields).
  const freshDataElements = findFirstByTag(freshObj, "DataElements");
  if (!freshDataElements) return templateXml;
  replaceChildrenByTag(template, "DataElements", freshDataElements["DataElements"] as unknown[]);
  return serialize(template);
}

/**
 * @param templateXml - The existing Boomi transform.map template XML.
 * @param project - The parent project for connection references.
 * @param mappingSet - The mapping set with rules and transform nodes.
 * @param sourceProfile - The source profile for field key reconciliation.
 * @param destinationProfile - The destination profile for field key reconciliation.
 * @param opts - Optional reconciled element keys and UUIDs.
 * @returns The patched transform-map XML with updated Mappings, Functions, and Defaults.
 */
/**
 * Patches an existing Boomi transform.map template XML with current mapping rules.
 * Reconciles source/target profile element keys for accurate Boomi-side binding.
 */
export function patchTransformMap(
  templateXml: string,
  project: Project,
  mappingSet: MappingSet,
  sourceProfile: Profile,
  destinationProfile: Profile,
  opts?: TransformMapOptions,
): string {
  const template = parseFragment(templateXml);
  const fresh = parseFragment(buildTransformMapXml(project, mappingSet, sourceProfile, destinationProfile, opts));
  const freshObj = getInnerObject(fresh);
  const freshMap = findFirstByTag(freshObj, "Map");
  if (!freshMap) return templateXml;
  const freshMappings = findFirstByTag([freshMap], "Mappings");
  const freshDefaults = findFirstByTag([freshMap], "Defaults");
  const freshFunctions = findFirstByTag([freshMap], "Functions");
  if (freshMappings) {
    replaceChildrenByTag(template, "Mappings", freshMappings["Mappings"] as unknown[]);
  }
  if (freshDefaults) {
    replaceChildrenByTag(template, "Defaults", freshDefaults["Defaults"] as unknown[]);
  }
  if (freshFunctions) {
    replaceChildrenByTag(template, "Functions", freshFunctions["Functions"] as unknown[]);
  }
  return serialize(template);
}

/**
 * Dispatches between scaffold and template-patch strategies for profiles and transform maps.
 * @param context - The component context: either a profile with an optional template, or a transform map with profiles.
 * @returns The generated XML, component type, and whether a template was patched or a scaffold was created.
 */
/**
 * Dispatcher that chooses scaffold vs template-patch mode for a given component kind
 * and returns the generated XML, component type, and reconciliation metadata.
 */
export function buildProposedXml(
  context:
    | { kind: "profile"; profile: Profile; templateXml?: string }
    | {
        kind: "transform.map";
        project: Project;
        mappingSet: MappingSet;
        sourceProfile: Profile;
        destinationProfile: Profile;
        templateXml?: string;
        sourceProfileTemplateXml?: string;
        destinationProfileTemplateXml?: string;
        lookupConnectionId?: string;
      },
): { xml: string; componentType: BoomiComponentDraft["componentType"]; source: "scaffold" | "template-patch"; reconciledKeys?: boolean } {
  if (context.kind === "profile") {
    const componentType = profileComponentType(context.profile);
    if (context.templateXml && context.templateXml.trim()) {
      if (componentType === "profile.flatfile") {
        return { xml: patchFlatFileProfile(context.templateXml, context.profile), componentType, source: "template-patch" };
      }
      if (componentType === "profile.json") {
        return { xml: patchJsonProfile(context.templateXml, context.profile), componentType, source: "template-patch" };
      }
      if (componentType === "profile.xml") {
        const patched = patchXmlProfile(context.templateXml, context.profile);
        return { xml: patched, componentType, source: patched === context.templateXml ? "scaffold" : "template-patch" };
      }
      if (componentType === "profile.db") {
        return { xml: patchDbProfile(context.templateXml, context.profile), componentType, source: "template-patch" };
      }
    }
    const { xml } = buildProfileXml(context.profile);
    return { xml, componentType, source: "scaffold" };
  }

  // transform.map
  const opts: TransformMapOptions = {};
  if (context.sourceProfileTemplateXml?.trim()) {
    opts.sourceElementKeys = extractProfileElementKeys(context.sourceProfileTemplateXml);
    opts.sourceBoomiId = extractBoomiComponentId(context.sourceProfileTemplateXml) ?? undefined;
  }
  if (context.destinationProfileTemplateXml?.trim()) {
    opts.destinationElementKeys = extractProfileElementKeys(context.destinationProfileTemplateXml);
    opts.destinationBoomiId = extractBoomiComponentId(context.destinationProfileTemplateXml) ?? undefined;
  }
  if (context.lookupConnectionId) {
    opts.lookupConnectionId = context.lookupConnectionId;
  }

  const reconciledKeys = Boolean(opts.sourceElementKeys?.size || opts.destinationElementKeys?.size);

  if (context.templateXml && context.templateXml.trim()) {
    const xml = patchTransformMap(
      context.templateXml,
      context.project,
      context.mappingSet,
      context.sourceProfile,
      context.destinationProfile,
      opts,
    );
    return { xml, componentType: "transform.map", source: "template-patch", reconciledKeys };
  }
  const xml = buildTransformMapXml(
    context.project, context.mappingSet, context.sourceProfile, context.destinationProfile, opts,
  );
  return { xml, componentType: "transform.map", source: "scaffold", reconciledKeys };
}

/**
 * Extract dependent component references from a Boomi process XML string.
 * @param processXml - The Boomi process XML content.
 * @returns An array of { componentId, componentType } for referenced maps, connectors, and subprocesses.
 */
/**
 * Walks a Boomi process XML and returns every referenced componentId with a role hint.
 * Used by the dependency scanner UI to show what a process draft depends on.
 */
export function extractProcessDependencies(processXml: string): Array<{ componentId: string; componentType: string }> {
  if (!processXml || !processXml.trim()) return [];
  const deps: Array<{ componentId: string; componentType: string }> = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;

  const mapRe = /<map\s[^>]*componentId="([^"]+)"[^>]*\/?>/g;
  while ((match = mapRe.exec(processXml))) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      deps.push({ componentId: id, componentType: "transform.map" });
    }
  }

  const connectorRe = /<connector\s[^>]*connection="([^"]+)"[^>]*\/?>/g;
  while ((match = connectorRe.exec(processXml))) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      deps.push({ componentId: id, componentType: "connector-settings" });
    }
  }

  const subprocessRe = /<subprocess\s[^>]*componentId="([^"]+)"[^>]*\/?>/g;
  while ((match = subprocessRe.exec(processXml))) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      deps.push({ componentId: id, componentType: "process" });
    }
  }

  return deps;
}
