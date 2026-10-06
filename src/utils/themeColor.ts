/**
 * Read a CSS custom property from the document root as the packed integer the
 * core expects (e.g. `--bg` -> 0x0c0c10). Returns `fallback` when the variable
 * is missing or not a literal hex colour (var() references cannot be resolved
 * for canvas painting).
 */
export function themeColor(name: string, fallback: number): number {
  const raw = getComputedStyle(window.document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(raw);
  if (!m) return fallback;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return parseInt(hex, 16);
}
