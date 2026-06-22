import { hashStr } from "../util/hash";

export const CHUNKING_VERSION = 1;

/** Max file content size to index (larger files get truncated) */
const MAX_CONTENT_CHARS = 80_000;

export interface Chunk {
  id: string;
  source: string;
  sourceType: "note" | "canvas";
  title: string;
  heading: string;
  snippet: string;
  embedText: string;
  contentHash: string;
  ordinal: number;
}

// ── Protected ranges (O(n) line scanner — NO REGEX BACKTRACKING) ─────────────
// The regex /[\s\S]*?\n\1/ can catastrophically backtrack on unclosed fences.
// Replace with a simple state machine.

interface ProtectedRange { start: number; end: number; }

function findProtectedRanges(body: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const lines = body.split("\n");
  let pos = 0;
  let inFence = false;
  let fencePrefix = "";
  let rangeStart = 0;

  for (const line of lines) {
    const lineEnd = pos + line.length;

    if (!inFence) {
      // Detect opening fence: ``` or ~~~  (3+ chars)
      const fenceMatch = /^(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        inFence = true;
        fencePrefix = fenceMatch[1];
        rangeStart = pos;
      } else {
        // Table row: line starting with |
        if (line.startsWith("|")) {
          ranges.push({ start: pos, end: lineEnd });
        }
      }
    } else {
      // Inside fence — look for matching close (same or more fence chars)
      if (line.startsWith(fencePrefix[0].repeat(3)) && !line.slice(3).includes(fencePrefix[0])) {
        inFence = false;
        ranges.push({ start: rangeStart, end: lineEnd });
      }
    }

    pos = lineEnd + 1; // +1 for \n
  }

  // Unclosed fence: protect to end of file (common in notes-in-progress)
  if (inFence) {
    ranges.push({ start: rangeStart, end: body.length });
  }

  // Merge adjacent table rows into single ranges
  return mergeAdjacentRanges(ranges);
}

function mergeAdjacentRanges(ranges: ProtectedRange[]): ProtectedRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: ProtectedRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end + 1) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

function isProtected(pos: number, ranges: ProtectedRange[]): boolean {
  for (const r of ranges) {
    if (pos >= r.start && pos < r.end) return true;
    if (r.start > pos) break; // sorted, no need to check further
  }
  return false;
}

