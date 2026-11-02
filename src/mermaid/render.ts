import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Cls, diagramKind, render, type Span } from "grok-mermaid";

const COLOR: Record<Exclude<Cls, "none" | "title">, "borderMuted" | "text" | "accent" | "muted"> = {
  border: "borderMuted",
  text: "text",
  edge: "accent",
  edgeLabel: "muted",
};

function styledRow(spans: readonly Span[], theme: Theme): string {
  return spans
    .map((span) => {
      if (span.cls === "none") return span.text;
      if (span.cls === "title") return theme.bold(theme.fg("accent", span.text));
      return theme.fg(COLOR[span.cls], span.text);
    })
    .join("");
}

export function mermaidMarkdown(
  source: string,
  availableWidth: number,
  theme: Theme,
  previewUrl: string,
): string | undefined {
  const kind = diagramKind(source);
  if (!kind) return undefined;
  const art = render(source);
  if (!art) return undefined;
  const action = `${theme.fg("dim", `◇ mermaid · ${kind}`)} [open preview](${previewUrl}) ${theme.fg("dim", "· alt+o source")}`;
  if (art.width > availableWidth) {
    return `${theme.fg("dim", `◇ mermaid · ${kind} · needs ${art.width} columns, have ${availableWidth}`)}\n\n${action}`;
  }
  const rows = art.styled.map((row) => `\`${styledRow(row, theme)}\``);
  return `${rows.join("  \n")}\n\n${action}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function previewHtml(source: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pi-tune mermaid</title>
<style>
body { margin: 0; padding: 16px; background: #1e1e1e; }
pre.mermaid { margin: 0; background: #1e1e1e; color: #d4d4d4; }
</style>
</head>
<body>
<pre class="mermaid">${escapeHtml(source)}</pre>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true, theme: "dark" });</script>
</body>
</html>
`;
}
