export interface PasteMarker {
  id: number;
  start: number;
  end: number;
}

const MARKER = /\[paste #(\d+) (?:\+(\d+) lines|(\d+) chars)\]/g;

/** Find the paste marker whose characters include `offset` (the cursor block covers one of them). */
export function markerAt(text: string, offset: number): PasteMarker | undefined {
  MARKER.lastIndex = 0;
  for (let match = MARKER.exec(text); match; match = MARKER.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset < end) {
      return { id: Number(match[1]), start, end };
    }
    if (start > offset) break;
  }
  return undefined;
}

export function replaceMarker(text: string, id: number, content: string): string {
  const marker = new RegExp(`\\[paste #${id} (?:\\+\\d+ lines|\\d+ chars)\\]`, "g");
  return text.replace(marker, () => content);
}

export function removeMarker(text: string, id: number): string {
  const marker = new RegExp(`\\[paste #${id} (?:\\+\\d+ lines|\\d+ chars)\\]`, "g");
  return text.replace(marker, "");
}

export function isLargePaste(text: string): boolean {
  return text.split("\n").length > 10 || text.length > 1000;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
