import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { previewHtml } from "./render.ts";

export function previewFile(source: string): string {
  const dir = join(tmpdir(), "pi-tune-mermaid");
  const path = join(dir, `${createHash("sha1").update(source).digest("hex")}.html`);
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, previewHtml(source));
  }
  return pathToFileURL(path).href;
}
