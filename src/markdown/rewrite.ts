import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Token, type Tokens, visibleWidth } from "@earendil-works/pi-tui";
import { applyEdits, type Edit, lex, walk } from "./tokens.ts";

function plainText(tokens: readonly Token[]): string {
  let out = "";
  for (const token of tokens) {
    if (token.type === "br") {
      out += " ";
      continue;
    }
    const nested = (token as { tokens?: Token[] }).tokens;
    if (nested) out += plainText(nested);
    else out += (token as { text?: string }).text ?? "";
  }
  return out;
}

function cellText(cell: Tokens.TableCell | undefined): string {
  return cell ? plainText(cell.tokens).trim() : "";
}

function tableWidth(table: Tokens.Table): number {
  const columns = table.header.length;
  let width = 3 * columns + 1;
  for (let index = 0; index < columns; index++) {
    let widest = visibleWidth(cellText(table.header[index]));
    for (const row of table.rows) {
      widest = Math.max(widest, visibleWidth(cellText(row[index])));
    }
    width += widest;
  }
  return width;
}

function rowToList(row: readonly Tokens.TableCell[], header: readonly Tokens.TableCell[]): string {
  const cells = row.map(cellText);
  const [first = "", ...rest] = cells;
  const parts = rest.flatMap((text, index) => (text ? [`${cellText(header[index + 1])}: ${text}`] : []));
  const head = first ? `**${first}**` : "";
  if (parts.length === 0) return `- ${head}`;
  const body = parts.join(" · ");
  return head ? `- ${head} — ${body}` : `- ${body}`;
}

function linkDomain(link: Tokens.Link): string | undefined {
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const host = url.hostname.replace(/^www\./, "");
  const text = link.text.trim();
  if (text === link.href || text === url.hostname || text === host) return undefined;
  return host;
}

export function rewriteHeadings(markdown: string): string {
  const edits: Edit[] = [];
  walk(lex(markdown), markdown, 0, (token, start, end) => {
    if (token.type !== "heading") return;
    const heading = token as Tokens.Heading;
    if (heading.depth < 3) return;
    const inner = heading.raw
      .replace(/^#{1,6}[ \t]*/, "")
      .replace(/[ \t]+#+[ \t]*\n*$/, "")
      .replace(/\n+$/, "")
      .trimEnd();
    edits.push({ start, end, text: `**${inner}**\n\n` });
    return true;
  });
  return applyEdits(markdown, edits);
}

export function appendLinkDomains(markdown: string, theme: Theme): string {
  const edits: Edit[] = [];
  walk(lex(markdown), markdown, 0, (token, _start, end) => {
    if (token.type !== "link") return;
    const host = linkDomain(token as Tokens.Link);
    if (!host) return;
    edits.push({ start: end, end, text: ` ${theme.fg("dim", `↗ ${host}`)}` });
    return true;
  });
  return applyEdits(markdown, edits);
}

export function tablesToLists(markdown: string, availableWidth: number): string {
  const edits: Edit[] = [];
  walk(lex(markdown), markdown, 0, (token, start, end) => {
    if (token.type !== "table") return;
    const table = token as Tokens.Table;
    if (tableWidth(table) <= availableWidth) return true;
    const lines = table.rows.map((row) => rowToList(row, table.header));
    const trailing = table.raw.endsWith("\n") ? "\n" : "";
    edits.push({ start, end, text: lines.join("\n") + trailing });
    return true;
  });
  return applyEdits(markdown, edits);
}
