/**
 * Simple content hash — FNV-1a 32-bit, fast, no crypto needed.
 * Used for incremental diff: if hash unchanged, chunk is unchanged.
 */
export function hashStr(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
