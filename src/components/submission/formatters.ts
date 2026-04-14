/**
 * String and date helpers for submissions UI.
 */

/**
 * Produces a URL-safe storage key while keeping the file extension.
 */
export function sanitizeFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex > -1 ? fileName.slice(dotIndex) : "";
  const baseName = dotIndex > -1 ? fileName.slice(0, dotIndex) : fileName;
  const safeBaseName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${safeBaseName || "file"}${extension.toLowerCase()}`;
}

/**
 * Extracts the last path segment from a public file URL for display.
 */
export function extractFileName(fileUrl: string) {
  try {
    const pathname = new URL(fileUrl).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "Uploaded file");
  } catch {
    return "Uploaded file";
  }
}

/**
 * Formats an ISO-like timestamp in the viewer's locale and local timezone.
 */
export function formatDate(value?: string, withTime = false) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(normalizeTimestampForLocalDisplay(value));
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime
      ? {
          hour: "numeric",
          minute: "2-digit",
          timeZone: userTimeZone,
          timeZoneName: "short",
        }
      : { timeZone: userTimeZone }),
  }).format(date);
}

/**
 * Appends `Z` for naive timestamps so engines treat them as UTC before local display.
 */
function normalizeTimestampForLocalDisplay(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }

  const hasExplicitZone = /([zZ]|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(trimmed);
  if (hasExplicitZone) {
    return trimmed;
  }

  return `${trimmed.replace(" ", "T")}Z`;
}
