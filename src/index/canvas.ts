import { chunkMarkdown, CHUNKING_VERSION } from "./chunker";
import type { Chunk } from "./chunker";

/**
 * Parse a .canvas JSON file and extract text-type nodes as chunks.
 * Each text card becomes one or more chunks.
 */

interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  text?: string;
  label?: string;
  file?: string;
  url?: string;
}

interface CanvasData {
  nodes?: CanvasNode[];
}

export function chunkCanvas(
  raw: string,
  canvasPath: string,
  opts: { maxSize: number; overlap: number }
): Chunk[] {
  let data: CanvasData;
  try {
    data = JSON.parse(raw) as CanvasData;
  } catch {
    return []; // invalid JSON, skip silently
  }

  const nodes = data.nodes ?? [];
  const chunks: Chunk[] = [];
  const canvasTitle = canvasPath.split("/").pop()?.replace(/\.canvas$/, "") ?? canvasPath;
  let globalOrdinal = 0;

  for (const node of nodes) {
    if (node.type !== "text" || !node.text?.trim()) continue;

    const nodeChunks = chunkMarkdown(node.text.trim(), canvasTitle, {
      source: canvasPath,
      sourceType: "canvas",
      maxSize: opts.maxSize,
      overlap: opts.overlap,
    });

    // Rewrite IDs to include nodeId for provenance
    for (const chunk of nodeChunks) {
      chunks.push({
        ...chunk,
        id: `${canvasPath}::node-${node.id}::${globalOrdinal}`,
        heading: `card ${node.id}`,
        ordinal: globalOrdinal,
      });
      globalOrdinal++;
    }
  }

  return chunks;
}
