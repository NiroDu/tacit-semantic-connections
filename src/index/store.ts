import { normalize, dot, topK, mmr } from "../util/vec";

// ── VecRecord ────────────────────────────────────────────
export interface VecRecord {
  id: string;
  fingerprint: string;
  source: string;
  sourceType: "note" | "canvas";
  title: string;
  heading: string;
  snippet: string;
  mtime: number;
  contentHash: string;
}

// ── SearchResult ─────────────────────────────────────────
export interface SearchResult {
  record: VecRecord;
  score: number;
  isLongLost?: boolean; // serendipity flag for old notes
}

// ── VectorStore interface ─────────────────────────────────
export interface VectorStore {
  upsert(records: VecRecord[], vectors: Float32Array[]): void;
  removeBySource(source: string): void;
  search(query: Float32Array, k: number, opts?: {
    fingerprint: string;
    excludeSource?: string;
    diversity?: number;   // MMR lambda (0..1); lower = more diverse
    serendipity?: boolean;
  }): SearchResult[];
  /** Return the mean vector of all chunks for a given source (for Related Notes query) */
  meanVector(source: string, fingerprint: string): Float32Array | null;
  size(): number;
  persist(path: string): Promise<void>;
  load(path: string): Promise<void>;
}

// ── Build state (persisted alongside index) ──────────────
export type ChunkState = "pending" | "inflight" | "done" | "error";

export interface ChunkBuildEntry {
  id: string;
  hash: string;
  state: ChunkState;
  retries: number;
}

export interface FileBuildEntry {
  mtime: number;
  fileHash: string;
  chunks: ChunkBuildEntry[];
}

export interface BuildState {
  fingerprint: string;
  files: Record<string, FileBuildEntry>;
}

// ── In-memory implementation ─────────────────────────────
export class InMemoryVectorStore implements VectorStore {
  private meta: VecRecord[] = [];
  private vectors: Float32Array[] = []; // parallel to meta
  /** O(1) id→index lookup — kept in sync with meta[] */
  private idIndex: Map<string, number> = new Map();

