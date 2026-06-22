// ── L2 normalize in-place ────────────────────────────────
export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const inv = sum > 0 ? 1.0 / Math.sqrt(sum) : 0;
  for (let i = 0; i < v.length; i++) v[i] *= inv;
  return v;
}

// ── Dot product (fast loop) ──────────────────────────────
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ── Min-heap top-K ───────────────────────────────────────
export interface Scored<T> {
  item: T;
  score: number;
}

export function topK<T>(items: Iterable<Scored<T>>, k: number): Scored<T>[] {
  const heap: Scored<T>[] = [];

  function heapify(i: number) {
    const left = 2 * i + 1, right = 2 * i + 2;
    let smallest = i;
    if (left < heap.length && heap[left].score < heap[smallest].score) smallest = left;
    if (right < heap.length && heap[right].score < heap[smallest].score) smallest = right;
    if (smallest !== i) { [heap[i], heap[smallest]] = [heap[smallest], heap[i]]; heapify(smallest); }
  }

  for (const entry of items) {
    if (heap.length < k) {
      heap.push(entry);
      // build heap
      for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) heapify(i);
    } else if (entry.score > heap[0].score) {
      heap[0] = entry;
      heapify(0);
    }
  }

  return heap.sort((a, b) => b.score - a.score);
}

// ── MMR — Maximal Marginal Relevance ─────────────────────
/**
 * @param query      - The query vector
 * @param candidates - Pre-scored candidates (items + their sim-to-query)
 * @param k          - How many to select
 * @param lambda     - 0=max diversity, 1=max relevance. Default 0.7
 * @param ageBias    - Multiplier added to older items' MMR score (serendipity)
 */
export function mmr<T extends { mtime: number }>(
  candidates: Array<{ item: T; score: number; vector: Float32Array }>,
  k: number,
  lambda = 0.7,
  ageBias = 0,
): Array<{ item: T; score: number }> {
  if (candidates.length === 0) return [];
  const selected: typeof candidates = [];
  const remaining = [...candidates];

  const oldestMtime = Math.min(...candidates.map(c => c.item.mtime));
  const newestMtime = Math.max(...candidates.map(c => c.item.mtime));
  const mtimeRange = newestMtime - oldestMtime || 1;

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const relevance = c.score;

      // Max similarity to already-selected items
      let maxSim = 0;
      for (const s of selected) {
        const sim = dot(c.vector, s.vector);
        if (sim > maxSim) maxSim = sim;
      }

      // Age bonus: older notes get a slight boost when serendipity is on
      const ageFactor =
        ageBias > 0
          ? ageBias * (1 - (c.item.mtime - oldestMtime) / mtimeRange)
          : 0;

      const mmrScore =
        lambda * relevance - (1 - lambda) * maxSim + ageFactor;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected.map(s => ({ item: s.item, score: s.score }));
}
