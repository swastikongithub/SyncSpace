// Each person is identified by a "ply" colour, named after the tinted sheets of a multi-part
// carbon form. The keys are stable identifiers; the web app maps them to theme-aware colours.
export const PLY_KEYS = Object.freeze(['canary', 'rose', 'sky', 'mint', 'lilac', 'apricot', 'teal', 'pewter']);

export function plyForSeed(seed) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PLY_KEYS[hash % PLY_KEYS.length];
}
