/** Display names (spec §6): shared by the name card and the Worker. */
export const NAME_RULE = '3–20 letters, numbers, spaces, - or _';

/** Never anyone's display name, compared lower-cased with spaces, "-" and "_" removed. */
export const RESERVED_NAMES: readonly string[] = ['admin', 'administrator', 'aglow', 'santa', 'santaclaus', 'moderator', 'staff', 'support', 'official', 'system'];

/** The trimmed name when it follows the rule, else null. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return /^[A-Za-z0-9 _-]{3,20}$/.test(name) && !name.includes('  ') ? name : null;
}

/** Names are unique case-insensitively. */
export const nameKey = (name: string): string => name.toLowerCase();

export const isReserved = (name: string): boolean => RESERVED_NAMES.includes(name.toLowerCase().replace(/[ _-]/g, ''));
