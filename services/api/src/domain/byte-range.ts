/** Single RFC 9110 byte range. Multipart ranges are intentionally unsupported. */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size < 1) return null;
  const suffix = !match[1];
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || !match[2] ? size - 1 : Math.min(size - 1, Number(match[2]));
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (suffix && Number(match[2]) <= 0)) return null;
  return { start, end };
}
