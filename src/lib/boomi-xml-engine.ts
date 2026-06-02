/**
 * Boomi XML Generation Engine
 *
 * Generates platform-valid Boomi component XML based on the official
 * Boomi Companion reference documentation (boomi-integration skill).
 * Replaces the retired legacy boomi-xml.ts generators.
 *
 * Reference sources:
 *   - json_profile_component.md
 *   - flat_file_profile_component.md
 *   - xml_profile_component.md
 *   - rest_connection_component.md
 *   - rest_connector_operation_component.md
 *   - map_component.md
 *   - process_component.md
 */

import type {
  BoomiConnection,
  BuildEndpoint,
  BuildEndpointFieldRef,
  BuildMappingSet,
  BuildProcessFlow,
  BuildProcessFlowNode,
  BuildProfileRef,
} from "@/lib/domain";
import { escapeXml } from "@/lib/xml-utils";

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

const BOOMI_NS = "http://api.platform.boomi.com/";
const BOOMI_XSI = "http://www.w3.org/2001/XMLSchema-instance";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProfileKeyEntry = {
  key: number;
  fieldId: string;
  fieldName: string;
  path: string;
  isMappable: boolean;
};

export type ProfileKeyMap = ProfileKeyEntry[];

export type ComponentXmlResult = {
  xml: string;
  componentType: string;
  predictedKeys?: ProfileKeyMap;
};

export type ProcessComponentRefs = {
  connectionId: string;
  operationId: string;
  mapId?: string;
  sourceProfileId?: string;
  destProfileId?: string;
  connectorType?: string;
};

interface KeyCounter {
  next: number;
}
function newKeyCounter(start = 1): KeyCounter {
  return { next: start };
}
function nextKey(c: KeyCounter): number {
  return c.next++;
}

// ---------------------------------------------------------------------------
// Field tree building (flat list → nested for profile generation)
// ---------------------------------------------------------------------------

type FieldTreeNode = {
  field: BuildEndpointFieldRef;
  children: Map<string, FieldTreeNode>;
  isArray: boolean;
};

function buildFieldTree(
  fields: BuildEndpointFieldRef[],
  options: { stripJsonRootObject?: boolean } = {},
): Map<string, FieldTreeNode> {
  const root = new Map<string, FieldTreeNode>();

  for (const field of fields) {
    const parts = parseFieldPath(field, options);
    insertFieldNode(root, field, parts, 0);
  }

  return root;
}

function parseFieldPath(
  field: BuildEndpointFieldRef,
  options: { stripJsonRootObject?: boolean } = {},
): string[] {
  const raw = field.parentPath?.trim();
  if (!raw) return [field.name];

  const normalized = raw.replace(/\\/g, "/").replace(/\./g, "/");
  let segments = normalized.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (options.stripJsonRootObject) {
    segments = stripJsonRootObjectSegments(segments);
  }
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.endsWith("[]")) {
      const name = seg.slice(0, -2);
      if (name) parts.push(name + "[]");
    } else {
      parts.push(seg);
    }
  }
  parts.push(field.name);
  return parts;
}

function stripJsonRootObjectSegments(segments: string[]): string[] {
  let index = 0;
  if (segments[index]?.toLowerCase() === "root") index += 1;
  if (segments[index]?.toLowerCase() === "object") index += 1;
  return segments.slice(index);
}

function insertFieldNode(
  parent: Map<string, FieldTreeNode>,
  field: BuildEndpointFieldRef,
  parts: string[],
  idx: number,
): void {
  if (idx >= parts.length) return;
  const part = parts[idx];
  const isLast = idx === parts.length - 1;
  const isArray = part.endsWith("[]");
  const name = isArray ? part.slice(0, -2) : part;

  if (!parent.has(name)) {
    parent.set(name, {
      field: isLast ? field : { ...field, name },
      children: new Map(),
      isArray,
    });
  }

  const node = parent.get(name)!;
  if (isArray) node.isArray = true;

  if (!isLast) {
    insertFieldNode(node.children, field, parts, idx + 1);
  }
}

// ---------------------------------------------------------------------------
// Component envelope
// ---------------------------------------------------------------------------

function componentElementXml(innerXml: string): string {
  return `<bns:encryptedValues/>\n  <bns:object>\n${innerXml}\n  </bns:object>`;
}

function openComponent(
  name: string,
  type: string,
  folderId: string,
  componentId?: string,
  subType?: string,
  extraAttrs?: string,
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
  ];

  const attrs: string[] = [
    `xmlns:bns="${BOOMI_NS}"`,
    `xmlns:xsi="${BOOMI_XSI}"`,
    `componentId="${escapeXml(componentId ?? "")}"`,
    `name="${escapeXml(name)}"`,
    `type="${type}"`,
    `folderId="${escapeXml(folderId)}"`,
  ];

  if (componentId && componentId !== "") {
    attrs.push('version="1"');
    attrs.push('deleted="false"');
    attrs.push('currentVersion="true"');
    attrs.push('branchName="main"');
  }

  if (subType) {
    attrs.push(`subType="${escapeXml(subType)}"`);
  }

  if (extraAttrs) {
    attrs.push(extraAttrs);
  }

  lines.push(`<bns:Component ${attrs.join(" ")}>`);
  return lines.join("\n");
}

function closeComponent(): string {
  return "</bns:Component>";
}

function componentXml(
  name: string,
  type: string,
  folderId: string,
  innerXml: string,
  componentId?: string,
  subType?: string,
  extraAttrs?: string,
): string {
  const open = openComponent(name, type, folderId, componentId, subType, extraAttrs);
  const inner = componentElementXml(indent(innerXml, 2));
  const close = closeComponent();
  return `${open}\n${inner}\n${close}`;
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim() ? prefix + line : ""))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Data type mapping
// ---------------------------------------------------------------------------

