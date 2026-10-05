import { ID3_HEAD_BYTES, ID3V1_BYTES, tagsFromFilename, trackTags, type Tags } from '../radio/id3.js';

/**
 * Title and artist for an uploaded file: its ID3v2 tag (the first 64 KB), then its ID3v1 tag (the last 128 bytes),
 * then "Title - Artist" in its name. Reads only those two slices, never the whole file.
 */
export async function tagsFromBlob(file: Blob, name: string): Promise<Required<Tags>> {
  try {
    const [head, tail] = await Promise.all([
      file.slice(0, ID3_HEAD_BYTES).arrayBuffer(),
      file.slice(Math.max(0, file.size - ID3V1_BYTES)).arrayBuffer(),
    ]);
    return trackTags(name, new Uint8Array(head), new Uint8Array(tail));
  } catch {
    return tagsFromFilename(name);
  }
}
