import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IBufferCell, Terminal } from "@xterm/headless";

export type Appearance = "dark" | "light";
// Default terminal colors, matched to the Pi theme in use so untinted text stays readable.
const DEFAULTS: Record<Appearance, { bg: string; fg: string }> = {
  dark: { bg: "#1e1f29", fg: "#d6d8e0" },
  light: { bg: "#fbfbf8", fg: "#24262e" },
};
const CELL_WIDTH = 8.4;
const CELL_HEIGHT = 19;
const PADDING = 8;

const ANSI = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function palette(index: number): string {
  if (index < 16) return ANSI[index];
  if (index < 232) {
    const steps = [0, 95, 135, 175, 215, 255];
    const i = index - 16;
    return hex((steps[Math.floor(i / 36)] << 16) | (steps[Math.floor(i / 6) % 6] << 8) | steps[i % 6]);
  }
  const level = 8 + (index - 232) * 10;
  return hex((level << 16) | (level << 8) | level);
}

function foreground(cell: IBufferCell | undefined, appearance: Appearance): string {
  if (!cell || cell.isFgDefault()) return DEFAULTS[appearance].fg;
  return cell.isFgRGB() ? hex(cell.getFgColor()) : palette(cell.getFgColor());
}

function background(cell: IBufferCell | undefined, appearance: Appearance): string {
  if (!cell || cell.isBgDefault()) return DEFAULTS[appearance].bg;
  return cell.isBgRGB() ? hex(cell.getBgColor()) : palette(cell.getBgColor());
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml(term: Terminal, appearance: Appearance): string {
  const buffer = term.buffer.active;
  const rows: string[] = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y);
    if (!line) continue;
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x);
      if (!cell) break;
      const width = cell.getWidth();
      if (width === 0) continue;
      let fg = foreground(cell, appearance);
      let bg = background(cell, appearance);
      if (cell.isInverse()) [fg, bg] = [bg, fg];
      const style = [
        `left:${(x * CELL_WIDTH).toFixed(2)}px`,
        `top:${(y * CELL_HEIGHT).toFixed(2)}px`,
        `width:${(width * CELL_WIDTH).toFixed(2)}px`,
        `height:${CELL_HEIGHT}px`,
        `color:${fg}`,
        `background:${bg}`,
        cell.isBold() ? "font-weight:700" : "",
        cell.isDim() ? "opacity:0.6" : "",
        cell.isItalic() ? "font-style:italic" : "",
        cell.isUnderline() ? "text-decoration:underline" : "",
      ].filter(Boolean);
      rows.push(`<span class="cell" style="${style.join(";")}">${escapeHtml(cell.getChars() || " ")}</span>`);
    }
  }
  const width = Math.ceil(term.cols * CELL_WIDTH + PADDING * 2);
  const height = Math.ceil(term.rows * CELL_HEIGHT + PADDING * 2);
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: ${DEFAULTS[appearance].bg}; overflow: hidden; }
body { padding: ${PADDING}px; }
#grid { position: relative; width: ${width - PADDING * 2}px; height: ${height - PADDING * 2}px; }
.cell {
  position: absolute; font-family: "SF Mono", Menlo, "PingFang SC", monospace; font-size: 14px;
  line-height: ${CELL_HEIGHT}px; white-space: pre; overflow: hidden; font-variant-ligatures: none;
}
</style></head><body><div id="grid">${rows.join("")}</div></body></html>`;
}

export function renderPng(term: Terminal, file: string, appearance: Appearance = "dark"): void {
  const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const width = Math.ceil(term.cols * CELL_WIDTH + PADDING * 2);
  const height = Math.ceil(term.rows * CELL_HEIGHT + PADDING * 2);
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true });
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-shot-"));
  try {
    const htmlPath = join(dir, "screen.html");
    writeFileSync(htmlPath, buildHtml(term, appearance));
    const result = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=2",
        `--window-size=${width},${height}`,
        `--screenshot=${target}`,
        pathToFileURL(htmlPath).href,
      ],
      { encoding: "utf8", timeout: 45_000 },
    );
    if (result.error) throw new Error(`Chrome failed: ${result.error.message}`);
    if (result.status !== 0 || !existsSync(target)) {
      throw new Error(`Chrome exited with ${result.status}: ${result.stderr || result.stdout}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