// ── Text cleanup for embedding (no display-altering side effects) ─────────────
function cleanForEmbed(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")                          // strip HTML tags (e.g. <span style="...">)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")    // [[link|alias]] → alias
    .replace(/\[\[([^\]]+)\]\]/g, "$1")                // [[link]] → link text
    .replace(/!\[\[([^\]]+)\]\]/g, "$1")               // ![[embed]] → filename
    .replace(/^#{1,6}\s+/gm, "")                       // headings
    .replace(/[*_~`>]/g, "")                            // markdown symbols
    .replace(/&[a-z]+;/gi, " ")                        // HTML entities (&nbsp; &amp; etc.)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")                        // collapse extra spaces from stripped tags
    .trim();
}

// ── Strip YAML frontmatter ────────────────────────────────────────────────────
function stripFrontmatter(content: string): { title: string | null; body: string } {
  if (!content.startsWith("---")) return { title: null, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { title: null, body: content };
  const fm = content.slice(3, end);
  const titleMatch = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm);
  return { title: titleMatch?.[1]?.trim() ?? null, body: content.slice(end + 4) };
}

// ── O(n) heading split ────────────────────────────────────────────────────────
interface Section { heading: string; content: string; offset: number; }

function splitByHeadings(body: string): Section[] {
  const lines = body.split("\n");
  const sections: Section[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];
  let sectionStartOffset = 0;
  let currentOffset = 0;
  const stack: string[] = [];

  const flush = () => {
    const content = currentLines.join("\n").trim();
    if (content) {
      // Find the actual offset of trimmed content within the section
      const rawContent = currentLines.join("\n");
      const leadingWhitespace = rawContent.length - rawContent.trimStart().length;
      sections.push({
        heading: currentHeading,
        content,
        offset: sectionStartOffset + leadingWhitespace,
      });
    }
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hMatch = /^(#{1,6})\s+(.+)/.exec(line);
    if (hMatch) {
      flush();
      const level = hMatch[1].length;
      stack.splice(level - 1);
      stack[level - 1] = hMatch[2].trim();
      currentHeading = stack.filter(Boolean).join(" > ");
      // Next section starts after this heading line
      sectionStartOffset = currentOffset + line.length + 1; // +1 for \n
    } else {
      if (currentLines.length === 0) {
        sectionStartOffset = currentOffset;
      }
      currentLines.push(line);
    }
    currentOffset += line.length + 1; // +1 for \n
  }
  flush();
  return sections;
}

// ── Window-split a section ────────────────────────────────────────────────────
function windowSplit(
  text: string,
  maxSize: number,
  overlap: number,
  protectedRanges: ProtectedRange[],
  bodyOffset: number,
): string[] {
  if (text.length <= maxSize) return [text];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + maxSize, text.length);

    // Extend to cover any protected range that straddles the boundary
    for (const r of protectedRanges) {
      const rs = r.start - bodyOffset;
      const re = r.end - bodyOffset;
      if (rs < end && re > end) { end = Math.min(re, text.length); }
    }

    // Try to break at a paragraph boundary
    const ideal = pos + maxSize - overlap;
    const para = text.lastIndexOf("\n\n", end);
    if (para > ideal && !isProtected(para + bodyOffset, protectedRanges)) {
      end = para + 2;
    }

    const chunk = text.slice(pos, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break; // reached end — must exit or loop forever
    pos = end - overlap;
    if (pos <= 0 || pos >= text.length) break;
  }
  return chunks;
}

// ── Main export ───────────────────────────────────────────────────────────────
export function chunkMarkdown(
  rawContent: string,
  filename: string,
  opts: { source: string; sourceType: "note" | "canvas"; maxSize: number; overlap: number }
): Chunk[] {
  const { source, sourceType, maxSize, overlap } = opts;

  // Cap content size to prevent runaway processing on huge files
  const content = rawContent.length > MAX_CONTENT_CHARS
    ? rawContent.slice(0, MAX_CONTENT_CHARS)
    : rawContent;

  const { title: fmTitle, body } = stripFrontmatter(content);
  const title = fmTitle ?? filename.replace(/\.(md|canvas)$/, "");

  // O(n) protected range detection
  const protectedRanges = findProtectedRanges(body);
  const sections = splitByHeadings(body);
  const chunks: Chunk[] = [];
  let ordinal = 0;

  for (const section of sections) {
    const trimmed = section.content.trim();
    if (!trimmed) continue;

    // Use pre-computed offset instead of O(n) body.indexOf
    const bodyOffset = section.offset;
    const windows = windowSplit(trimmed, maxSize, overlap, protectedRanges, Math.max(0, bodyOffset));

    for (const win of windows) {
      if (!win.trim()) continue;
      const cleaned = cleanForEmbed(win);
      const embedText = `"${title}" > ${section.heading || title}\n${cleaned}`;
      const id = `${source}::${ordinal}`;
      chunks.push({
        id, source, sourceType, title,
        heading: section.heading,
        snippet: win,
        embedText,
        contentHash: hashStr(cleaned),
        ordinal,
      });
      ordinal++;
    }
  }

  // Fallback: whole note as one chunk
  if (chunks.length === 0 && body.trim()) {
    const cleaned = cleanForEmbed(body.trim());
    chunks.push({
      id: `${source}::0`,
      source, sourceType, title,
      heading: "",
      snippet: body.slice(0, 500),
      embedText: `"${title}"\n${cleaned}`,
      contentHash: hashStr(cleaned),
      ordinal: 0,
    });
  }

  return chunks;
}
