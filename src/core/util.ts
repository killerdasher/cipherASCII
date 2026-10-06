/** Small dependency-free utilities used across the core. */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

let idCounter = 0;

/** Process-unique id with an optional readable prefix. */
export function newId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(
    Math.random() * 0xffffff,
  ).toString(36)}`;
}

/** Deterministic 32-bit hash (FNV-1a) for cache keys. */
export function hashString(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Stable JSON stringify (sorted object keys) for hashing settings. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Structural equality for plain settings objects: same own keys, equal values
 * (arrays and nested objects compared recursively, regardless of key order).
 *
 * Used instead of `JSON.stringify(a) !== JSON.stringify(b)` on undo/redo: no
 * string is built for objects that compare equal, and key order cannot make
 * two equal documents look different.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}

/** Deterministic PRNG (mulberry32) for procedural generators and fuzzing. */
export class Rng {
  private state: number;

  constructor(seed: number | string = 1) {
    if (typeof seed === 'string') {
      const h = parseInt(hashString(seed), 36);
      this.state = (h || 1) >>> 0;
    } else {
      this.state = seed >>> 0 || 1;
    }
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
}

/** True when the string is exactly one displayable cell character. */
export function isPrintableChar(ch: string): boolean {
  if (ch.length === 0) return false;
  const code = ch.codePointAt(0)!;
  if (code === 0x20 || (code >= 0x21 && code <= 0x7e)) return true;
  if (code >= 0xa0 && code !== 0x2028 && code !== 0x2029) {
    if (code >= 0x7f && code <= 0x9f) return false;
    return true;
  }
  return false;
}

/** True for C0/C1 control characters other than tab and newline. */
function isStrippableControl(code: number): boolean {
  if (code === 9 || code === 10 || code === 13) return false;
  return code < 32 || (code >= 127 && code <= 159);
}

/** Strip control characters from untrusted text, keeping \t, \n and \r. */
export function sanitizeText(input: string): string {
  let out = '';
  for (const ch of input) {
    if (!isStrippableControl(ch.codePointAt(0)!)) out += ch;
  }
  return out;
}

/** True when `value` is a finite non-negative safe integer cell count. */
export function isCellCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