  upsert(records: VecRecord[], vectors: Float32Array[]): void {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const vec = normalize(new Float32Array(vectors[i])); // normalize on insert

      const existing = this.idIndex.get(rec.id);
      if (existing !== undefined) {
        this.meta[existing] = rec;
        this.vectors[existing] = vec;
      } else {
        const idx = this.meta.length;
        this.meta.push(rec);
        this.vectors.push(vec);
        this.idIndex.set(rec.id, idx);
      }
    }
  }

  removeBySource(source: string): void {
    const keep = this.meta.map((m, i) => m.source !== source ? i : -1).filter(i => i >= 0);
    this.meta = keep.map(i => this.meta[i]);
    this.vectors = keep.map(i => this.vectors[i]);
    this.rebuildIdIndex();
  }

  /** Rename all records matching oldSource to newSource (avoids re-embedding on file rename) */
  renameSource(oldSource: string, newSource: string): void {
    for (let i = 0; i < this.meta.length; i++) {
      if (this.meta[i].source === oldSource) {
        this.meta[i] = { ...this.meta[i], source: newSource };
      }
    }
    // idIndex doesn't depend on source, no rebuild needed
  }

  private rebuildIdIndex(): void {
    this.idIndex.clear();
    for (let i = 0; i < this.meta.length; i++) {
      this.idIndex.set(this.meta[i].id, i);
    }
  }

  search(
    query: Float32Array,
    k: number,
    opts?: {
      fingerprint: string;
      excludeSource?: string;
      diversity?: number;
      serendipity?: boolean;
    }
  ): SearchResult[] {
    const fp = opts?.fingerprint;
    const exclude = opts?.excludeSource;
    const lambda = opts?.diversity ?? (opts?.serendipity ? 0.5 : 0.7);
    const ageBias = opts?.serendipity ? 0.05 : 0;

    // Assume query is already normalized by the caller (indexer.ts / find-modal.ts)
    const qNorm = query;

    // Chunk-level top-(k * 4), filtered by fingerprint
    interface Candidate {
      item: VecRecord & { mtime: number };
      score: number;
      vector: Float32Array;
    }

    const expansion = k * 4;
    const candidates: Candidate[] = [];

    for (let i = 0; i < this.meta.length; i++) {
      const rec = this.meta[i];
      if (fp && rec.fingerprint !== fp) continue;
      if (exclude && rec.source === exclude) continue;

      const score = dot(qNorm, this.vectors[i]);
      candidates.push({ item: rec, score, vector: this.vectors[i] });
    }

    // Sort and take expansion set
    candidates.sort((a, b) => b.score - a.score);
    const expanded = candidates.slice(0, expansion);

    // Aggregate by source: take each source's best score chunk
    const bySource = new Map<string, Candidate>();
    for (const c of expanded) {
      const existing = bySource.get(c.item.source);
      if (!existing || c.score > existing.score) {
        bySource.set(c.item.source, c);
      }
    }

    const noteLevel = [...bySource.values()];

    // Determine "long lost" threshold (top 25% age = oldest quartile)
    const sortedByMtime = [...noteLevel].sort((a, b) => a.item.mtime - b.item.mtime);
    const oldThreshold = sortedByMtime[Math.floor(sortedByMtime.length * 0.25)]?.item.mtime;

    // Apply MMR at note level
    const selected = mmr(noteLevel, k, lambda, ageBias);

    return selected.map(s => {
      // Always display from the start of the note (chunk ::0), regardless of
      // which chunk scored highest. The ranking stays chunk-level accurate.
      const chunk0Idx = this.idIndex.get(`${s.item.source}::0`);
      const snippet = chunk0Idx !== undefined ? this.meta[chunk0Idx].snippet : s.item.snippet;
      return {
        record: { ...s.item, snippet },
        score: s.score,
        isLongLost: opts?.serendipity && s.item.mtime <= (oldThreshold ?? 0),
      };
    });
  }

  meanVector(source: string, fingerprint: string): Float32Array | null {
    const vecs = this.vectors.filter((_, i) =>
      this.meta[i].source === source && this.meta[i].fingerprint === fingerprint
    );
    if (vecs.length === 0) return null;

    const dim = vecs[0].length;
    const mean = new Float32Array(dim);
    for (const v of vecs) {
      for (let i = 0; i < dim; i++) mean[i] += v[i];
    }
    for (let i = 0; i < dim; i++) mean[i] /= vecs.length;
    return normalize(mean);
  }

  size(): number { return this.meta.length; }

  // ── Persistence ──────────────────────────────────────────
  // Format: index.bin (header + raw float32 data) + index.meta.json

  async persist(basePath: string): Promise<void> {
    // Write meta JSON
    const metaJson = JSON.stringify({ records: this.meta });
    // Write binary: magic(4) + version(u16) + dim(u16) + count(u32) + vectors
    const dim = this.vectors[0]?.length ?? 0;
    const count = this.vectors.length;
    const headerSize = 4 + 2 + 2 + 4; // magic + version + dim + count
    const bufSize = headerSize + count * dim * 4;
    const buf = new ArrayBuffer(bufSize);
    const view = new DataView(buf);

    // magic: "TACT"
    view.setUint8(0, 0x54); view.setUint8(1, 0x41); view.setUint8(2, 0x43); view.setUint8(3, 0x54);
    view.setUint16(4, 1, true);   // version
    view.setUint16(6, dim, true); // dim
    view.setUint32(8, count, true); // count

    let offset = headerSize;
    for (const vec of this.vectors) {
      for (let i = 0; i < dim; i++) {
        view.setFloat32(offset, vec[i], true);
        offset += 4;
      }
    }

    // File writing is handled by Indexer via app.vault.adapter.
    // Store serialised data here for Indexer to pick up and write.
    (this as any)._pendingBinData = buf;
    (this as any)._pendingMetaData = metaJson;
  }

  async load(basePath: string): Promise<void> {
    // Handled by Indexer which reads files and calls loadFromBuffers
  }

  loadFromBuffers(binBuf: ArrayBuffer, metaJson: string): void {
    const view = new DataView(binBuf);
    const magic = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
    );
    if (magic !== "TACT") return; // invalid

    const dim = view.getUint16(6, true);
    const count = view.getUint32(8, true);
    const headerSize = 12;

    this.vectors = [];
    let offset = headerSize;
    for (let i = 0; i < count; i++) {
      const vec = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        vec[j] = view.getFloat32(offset, true);
        offset += 4;
      }
      this.vectors.push(vec);
    }

    const parsed = JSON.parse(metaJson);
    this.meta = parsed.records ?? [];
    this.rebuildIdIndex();
  }
}