export function mapBoomiDataType(field: BuildEndpointFieldRef): "character" | "number" | "datetime" | "boolean" {
  const t = (field.dataType ?? "").toLowerCase().trim();
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

function dataFormatXml(
  boomiType: "character" | "number" | "datetime" | "boolean",
  dateFormat?: string,
): string {
  if (boomiType === "number") {
    return '<DataFormat><ProfileNumberFormat numberFormat=""/></DataFormat>';
  }
  if (boomiType === "datetime") {
    const fmt = dateFormat?.trim() || "yyyyMMdd HHmmss.SSS";
    return `<DataFormat><ProfileDateFormat dateFormat="${escapeXml(fmt)}"/></DataFormat>`;
  }
  if (boomiType === "boolean") {
    return "<DataFormat><ProfileBooleanFormat/></DataFormat>";
  }
  return "<DataFormat><ProfileCharacterFormat/></DataFormat>";
}

// ---------------------------------------------------------------------------
// Profile: JSON
// ---------------------------------------------------------------------------

function escapeAttribute(value: string): string {
  return escapeXml(value);
}

export function generateJsonProfileXml(
  profile: BuildProfileRef,
  folderId: string,
  componentId?: string,
): ComponentXmlResult {
  const keyMap: ProfileKeyMap = [];
  const kc = newKeyCounter(1);

  // Root: key 1 (isMappable=true per Companion refs)
  const rootKey = nextKey(kc);
  const rootObjKey = nextKey(kc);
  keyMap.push({ key: rootKey, fieldId: "", fieldName: "Root", path: "Root", isMappable: true });
  keyMap.push({ key: rootObjKey, fieldId: "", fieldName: "Root/Object", path: "Root/Object", isMappable: false });

  const tree = buildFieldTree(profile.fields, { stripJsonRootObject: true });
  const entriesXml = renderJsonTree(tree, kc, keyMap, 1, "Root/Object");

  const innerXml = [
    '<JSONProfile strict="false">',
    "  <DataElements>",
    `    <JSONRootValue dataType="character" isMappable="true" isNode="true" key="${rootKey}" name="Root">`,
    "      <DataFormat><ProfileCharacterFormat/></DataFormat>",
    `      <JSONObject isMappable="false" isNode="true" key="${rootObjKey}" name="Object">`,
    entriesXml,
    "      </JSONObject>",
    "      <Qualifiers><QualifierList/></Qualifiers>",
    "    </JSONRootValue>",
    "  </DataElements>",
    "  <tagLists/>",
    "</JSONProfile>",
  ].join("\n");

  const xml = componentXml(profile.name, "profile.json", folderId, innerXml, componentId);
  return { xml, componentType: "profile.json", predictedKeys: keyMap };
}

function renderJsonTree(
  tree: Map<string, FieldTreeNode>,
  kc: KeyCounter,
  keyMap: ProfileKeyMap,
  depth: number,
  parentPath: string,
): string {
  const lines: string[] = [];
  const pad = " ".repeat(6 + depth * 2);

  for (const [name, node] of tree) {
    const currentPath = `${parentPath}/${name}`;
    if (node.isArray) {
      // Array: container entry (not mappable) → JSONArray → JSONArrayElement → children or data format
      const containerKey = nextKey(kc);
      const arrayKey = nextKey(kc);
      const elementKey = nextKey(kc);
      keyMap.push({ key: containerKey, fieldId: node.field.localFieldId, fieldName: name, path: currentPath, isMappable: false });
      keyMap.push({ key: arrayKey, fieldId: "", fieldName: `${name}[]`, path: `${currentPath}[]`, isMappable: false });

      const hasChildren = node.children.size > 0;
      keyMap.push({ key: elementKey, fieldId: node.field.localFieldId, fieldName: name, path: `${currentPath}[]`, isMappable: !hasChildren });

      lines.push(`${pad}<JSONObjectEntry dataType="character" isMappable="false" isNode="true" key="${containerKey}" name="${escapeAttribute(name)}">`);
      lines.push(`${pad}  <DataFormat><ProfileCharacterFormat/></DataFormat>`);
      lines.push(`${pad}  <JSONArray elementType="repeating" isMappable="false" isNode="true" key="${arrayKey}" name="${escapeAttribute(name)}">`);

      if (hasChildren) {
        lines.push(`${pad}    <JSONArrayElement dataType="character" isMappable="false" isNode="true" key="${elementKey}" maxOccurs="-1" minOccurs="0" name="ArrayElement1">`);
        const objKey = nextKey(kc);
        keyMap.push({ key: objKey, fieldId: "", fieldName: `${name}[]/Object`, path: `${currentPath}[]/Object`, isMappable: false });
        lines.push(`${pad}      <JSONObject isMappable="false" isNode="true" key="${objKey}" name="Object">`);
        lines.push(renderJsonTree(node.children, kc, keyMap, depth + 3, `${currentPath}[]/Object`));
        lines.push(`${pad}      </JSONObject>`);
        lines.push(`${pad}    </JSONArrayElement>`);
      } else {
        // Primitive array — single element with data format
        const boomiType = mapBoomiDataType(node.field);
        const fmt = dataFormatXml(boomiType, node.field.format);
        lines.push(`${pad}    <JSONArrayElement dataType="${boomiType}" isMappable="true" isNode="true" key="${elementKey}" maxOccurs="-1" minOccurs="0" name="ArrayElement1">`);
        lines.push(`${pad}      ${fmt}`);
        lines.push(`${pad}    </JSONArrayElement>`);
      }

      lines.push(`${pad}  </JSONArray>`);
      lines.push(`${pad}</JSONObjectEntry>`);
    } else if (node.children.size > 0) {
      // Nested object: container entry (not mappable) → JSONObject → children
      const containerKey = nextKey(kc);
      keyMap.push({ key: containerKey, fieldId: node.field.localFieldId, fieldName: name, path: currentPath, isMappable: false });

      lines.push(`${pad}<JSONObjectEntry dataType="character" isMappable="false" isNode="true" key="${containerKey}" name="${escapeAttribute(name)}">`);
      lines.push(`${pad}  <DataFormat><ProfileCharacterFormat/></DataFormat>`);
      const objKey = nextKey(kc);
      keyMap.push({ key: objKey, fieldId: "", fieldName: `${name}/Object`, path: `${currentPath}/Object`, isMappable: false });
      lines.push(`${pad}  <JSONObject isMappable="false" isNode="true" key="${objKey}" name="Object">`);
      lines.push(renderJsonTree(node.children, kc, keyMap, depth + 1, `${currentPath}/Object`));
      lines.push(`${pad}  </JSONObject>`);
      lines.push(`${pad}</JSONObjectEntry>`);
    } else {
      // Leaf field
      const fieldKey = nextKey(kc);
      const boomiType = mapBoomiDataType(node.field);
      const fmt = dataFormatXml(boomiType, node.field.format);
      keyMap.push({ key: fieldKey, fieldId: node.field.localFieldId, fieldName: name, path: currentPath, isMappable: true });

      lines.push(`${pad}<JSONObjectEntry dataType="${boomiType}" isMappable="true" isNode="true" key="${fieldKey}" name="${escapeAttribute(name)}">`);
      lines.push(`${pad}  ${fmt}`);
      lines.push(`${pad}</JSONObjectEntry>`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Profile: Flat File
// ---------------------------------------------------------------------------

function flatFileDelimiter(format: string): string {
  const f = format.toLowerCase();
  if (f.includes("csv") || f.includes("comma")) return "commadelimited";
  if (f.includes("tsv") || f.includes("tab")) return "tabdelimited";
  if (f.includes("pipe") || f.includes("|")) return "bardelimited";
  if (f.includes("star") || f.includes("*")) return "stardelimited";
  if (f.includes("tick") || f.includes("`")) return "tickdelimited";
  return "commadelimited";
}

export function generateFlatFileProfileXml(
  profile: BuildProfileRef,
  folderId: string,
  componentId?: string,
): ComponentXmlResult {
  const keyMap: ProfileKeyMap = [];
  const kc = newKeyCounter(1);
  const isDataPositioned = profile.format?.toLowerCase().includes("fixed") || profile.format?.toLowerCase().includes("positioned");

  // Record key 1, Elements key 2
  const recordKey = nextKey(kc);
  const elementsKey = nextKey(kc);
  keyMap.push({ key: recordKey, fieldId: "", fieldName: "Record", path: "Record", isMappable: false });
  keyMap.push({ key: elementsKey, fieldId: "", fieldName: "Elements", path: "Record/Elements", isMappable: false });

  const fileType = isDataPositioned ? "datapositioned" : "delimited";
  const delimiter = flatFileDelimiter(profile.format ?? "csv");
  const textQualifier = profile.format?.toLowerCase().includes("csv") ? "textqualifierdouble" : "na";

  let optionsXml: string;
  if (isDataPositioned) {
    optionsXml = [
      "<Options>",
      '  <DataOptions padcharacter=" "/>',
      `  <DelimitedOptions fileDelimiter="${delimiter}" removeEscape="false" textQualifier="${textQualifier}"/>`,
      "</Options>",
    ].join("\n");
  } else {
    optionsXml = [
      "<Options>",
      "  <DataOptions/>",
      `  <DelimitedOptions fileDelimiter="${delimiter}" removeEscape="false" textQualifier="${textQualifier}"/>`,
      "</Options>",
    ].join("\n");
  }

  const sorted = [...profile.fields].sort((a, b) => a.ordinal - b.ordinal);
  const fieldLines: string[] = [];
  for (const field of sorted) {
    const fieldKey = nextKey(kc);
    const boomiType = mapBoomiDataType(field);
    const fmt = dataFormatXml(boomiType, field.format);

    keyMap.push({
      key: fieldKey,
      fieldId: field.localFieldId,
      fieldName: field.name,
      path: `Record/${field.name}`,
      isMappable: true,
    });

    const extraAttrs: string[] = [];
    if (isDataPositioned) {
      extraAttrs.push(`startColumn="0"`);
      extraAttrs.push(`length="0"`);
      extraAttrs.push(`justification="left"`);
    }

    fieldLines.push(
      `    <FlatFileElement dataType="${boomiType}" enforceUnique="false" isMappable="true" isNode="true" key="${fieldKey}" mandatory="false" maxLength="0" minLength="0" name="${escapeAttribute(field.name)}" validateData="false"${extraAttrs.length ? " " + extraAttrs.join(" ") : ""}>`,
    );
    fieldLines.push(`      ${fmt}`);
    fieldLines.push("    </FlatFileElement>");
  }

  const innerXml = [
    '<FlatFileProfile modelVersion="2" strict="true">',
    "  <ProfileProperties>",
    `    <GeneralInfo fileType="${fileType}" useColumnHeaders="false"/>`,
    `    ${indent(optionsXml, 2)}`,
    "  </ProfileProperties>",
    "  <DataElements>",
    `    <FlatFileRecord detectFormat="numberofcolumns" isNode="true" key="${recordKey}" name="Record">`,
    `      <FlatFileElements isNode="true" key="${elementsKey}" name="Elements">`,
    fieldLines.join("\n"),
    "      </FlatFileElements>",
    "    </FlatFileRecord>",
    "  </DataElements>",
    "</FlatFileProfile>",
  ].join("\n");

  const xml = componentXml(profile.name, "profile.flatfile", folderId, innerXml, componentId);
  return { xml, componentType: "profile.flatfile", predictedKeys: keyMap };
}

// ---------------------------------------------------------------------------
// Profile: XML
// ---------------------------------------------------------------------------

export function generateXmlProfileXml(
  profile: BuildProfileRef,
  folderId: string,
  componentId?: string,
): ComponentXmlResult {
  const keyMap: ProfileKeyMap = [];
  const kc = newKeyCounter(1);

  const tree = buildFieldTree(profile.fields);
  const elementsXml = renderXmlTree(tree, kc, keyMap, 1, profile);
  const hasExtraNs = false; // could add namespace support later

  const innerXml = [
    '<XMLProfile modelVersion="2" strict="true">',
    "  <ProfileProperties>",
    "    <XMLGeneralInfo/>",
    '    <XMLOptions encoding="utf8" implicitElementOrdering="true" parseRespectMaxOccurs="true">',
    "      <XMLFlavor><CustomStandardFlavor/></XMLFlavor>",
    "    </XMLOptions>",
    "  </ProfileProperties>",
    "  <DataElements>",
    elementsXml,
    "  </DataElements>",
    `  <Namespaces/>`,
    `${hasExtraNs ? "" : "  <tagLists/>"}`,
    "</XMLProfile>",
  ].join("\n");

  const xml = componentXml(profile.name, "profile.xml", folderId, innerXml, componentId);
  return { xml, componentType: "profile.xml", predictedKeys: keyMap };
}

function renderXmlTree(
  tree: Map<string, FieldTreeNode>,
  kc: KeyCounter,
  keyMap: ProfileKeyMap,
  depth: number,
  profile: BuildProfileRef,
  parentPath?: string,
): string {
  const lines: string[] = [];
  const pad = " ".repeat(2 + depth * 2);

  // If there's only one top-level element and it has children, use it as root
  // Otherwise wrap in a root record element
  const entries: [string, FieldTreeNode][] = [...tree.entries()];

  for (const [name, node] of entries) {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    const boomiType = mapBoomiDataType(node.field);

    if (node.isArray || node.children.size > 0) {
      // Repeating element or container
      const elementKey = nextKey(kc);
      const maxOccurs = node.isArray ? "-1" : "1";
      keyMap.push({ key: elementKey, fieldId: node.field.localFieldId, fieldName: name, path: fullPath, isMappable: false });

      const fmt = dataFormatXml(boomiType, node.field.format);
      lines.push(`${pad}<XMLElement dataType="${boomiType}" isMappable="false" isNode="true" key="${elementKey}" maxOccurs="${maxOccurs}" minOccurs="0" name="${escapeAttribute(name)}" useNamespace="-1">`);
      lines.push(`${pad}  ${fmt}`);
      if (node.children.size > 0) {
        lines.push(renderXmlTree(node.children, kc, keyMap, depth + 1, profile, fullPath));
      }
      lines.push(`${pad}</XMLElement>`);
    } else {
      // Leaf field
      const elementKey = nextKey(kc);
      keyMap.push({ key: elementKey, fieldId: node.field.localFieldId, fieldName: name, path: fullPath, isMappable: true });

      const fmt = dataFormatXml(boomiType, node.field.format);
      lines.push(`${pad}<XMLElement dataType="${boomiType}" isMappable="true" isNode="true" key="${elementKey}" maxOccurs="1" minOccurs="0" name="${escapeAttribute(name)}" useNamespace="-1">`);
      lines.push(`${pad}  ${fmt}`);
      lines.push(`${pad}</XMLElement>`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Profile: Database
// ---------------------------------------------------------------------------

export function generateDbProfileXml(
  profile: BuildProfileRef,
  folderId: string,
  componentId?: string,
): ComponentXmlResult {
  const keyMap: ProfileKeyMap = [];
  const kc = newKeyCounter(1);

  const sorted = [...profile.fields].sort((a, b) => a.ordinal - b.ordinal);
  const columnLines: string[] = [];

  for (const field of sorted) {
    const fieldKey = nextKey(kc);
    const boomiType = mapBoomiDataType(field);
    const fmt = dataFormatXml(boomiType, field.format);
    keyMap.push({
      key: fieldKey,
      fieldId: field.localFieldId,
      fieldName: field.name,
      path: field.name,
      isMappable: true,
    });

    columnLines.push(
      `      <DBColumnElement dataType="${boomiType}" isMappable="true" isNode="true" key="${fieldKey}" keyField="${field.keyField}" name="${escapeAttribute(field.name)}" required="${field.required}">`,
    );
    columnLines.push(`        ${fmt}`);
    columnLines.push("      </DBColumnElement>");
  }

  const innerXml = [
    "<DBProfile>",
    "  <DataElements>",
    ...columnLines,
    "  </DataElements>",
    "</DBProfile>",
  ].join("\n");

  const xml = componentXml(profile.name, "profile.db", folderId, innerXml, componentId);
  return { xml, componentType: "profile.db", predictedKeys: keyMap };
}

// ---------------------------------------------------------------------------
// Profile: dispatcher
// ---------------------------------------------------------------------------

export function generateProfileXml(
  profile: BuildProfileRef,
  folderId: string,
  componentId?: string,
): ComponentXmlResult {
  switch (profile.type) {
    case "JSON":
    case "API":
      return generateJsonProfileXml(profile, folderId, componentId);
    case "Flat File":
      return generateFlatFileProfileXml(profile, folderId, componentId);
    case "XML":
      return generateXmlProfileXml(profile, folderId, componentId);
    case "Database":
      return generateDbProfileXml(profile, folderId, componentId);
    default:
      return generateJsonProfileXml(profile, folderId, componentId);
  }
}

export function profileComponentType(profile: BuildProfileRef): string {
  switch (profile.type) {
    case "JSON":
    case "API":
      return "profile.json";
    case "Flat File":
      return "profile.flatfile";
    case "XML":
      return "profile.xml";
    case "Database":
      return "profile.db";
    default:
      return "profile.json";
  }
}

// ---------------------------------------------------------------------------
// Connection: REST
// ---------------------------------------------------------------------------

export function generateRestConnectionXml(
  endpoint: BuildEndpoint,
  folderId: string,
  connection: BoomiConnection,
  componentId?: string,
): string {
  const authMode = "BASIC";
  const baseUrl = connection.baseUrl || "https://api.example.com";

  const fieldXml = [
    `<field id="url" type="string" value="${escapeAttribute(baseUrl)}"/>`,
    `<field id="auth" type="string" value="${authMode}"/>`,
    `<field id="username" type="string" value="${escapeAttribute(connection.apiUsername)}"/>`,
    `<field id="password" type="password" value="${escapeAttribute(connection.apiPassword)}"/>`,
    '<field id="preemptive" type="boolean" value="true"/>',
    '<field id="connectTimeout" type="integer" value="-1"/>',
    '<field id="readTimeout" type="integer" value="-1"/>',
    '<field id="cookieScope" type="string" value="GLOBAL"/>',
    '<field id="enableConnectionPooling" type="boolean" value="false"/>',
    // Empty/unused fields
    '<field id="domain" type="string" value=""/>',
    '<field id="workstation" type="string" value=""/>',
    '<field id="customAuthCredentials" type="password" value=""/>',
    '<field id="awsAccessKey" type="string" value=""/>',
    '<field id="awsSecretKey" type="password" value=""/>',
    '<field id="awsService" type="string" value=""/>',
    '<field id="customAwsService" type="string" value=""/>',
    '<field id="awsRegion" type="string" value=""/>',
    '<field id="customAwsRegion" type="string" value=""/>',
    '<field id="awsProfileArn" type="string" value=""/>',
    '<field id="awsRoleArn" type="string" value=""/>',
    '<field id="awsTrustAnchorArn" type="string" value=""/>',
    '<field id="awsRolesAnywhereRegion" type="string" value=""/>',
    '<field id="awsRolesAnywhereCustomRegion" type="string" value=""/>',
    '<field id="awsSessionName" type="string" value=""/>',
    '<field id="awsDuration" type="integer" value=""/>',
    '<field id="awsPublicCertificate" type="publiccertificate" value=""/>',
    '<field id="awsPrivateKey" type="privatecertificate" value=""/>',
    [
      '<field id="oauthContext" type="oauth">',
      '  <OAuth2Config grantType="code">',
      '    <credentials clientId=""/>',
      '    <authorizationTokenEndpoint url="">',
      '      <sslOptions/>',
      '    </authorizationTokenEndpoint>',
      '    <authorizationParameters/>',
      '    <accessTokenEndpoint url="">',
      '      <sslOptions/>',
      '    </accessTokenEndpoint>',
      '    <accessTokenParameters/>',
      '    <scope/>',
      '    <jwtParameters>',
      '      <expiration>0</expiration>',
      '    </jwtParameters>',
      '  </OAuth2Config>',
      '</field>',
    ].join("\n"),
    '<field id="privateCertificate" type="privatecertificate"/>',
    '<field id="publicCertificate" type="publiccertificate"/>',
    '<field id="maxTotal" type="integer" value=""/>',
    '<field id="idleTimeout" type="integer" value=""/>',
  ].join("\n");

  const innerXml = [
    "<GenericConnectionConfig>",
    fieldXml,
    "</GenericConnectionConfig>",
  ].join("\n");

  return componentXml(
    endpoint.name,
    "connector-settings",
    folderId,
    innerXml,
    componentId,
    "officialboomi-X3979C-rest-prod",
  );
}

// ---------------------------------------------------------------------------
// Connection: dispatcher
// ---------------------------------------------------------------------------

export function generateConnectionXml(
  endpoint: BuildEndpoint,
  folderId: string,
  connection: BoomiConnection,
  existingComponentId?: string,
): string {
  const ct = (endpoint.connectorType ?? "REST").toLowerCase();
  if (ct.includes("rest") || ct.includes("http")) {
    return generateRestConnectionXml(endpoint, folderId, connection, existingComponentId);
  }
  if (ct.includes("database") || ct.includes("db")) {
    return generateDatabaseConnectionXml(endpoint, folderId, connection, existingComponentId);
  }
  if (ct.includes("disk")) {
    return generateDiskV2ConnectionXml(endpoint, folderId, connection, existingComponentId);
  }
  if (ct.includes("event") || ct.includes("stream")) {
    return generateEventStreamsConnectionXml(endpoint, folderId, connection, existingComponentId);
  }
  if (ct.includes("mail") || ct.includes("imap") || ct.includes("smtp") || ct.includes("email")) {
    return generateMailImapConnectionXml(endpoint, folderId, connection, existingComponentId);
  }
  if (ct.includes("mft") || ct.includes("thru")) {
    return generateMftConnectionXml(endpoint, folderId, connection, existingComponentId);
  }
  if (ct.includes("mcp")) {
    return generateMcpServerConnectionXml(endpoint, folderId, connection, existingComponentId);
  }
  return generateRestConnectionXml(endpoint, folderId, connection, existingComponentId);
}

function generateDatabaseConnectionXml(
  endpoint: BuildEndpoint,
  folderId: string,
  connection: BoomiConnection,
  componentId?: string,
): string {
  const innerXml = [
    "<GenericConnectionConfig>",
    `<field id="jdbcUrl" type="string" value="${escapeAttribute(connection.baseUrl)}"/>`,
    `<field id="driverClass" type="string" value=""/>`,
    `<field id="username" type="string" value="${escapeAttribute(connection.apiUsername)}"/>`,
    `<field id="password" type="password" value="${escapeAttribute(connection.apiPassword)}"/>`,
    "</GenericConnectionConfig>",
  ].join("\n");

  return componentXml(
    endpoint.name,
    "connector-settings",
    folderId,
    innerXml,
    componentId,
    "officialboomi-X3979C-dbv2da-prod",
  );
}

function generateDiskV2ConnectionXml(
  endpoint: BuildEndpoint,
  folderId: string,
  connection: BoomiConnection,
  componentId?: string,
): string {
  const innerXml = [
    "<GenericConnectionConfig>",
    `<field id="directory" type="string" value=""/>`,
    '<field id="filter" type="string" value="*.*"/>',
    "</GenericConnectionConfig>",
  ].join("\n");

  return componentXml(
    endpoint.name,
    "connector-settings",
    folderId,
    innerXml,
    componentId,
    "disk-sdk",
  );
}

function generateEventStreamsConnectionXml(
  endpoint: BuildEndpoint,
  folderId: string,
  connection: BoomiConnection,
  componentId?: string,
): string {
  const innerXml = [
    "<GenericConnectionConfig>",
    `<field id="environmentToken" type="password" value="${escapeAttribute(connection.apiPassword)}"/>`,
    "</GenericConnectionConfig>",
  ].join("\n");

  return componentXml(
    endpoint.name,
    "connector-settings",
    folderId,
    innerXml,
    componentId,
    "officialboomi-X3979C-events-prod",
  );
}

function generateMailImapConnectionXml(
  endpoint: BuildEndpoint,
  folderId: string,
  connection: BoomiConnection,
  componentId?: string,
): string {
  const innerXml = [
    "<GenericConnectionConfig>",
    `<field id="host" type="string" value="${escapeAttribute(connection.baseUrl)}"/>`,
    `<field id="username" type="string" value="${escapeAttribute(connection.apiUsername)}"/>`,
    `<field id="password" type="password" value="${escapeAttribute(connection.apiPassword)}"/>`,
    '<field id="authType" type="string" value="basic"/>',
    '<field id="security" type="string" value="SSL_TLS"/>',
    "</GenericConnectionConfig>",
  ].join("\n");

  return componentXml(
    endpoint.name,
    "connector-settings",
    folderId,
    innerXml,
    componentId,
    "mailsdk",
  );
}

function generateMftConnectionXml(
  endpoint: BuildEndpoint,
  folderId: string,
  connection: BoomiConnection,
  componentId?: string,
): string {
  const innerXml = [
    "<GenericConnectionConfig>",
    `<field id="partnerId" type="string" value=""/>`,
    "</GenericConnectionConfig>",
  ].join("\n");

  return componentXml(
    endpoint.name,
    "connector-settings",
    folderId,
    innerXml,
    componentId,
    "thru-8SHH0W-thrumf-technology",
  );
}

function generateMcpServerConnectionXml(
  endpoint: BuildEndpoint,
  folderId: string,
  connection: BoomiConnection,
  componentId?: string,
): string {
  const innerXml = [
    "<GenericConnectionConfig>",
    `<field id="serverName" type="string" value="${escapeAttribute(endpoint.name)}"/>`,
    "</GenericConnectionConfig>",
  ].join("\n");

  return componentXml(
    endpoint.name,
    "connector-settings",
    folderId,
    innerXml,
    componentId,
    "officialboomi-X3979C-mcp-prod",
  );
}

// ---------------------------------------------------------------------------
// Operation: REST
// ---------------------------------------------------------------------------

export function generateRestOperationXml(
  endpoint: BuildEndpoint,
  connectionComponentId: string,
  folderId: string,
  componentId?: string,
): string {
  const method = endpoint.purpose?.toUpperCase().includes("POST")
    ? "POST"
    : endpoint.purpose?.toUpperCase().includes("PUT")
      ? "PUT"
      : endpoint.purpose?.toUpperCase().includes("DELETE")
        ? "DELETE"
        : "GET";

  const path = "";

  const innerXml = [
    '<Operation returnApplicationErrors="false" trackResponse="false">',
    '  <Archiving directory="" enabled="false"/>',
    "  <Configuration>",
    `    <GenericOperationConfig customOperationType="${method}" operationType="EXECUTE">`,
    '      <field id="followRedirects" type="string" value="NONE"/>',
    `      <field id="path" type="string" value="${escapeAttribute(path)}"/>`,
    '      <field id="queryParameters" type="customproperties">',
    "        <customProperties/>",
    "      </field>",
    '      <field id="requestHeaders" type="customproperties">',
    "        <customProperties/>",
    "      </field>",
    "      <Options/>",
    "    </GenericOperationConfig>",
    "  </Configuration>",
    "  <Tracking>",
    "    <TrackedFields/>",
    "  </Tracking>",
    "  <Caching/>",
    "</Operation>",
  ].join("\n");

  return componentXml(
    `${endpoint.name} Operation`,
    "connector-action",
    folderId,
    innerXml,
    componentId,
    "officialboomi-X3979C-rest-prod",
  );
}

export function generateOperationXml(
  endpoint: BuildEndpoint,
  connectionComponentId: string,
  folderId: string,
  existingComponentId?: string,
): string {
  const ct = (endpoint.connectorType ?? "REST").toLowerCase();
  if (ct.includes("rest") || ct.includes("http")) {
    return generateRestOperationXml(endpoint, connectionComponentId, folderId, existingComponentId);
  }
  if (ct.includes("database") || ct.includes("db")) {
    return generateDatabaseOperationXml(endpoint, connectionComponentId, folderId, existingComponentId);
  }
  if (ct.includes("disk")) {
    return generateDiskV2OperationXml(endpoint, connectionComponentId, folderId, existingComponentId);
  }
  if (ct.includes("event") || ct.includes("stream")) {
    return generateEventStreamsOperationXml(endpoint, connectionComponentId, folderId, existingComponentId);
  }
  if (ct.includes("mail") || ct.includes("imap") || ct.includes("smtp") || ct.includes("email")) {
    return generateMailImapOperationXml(endpoint, connectionComponentId, folderId, existingComponentId);
  }
  if (ct.includes("mft") || ct.includes("thru")) {
    return generateMftOperationXml(endpoint, connectionComponentId, folderId, existingComponentId);
  }
  if (ct.includes("mcp")) {
    return generateMcpServerOperationXml(endpoint, connectionComponentId, folderId, existingComponentId);
  }
  return generateRestOperationXml(endpoint, connectionComponentId, folderId, existingComponentId);
}

function generateDatabaseOperationXml(
  endpoint: BuildEndpoint,
  connectionComponentId: string,
  folderId: string,
  componentId?: string,
): string {
  const innerXml = [
    '<Operation returnApplicationErrors="false" trackResponse="false">',
    "  <Configuration>",
    "    <GenericOperationConfig>",
    `      <field id="connectionId" type="string" value="${escapeAttribute(connectionComponentId)}"/>`,
    '      <field id="sql" type="string" value=""/>',
    "    </GenericOperationConfig>",
    "  </Configuration>",
    "</Operation>",
  ].join("\n");

  return componentXml(
    `${endpoint.name} Operation`,
    "connector-action",
    folderId,
    innerXml,
    componentId,
    "officialboomi-X3979C-dbv2da-prod",
  );
}

function generateDiskV2OperationXml(
  endpoint: BuildEndpoint,
  connectionComponentId: string,
  folderId: string,
  componentId?: string,
): string {
  const innerXml = [
    '<Operation returnApplicationErrors="false" trackResponse="false">',
    "  <Configuration>",
    "    <GenericOperationConfig>",
    `      <field id="connectionId" type="string" value="${escapeAttribute(connectionComponentId)}"/>`,
    '      <field id="action" type="string" value="GET"/>',
    "    </GenericOperationConfig>",
    "  </Configuration>",
    "</Operation>",
  ].join("\n");

  return componentXml(
    `${endpoint.name} Operation`,
    "connector-action",
    folderId,
    innerXml,
    componentId,
    "disk-sdk",
  );
}

function generateEventStreamsOperationXml(
  endpoint: BuildEndpoint,
  connectionComponentId: string,
  folderId: string,
  componentId?: string,
): string {
  const innerXml = [
    '<Operation returnApplicationErrors="false" trackResponse="false">',
    "  <Configuration>",
    "    <GenericOperationConfig>",
    `      <field id="connectionId" type="string" value="${escapeAttribute(connectionComponentId)}"/>`,
    '      <field id="topic" type="string" value=""/>',
    "    </GenericOperationConfig>",
    "  </Configuration>",
    "</Operation>",
  ].join("\n");

  return componentXml(
    `${endpoint.name} Operation`,
    "connector-action",
    folderId,
    innerXml,
    componentId,
    "officialboomi-X3979C-events-prod",
  );
}

function generateMailImapOperationXml(
  endpoint: BuildEndpoint,
  connectionComponentId: string,
  folderId: string,
  componentId?: string,
): string {
  const innerXml = [
    '<Operation returnApplicationErrors="false" trackResponse="false">',
    "  <Configuration>",
    "    <GenericOperationConfig>",
    `      <field id="connectionId" type="string" value="${escapeAttribute(connectionComponentId)}"/>`,
    '      <field id="operationType" type="string" value="RECEIVE"/>',
    "    </GenericOperationConfig>",
    "  </Configuration>",
    "</Operation>",
  ].join("\n");

  return componentXml(
    `${endpoint.name} Operation`,
    "connector-action",
    folderId,
    innerXml,
    componentId,
    "mailsdk",
  );
}

function generateMftOperationXml(
  endpoint: BuildEndpoint,
  connectionComponentId: string,
  folderId: string,
  componentId?: string,
): string {
  const innerXml = [
    '<Operation returnApplicationErrors="false" trackResponse="false">',
    "  <Configuration>",
    "    <GenericOperationConfig>",
    `      <field id="connectionId" type="string" value="${escapeAttribute(connectionComponentId)}"/>`,
    '      <field id="action" type="string" value="PICKUP"/>',
    "    </GenericOperationConfig>",
    "  </Configuration>",
    "</Operation>",
  ].join("\n");

  return componentXml(
    `${endpoint.name} Operation`,
    "connector-action",
    folderId,
    innerXml,
    componentId,
    "thru-8SHH0W-thrumf-technology",
  );
}

function generateMcpServerOperationXml(
  endpoint: BuildEndpoint,
  connectionComponentId: string,
  folderId: string,
  componentId?: string,
): string {
  const innerXml = [
    '<Operation returnApplicationErrors="false" trackResponse="false">',
    "  <Configuration>",
    "    <GenericOperationConfig>",
    `      <field id="connectionId" type="string" value="${escapeAttribute(connectionComponentId)}"/>`,
    '      <field id="toolName" type="string" value="boomi-tool"/>',
    "    </GenericOperationConfig>",
    "  </Configuration>",
    "</Operation>",
  ].join("\n");

  return componentXml(
    `${endpoint.name} Operation`,
    "connector-action",
    folderId,
    innerXml,
    componentId,
    "officialboomi-X3979C-mcp-prod",
  );
}

// ---------------------------------------------------------------------------
// Map: Transform Map
// ---------------------------------------------------------------------------

export function generateMapXml(
  mappingSet: BuildMappingSet,
  sourceProfileId: string,
  destProfileId: string,
  sourceKeys: ProfileKeyMap,
  destKeys: ProfileKeyMap,
  folderId: string,
  componentId?: string,
): string {
  const sourceMappableKeys = sourceKeys.filter((k) => k.isMappable);
  const destMappableKeys = destKeys.filter((k) => k.isMappable);

  // Build field-name lookup for source field names
  const sourceFieldNameToKey = new Map<string, number>();
  for (const entry of sourceMappableKeys) {
    sourceFieldNameToKey.set(entry.fieldName.toLowerCase(), entry.key);
  }

  // Build mappings from rules
  const mappings: string[] = [];
  const defaults: string[] = [];

  for (const rule of mappingSet.rules) {
    if (rule.mappingType === "constant" && rule.defaultValue) {
      // Constant → Default
      const destEntry = destMappableKeys.find((k) => k.fieldId === rule.destinationFieldId);
      if (destEntry) {
        defaults.push(`    <Default toKey="${destEntry.key}" value="${escapeAttribute(rule.defaultValue)}"/>`);
      }
      continue;
    }

    // Find source key by field name
    let sourceKey: number | undefined;
    if (rule.sourceFieldName) {
      sourceKey = sourceFieldNameToKey.get(rule.sourceFieldName.toLowerCase());
    }

    // Find destination key
    const destKey = destMappableKeys.find((k) => k.fieldId === rule.destinationFieldId)?.key;

    if (rule.mappingType === "function" && rule.expression) {
      // Function mapping — add to Functions section
      mappings.push(
        `    <Mapping fromKey="${sourceKey ?? 0}" fromType="profile" toKey="${destKey ?? 0}" toType="profile"/>`,
      );
      // Function entries would go in Functions section
      continue;
    }

    if (sourceKey && destKey) {
      mappings.push(
        `    <Mapping fromKey="${sourceKey}" fromType="profile" toKey="${destKey}" toType="profile"/>`,
      );
    } else if (destKey && rule.defaultValue) {
      // No source field matched, but has default
      defaults.push(`    <Default toKey="${destKey}" value="${escapeAttribute(rule.defaultValue)}"/>`);
    }
  }

  if (mappings.length === 0) {
    mappings.push("    <!-- No mappable field pairs found -->");
  }

  const functionsXml = '<Functions optimizeExecutionOrder="true"/>';

  const innerXml = [
    `<Map fromProfile="${escapeAttribute(sourceProfileId)}" toProfile="${escapeAttribute(destProfileId)}">`,
    "  <Mappings>",
    mappings.join("\n"),
    "  </Mappings>",
    functionsXml,
    "  <Defaults>",
    defaults.length > 0 ? defaults.join("\n") : "",
    "  </Defaults>",
    "  <DocumentCacheJoins/>",
    "</Map>",
  ].join("\n");

  return componentXml(mappingSet.name, "transform.map", folderId, innerXml, componentId);
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

type ShapePosition = { x: number; y: number };
const SHAPE_SPACING_X = 225;
const SHAPE_BASE_Y = 48;

function shapePosition(index: number, branchIndex = 0): ShapePosition {
  return {
    x: 48 + index * SHAPE_SPACING_X,
    y: SHAPE_BASE_Y + branchIndex * 320,
  };
}

function dragpointXml(index: number, toShapeName: string): string {
  const fromPos = shapePosition(index);
  const toPos = shapePosition(index + 1);
  return `<dragpoint name="shape${index}.dragpoint1" toShape="${toShapeName}" x="${(fromPos.x + toPos.x) / 2}" y="${(fromPos.y + toPos.y) / 2}"/>`;
}

function branchDragpointXml(index: number, toShapeName: string, identifier: number): string {
  const fromPos = shapePosition(index);
  const toPos = shapePosition(index, identifier - 1);
  return `<dragpoint identifier="${identifier}" name="shape${index}.dragpoint${identifier}" text="${identifier}" toShape="${toShapeName}" x="${(fromPos.x + toPos.x) / 2}" y="${(fromPos.y + toPos.y) / 2}"/>`;
}

function decisionDragpointXml(index: number, toShapeName: string, identifier: string, text: string): string {
  const fromPos = shapePosition(index);
  return `<dragpoint identifier="${identifier}" name="shape${index}.${identifier}" text="${text}" toShape="${toShapeName}" x="${fromPos.x + SHAPE_SPACING_X / 2}" y="${fromPos.y - 120}"/>`;
}

function routeDragpointXml(index: number, toShapeName: string, identifier: string, text: string): string {
  const fromPos = shapePosition(index);
  return `<dragpoint identifier="${identifier}" name="shape${index}.${identifier}" text="${text}" toShape="${toShapeName}" x="${fromPos.x + SHAPE_SPACING_X / 2}" y="${fromPos.y - 120}"/>`;
}

type ShapeDef = {
  shapetype: string;
  image: string;
  configXml: string;
  dragpointsXml: string;
};

function nodeToShape(
  node: BuildProcessFlowNode,
  index: number,
  nextShapeName: string | null,
  isTerminal: boolean,
  componentRefs: ProcessComponentRefs,
): ShapeDef {
  let shapetype: string;
  let image: string;
  let configXml: string;
  let dragpointsXml = "";

  switch (node.type) {
    case "start":
    case "start-passthrough":
      shapetype = "start";
      image = "start";
      configXml = "<passthroughaction/>";
      break;

    case "start-nodata":
      shapetype = "start";
      image = "start";
      configXml = "<noaction/>";
      break;

    case "start-connector":
      shapetype = "start";
      image = "start";
      configXml = `<connectoraction actionType="Listen" connectionId="${escapeAttribute(componentRefs.connectionId)}" connectorType="${escapeAttribute(componentRefs.connectorType ?? "officialboomi-X3979C-rest-prod")}"/>`;
      break;

    case "connector":
      shapetype = "connectoraction";
      image = "connectoraction_icon";
      configXml = [
        `<connectoraction actionType="GET" allowDynamicCredentials="NONE" connectionId="${escapeAttribute(componentRefs.connectionId)}" connectorType="${escapeAttribute(componentRefs.connectorType ?? "officialboomi-X3979C-rest-prod")}" hideSettings="false" operationId="${escapeAttribute(componentRefs.operationId)}">`,
        "  <parameters/>",
        "  <dynamicProperties/>",
        "</connectoraction>",
      ].join("\n");
      break;

    case "map":
      shapetype = "map";
      image = "map_icon";
      configXml = `<map mapId="${escapeAttribute(componentRefs.mapId ?? "")}"/>`;
      break;

    case "setproperties":
      shapetype = "documentproperties";
      image = "documentproperties_icon";
      configXml = "<documentproperties/>";
      break;

    case "message":
      shapetype = "message";
      image = "message_icon";
      configXml = '<message combined="false"><msgTxt/><msgParameters/></message>';
      break;

    case "notify":
      shapetype = "notify";
      image = "notify_icon";
      configXml =
        '<notify disableEvent="true" enableUserLog="false" perExecution="false" title=""><notifyMessage/><notifyMessageLevel>INFO</notifyMessageLevel><notifyParameters/></notify>';
      break;

    case "dataprocess":
      shapetype = "dataprocess";
      image = "dataprocess_icon";
      configXml =
        '<dataprocess><step index="1" key="1" name="Custom Scripting" processtype="12"><dataprocessscript language="groovy2" useCache="true"><script><![CDATA[// Custom script\n]]></script></dataprocessscript></step></dataprocess>';
      break;

    case "branch":
      shapetype = "branch";
      image = "branch_icon";
      configXml = '<branch numBranches="2"/>';
      break;

    case "decision":
      shapetype = "decision";
      image = "decision_icon";
      configXml = '<decision comparison="equals" name="Decision"><decisionvalue valueType="track"><trackparameter defaultValue="" propertyId="dynamicdocument.DDP_DECISION"/></decisionvalue><decisionvalue valueType="static"><staticparameter staticproperty="true"/></decisionvalue></decision>';
      break;

    case "route":
      shapetype = "route";
      image = "route_icon";
      configXml = '<route><routeproperty valueType="track"><trackparameter defaultValue="" propertyId="dynamicdocument.DDP_ROUTE"/></routeproperty><routevalues><routevalue key="3" name="Match" qualifier="equals" value="true"/></routevalues></route>';
      break;

    case "trycatch":
      shapetype = "catcherrors";
      image = "catcherrors_icon";
      configXml = '<catcherrors catchAll="true" retryCount="2"/>';
      break;

    case "exception":
      shapetype = "exception";
      image = "exception_icon";
      configXml = '<exception stopProcessReturnSingleDoc="false" stopsingledoc="false" title="Error"><exMessage>Processing halted</exMessage><exParameters/></exception>';
      break;

    case "businessrules":
    case "findchanges":
    case "cleanse":
      // These shapes require complex configuration not yet modeled.
      shapetype = "notify";
      image = "notify_icon";
      configXml =
        '<notify disableEvent="true" enableUserLog="false" perExecution="false" title=""><notifyMessage>Placeholder for ' + escapeAttribute(node.type) + ' shape</notifyMessage><notifyMessageLevel>INFO</notifyMessageLevel><notifyParameters/></notify>';
      break;

    case "stop":
    case "end":
      shapetype = "stop";
      image = "stop_icon";
      configXml = '<stop continue="true"/>';
      break;

    case "return":
      shapetype = "returndocuments";
      image = "return_icon";
      configXml = "<returndocuments/>";
      break;

    case "addtocache":
      shapetype = "doccacheload";
      image = "doccacheload_icon";
      configXml = '<doccacheload docCache=""/>';
      break;

    case "retrievefromcache":
      shapetype = "doccacheretrieve";
      image = "doccacheretrieve_icon";
      configXml = '<doccacheretrieve docCache="" emptyCacheBehavior="stopprocess" loadAllDoc="true"><cacheKeyValues/></doccacheretrieve>';
      break;

    case "removefromcache":
      shapetype = "doccacheremove";
      image = "doccacheremove_icon";
      configXml = '<doccacheremove allIndices="false" docCache="" removeAllDocuments="true"><cacheKeyValues/></doccacheremove>';
      break;

    case "agent":
      shapetype = "aiagent";
      image = "agent_icon";
      configXml = "<aiagent/>";
      break;

    case "subprocess":
      shapetype = "processcall";
      image = "processcall_icon";
      configXml = '<processcall abort="true" wait="true"><parameters/><returnpaths><returnpaths childShapeName="shape1"/></returnpaths></processcall>';
      break;

    case "flowcontrol":
      shapetype = "flowcontrol";
      image = "flowcontrol_icon";
      configXml = "<flowcontrol/>";
      break;

    case "programcmd":
      shapetype = "programcmd";
      image = "programcmd_icon";
      configXml = "<programcmd/>";
      break;

    case "processroute":
      shapetype = "processroute";
      image = "processroute_icon";
      configXml = "<processroute/>";
      break;

    case "start-trading":
      shapetype = "start";
      image = "start";
      configXml = '<tradingpartneraction actionType="Listen"/>';
      break;

    default:
      shapetype = "message";
      image = "message_icon";
      configXml = '<message combined="false"><msgTxt/><msgParameters/></message>';
  }

  // Dragpoints
  if (!isTerminal && nextShapeName) {
    if (node.type === "branch") {
      dragpointsXml = [
        branchDragpointXml(index, nextShapeName, 1),
        branchDragpointXml(index, `shape${index + 1}b`, 2),
      ].join("\n");
    } else if (node.type === "decision") {
      dragpointsXml = [
        decisionDragpointXml(index, nextShapeName, "true", "True"),
        decisionDragpointXml(index, `shape${index + 1}b`, "false", "False"),
      ].join("\n");
    } else if (node.type === "route") {
      dragpointsXml = [
        routeDragpointXml(index, `shape${index + 1}b`, "default", "Default"),
        routeDragpointXml(index, nextShapeName, "3", "1 - Match"),
      ].join("\n");
    } else if (node.type === "trycatch") {
      dragpointsXml = [
        decisionDragpointXml(index, nextShapeName, "default", "Try"),
        decisionDragpointXml(index, `shape${index + 1}b`, "error", "Catch"),
      ].join("\n");
    } else {
      dragpointsXml = dragpointXml(index, nextShapeName);
    }
  } else {
    dragpointsXml = "";
  }

  return { shapetype, image, configXml, dragpointsXml };
}

export function generateProcessXml(
  flow: BuildProcessFlow,
  componentRefs: ProcessComponentRefs,
  folderId: string,
  componentId?: string,
): string {
  const sortedNodes = topologicalSort(flow);
  const shapeLayout = buildShapeLayout(flow, sortedNodes);

  const shapesXml: string[] = [];
  for (let i = 0; i < sortedNodes.length; i++) {
    const node = sortedNodes[i];
    const layout = shapeLayout.get(node.localNodeId);
    if (!layout) continue;

    const isTerminal = layout.isTerminal;
    const nextShapeName = layout.nextShapeName;

    const shapeDef = nodeToShape(node, layout.index, nextShapeName, isTerminal, componentRefs);
    const userLabel = node.label && node.label !== node.type ? ` userlabel="${escapeAttribute(node.label)}"` : "";

    shapesXml.push(
      `      <shape image="${shapeDef.image}" name="shape${layout.index}" shapetype="${shapeDef.shapetype}"${userLabel} x="${layout.position.x}" y="${layout.position.y}">`,
      "        <configuration>",
      `          ${shapeDef.configXml}`,
      "        </configuration>",
    );

    if (shapeDef.dragpointsXml) {
      shapesXml.push("        <dragpoints>");
      shapesXml.push(`          ${shapeDef.dragpointsXml}`);
      shapesXml.push("        </dragpoints>");
    } else {
      shapesXml.push("        <dragpoints/>");
    }

    shapesXml.push("      </shape>");
  }

  const innerXml = [
    '<process allowSimultaneous="false" enableUserLog="false" processLogOnErrorOnly="false" purgeDataImmediately="false" updateRunDates="false" workload="general">',
    "    <shapes>",
    shapesXml.join("\n"),
    "    </shapes>",
    "  </process>",
  ].join("\n");

  return componentXml(flow.name, "process", folderId, innerXml, componentId);
}

// ─── Process flow helpers ───────────────────────────────────────────────────

type ShapeLayoutInfo = {
  index: number;
  position: ShapePosition;
  isTerminal: boolean;
  nextShapeName: string | null;
  branch: number;
};

function topologicalSort(flow: BuildProcessFlow): BuildProcessFlowNode[] {
  const nodeMap = new Map<string, BuildProcessFlowNode>();
  for (const n of flow.nodes) nodeMap.set(n.localNodeId, n);

  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const n of flow.nodes) {
    inDegree.set(n.localNodeId, 0);
    outEdges.set(n.localNodeId, []);
  }

  for (const edge of flow.edges) {
    const outs = outEdges.get(edge.source) ?? [];
    outs.push(edge.target);
    outEdges.set(edge.source, outs);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Find start nodes
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: BuildProcessFlowNode[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodeMap.get(current);
    if (node) result.push(node);

    for (const target of outEdges.get(current) ?? []) {
      const newDeg = (inDegree.get(target) ?? 1) - 1;
      inDegree.set(target, newDeg);
      if (newDeg === 0) queue.push(target);
    }
  }

  // Include any nodes not reached
  for (const n of flow.nodes) {
    if (!result.includes(n)) result.push(n);
  }

  return result;
}

function buildShapeLayout(
  flow: BuildProcessFlow,
  sortedNodes: BuildProcessFlowNode[],
): Map<string, ShapeLayoutInfo> {
  const layout = new Map<string, ShapeLayoutInfo>();
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();

  for (const edge of flow.edges) {
    const outs = outEdges.get(edge.source) ?? [];
    outs.push(edge.target);
    outEdges.set(edge.source, outs);

    const ins = inEdges.get(edge.target) ?? [];
    ins.push(edge.source);
    inEdges.set(edge.target, ins);
  }

  let index = 1;
  for (const node of sortedNodes) {
    const outs = outEdges.get(node.localNodeId) ?? [];
    const isTerminal = outs.length === 0;
    const nextTarget = outs[0];
    let nextShapeName: string | null = null;

    if (nextTarget) {
      // Find the index of the target node (deferred)
      nextShapeName = `shape_${nextTarget}`;
    }

    layout.set(node.localNodeId, {
      index,
      position: shapePosition(index - 1),
      isTerminal,
      nextShapeName,
      branch: 0,
    });

    index += 1;
  }

  // Second pass: resolve shape names
  for (const [nodeId, info] of layout) {
    const outs = outEdges.get(nodeId) ?? [];
    if (outs.length > 0) {
      const targetLayout = layout.get(outs[0]);
      if (targetLayout) {
        info.nextShapeName = `shape${targetLayout.index}`;
      }
    }
  }

  return layout;
}
