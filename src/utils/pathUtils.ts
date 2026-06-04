/** Split a path into normalized segments (handles both `/` and `\`). */
function pathSegments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

/**
 * Shorten a file-system path to the last 2 segments for readability.
 * Paths with 3 or fewer segments are returned as-is.
 */
export function shortenPath(path: string): string {
  const parts = pathSegments(path);
  if (parts.length <= 3) return path;
  return "~/" + parts.slice(-2).join("/");
}

/** Extract the last segment of a folder path as a short label. */
export function folderLabel(path: string): string {
  const parts = pathSegments(path);
  return parts[parts.length - 1] ?? path;
}
