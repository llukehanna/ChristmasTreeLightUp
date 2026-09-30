export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(hex: string, withHex: string, k: number): string {
  const a = hexRgb(hex);
  const b = hexRgb(withHex);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}
export function shade(hex: string, k: number): string {
  return `rgb(${hexRgb(hex).map((v) => Math.round(v * k)).join(',')})`;
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
