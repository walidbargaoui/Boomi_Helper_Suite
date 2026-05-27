import { XMLParser } from "fast-xml-parser";
import type { ProfileFieldCreateInput } from "@/lib/project-mutations";

export type ParsedField = ProfileFieldCreateInput;

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const semiCount = (firstLine.match(/;/g) ?? []).length;
  if (tabCount >= commaCount && tabCount >= semiCount && tabCount > 0) return "\t";
  if (semiCount > commaCount) return ";";
  return ",";
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((cell) => cell.trim());
}

export function parseDelimitedFields(
  text: string,
  options: { delimiter?: string; hasHeader?: boolean } = {},
): ParsedField[] {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^﻿/, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const headerRow = splitCsvLine(lines[0], delimiter);
  const looksLikeHeader =
    options.hasHeader ?? headerRow.some((cell) => /name|field|column|label|type|required/i.test(cell));

  const headers = looksLikeHeader
    ? headerRow.map((cell) => cell.toLowerCase())
    : headerRow.map((_, index) => `col${index + 1}`);
  const bodyStart = looksLikeHeader ? 1 : 0;
  const fields: ParsedField[] = [];

  for (let i = bodyStart; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i], delimiter);
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      record[headers[c]] = (cells[c] ?? "").trim();
    }
    const name = record["name"] || record["field"] || record["column"] || cells[0] || `field_${i + 1}`;
    if (!name) continue;
    const rawType = record["type"] || record["datatype"] || record["data type"];
    const sampleValue = record["sample"] || record["example"] || "";
    const dataType = rawType || (sampleValue ? inferTypeFromValue(sampleValue) : "String");
    fields.push({
      name,
      label: record["label"] || undefined,
      description: record["description"] || undefined,
      dataType,
      length: record["length"] || undefined,
      required: /^(true|yes|y|1|required|mandatory)$/i.test(record["required"] ?? record["mandatory"] ?? ""),
      keyField: /^(true|yes|y|1|key)$/i.test(record["key"] ?? record["keyfield"] ?? record["key field"] ?? ""),
      format: record["format"] || undefined,
      sample: sampleValue || undefined,
      ordinal: i + 1,
    });
  }
  return fields;
}

function inferTypeFromValue(value: string): string {
  if (/^(true|false|yes|no|y|n|1|0)$/i.test(value)) return "Boolean";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "Date";
  if (/^-?\d*\.\d+$/.test(value)) return "Decimal";
  if (/^-?\d+$/.test(value)) return "Integer";
  return "String";
}

function inferType(value: unknown): string {
  if (value === null || value === undefined) return "String";
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "Integer" : "Decimal";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "Date";
    return "String";
  }
  if (Array.isArray(value)) return "Array";
  return "Object";
}

export function flattenJsonSample(value: unknown, prefix = ""): ParsedField[] {
  const fields: ParsedField[] = [];
  let counter = 0;
  function visit(node: unknown, path: string, parent: string) {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, path, parent);
      }
      return;
    }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        const isLeaf =
          child === null || typeof child !== "object" || (Array.isArray(child) && (child.length === 0 || typeof child[0] !== "object"));
        if (isLeaf) {
          counter += 1;
          const leafValue = Array.isArray(child) ? child[0] : child;
          fields.push({
            parentPath: path || undefined,
            name: key,
            dataType: inferType(leafValue),
            sample: leafValue === undefined || leafValue === null ? undefined : String(leafValue).slice(0, 200),
            required: false,
            keyField: false,
            ordinal: counter,
          });
        } else {
          visit(child, childPath, key);
        }
      }
    }
  }
  visit(value, prefix, "");

  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.parentPath ?? ""}.${field.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  preserveOrder: false,
});

export function parseXmlSample(xml: string): ParsedField[] {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const roots = Object.keys(parsed);
  if (roots.length === 0) return [];
  const root = parsed[roots[0]];
  return flattenJsonSample(root);
}

export function importFields(input:
  | { kind: "csv"; payload: string; delimiter?: string; hasHeader?: boolean }
  | { kind: "json"; payload: string }
  | { kind: "xml"; payload: string }): ParsedField[] {
  if (input.kind === "csv") {
    return parseDelimitedFields(input.payload, { delimiter: input.delimiter, hasHeader: input.hasHeader });
  }
  if (input.kind === "json") {
    const data = JSON.parse(input.payload);
    return flattenJsonSample(data);
  }
  return parseXmlSample(input.payload);
}
