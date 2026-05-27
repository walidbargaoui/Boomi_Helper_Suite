/**
 * XML utilities shared across the Boomi XML generators, exporters, and formatters.
 *
 * Centralizing here avoids drift between the multiple `escapeXml` copies that
 * previously existed in `boomi.ts`, `boomi-sandbox.ts`, and `boomi-xml.ts`.
 */

export function escapeXml(value: string | undefined | null): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Pretty-print raw XML into indented lines for display / diff purposes.
 * Lightweight formatter that preserves CDATA, comments, and processing instructions.
 */
export function formatXmlForDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes("<")) return value;

  const xmlTokenPattern = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[^>]+>|[^<]+/g;

  function getTagName(token: string) {
    const match = token.match(/^<\/?\s*([^\s>/]+)/);
    return match?.[1];
  }

  function isOpeningTag(token: string) {
    return (
      token.startsWith("<") &&
      !token.startsWith("</") &&
      !token.startsWith("<?") &&
      !token.startsWith("<!--") &&
      !token.startsWith("<![CDATA[") &&
      !token.endsWith("/>")
    );
  }

  function isClosingTagFor(token: string, tagName: string | undefined) {
    return Boolean(tagName && token.startsWith(`</${tagName}`));
  }

  const tokens = trimmed.replace(/>\s+</g, "><").match(xmlTokenPattern);
  if (!tokens) return value;

  const lines: string[] = [];
  let depth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const nextToken = tokens[index + 1];
    const closingToken = tokens[index + 2];

    if (!token.startsWith("<")) {
      const text = token.trim();
      if (text) lines.push(`${"  ".repeat(depth)}${text}`);
      continue;
    }

    if (token.startsWith("</")) {
      depth = Math.max(depth - 1, 0);
      lines.push(`${"  ".repeat(depth)}${token}`);
      continue;
    }

    const tagName = getTagName(token);
    const hasInlineText =
      isOpeningTag(token) &&
      nextToken &&
      !nextToken.startsWith("<") &&
      closingToken &&
      isClosingTagFor(closingToken, tagName);

    if (hasInlineText) {
      lines.push(`${"  ".repeat(depth)}${token}${nextToken.trim()}${closingToken}`);
      index += 2;
      continue;
    }

    lines.push(`${"  ".repeat(depth)}${token}`);

    if (isOpeningTag(token)) {
      depth += 1;
    }
  }

  return lines.join("\n");
}
