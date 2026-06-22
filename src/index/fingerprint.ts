import { hashStr } from "../util/hash";
import { CHUNKING_VERSION } from "./chunker";

export interface ModelFingerprint {
  providerId: string;
  model: string;
  dimensions: number;
  chunkingVersion: number;
}

/**
 * Compute a stable string fingerprint from provider + model + dimensions + chunking version.
 * If ANY of these change, vectors from different fingerprints must not be mixed.
 */
export function computeFingerprint(opts: ModelFingerprint): string {
  const str = `${opts.providerId}:${opts.model}:${opts.dimensions}:${opts.chunkingVersion}`;
  return hashStr(str);
}

export function currentFingerprint(
  providerId: string,
  model: string,
  dimensions: number
): string {
  return computeFingerprint({
    providerId,
    model,
    dimensions,
    chunkingVersion: CHUNKING_VERSION,
  });
}
