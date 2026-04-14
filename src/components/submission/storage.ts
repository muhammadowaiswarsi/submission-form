/**
 * Helpers for Supabase Storage URLs (public bucket paths).
 */

/**
 * Parses a public object URL into the storage object key for the configured bucket.
 */
export function extractStorageObjectPath(fileUrl: string, bucket: string): string | null {
  try {
    const u = new URL(fileUrl);
    const segments = u.pathname.split("/").filter(Boolean);
    const objectIdx = segments.indexOf("object");
    if (objectIdx === -1) {
      return null;
    }
    const urlBucket = segments[objectIdx + 2];
    if (segments[objectIdx + 1] !== "public" || urlBucket?.toLowerCase() !== bucket.toLowerCase()) {
      return null;
    }
    const keySegments = segments.slice(objectIdx + 3);
    if (keySegments.length === 0) {
      return null;
    }
    return decodeURIComponent(keySegments.join("/"));
  } catch {
    return null;
  }
}

/** True when the storage API reports a missing object (safe to ignore on delete). */
export function isStorageObjectMissingError(message: string) {
  const m = message.toLowerCase();
  return m.includes("not found") || m.includes("does not exist") || m.includes("404");
}
