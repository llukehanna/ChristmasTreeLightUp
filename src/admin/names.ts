/** "Christmas Jazz" → "christmas-jazz": lower case, accents dropped, anything else becomes one hyphen, at most 64 characters. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 64)
      .replace(/-+$/, '') || 'station'
  );
}

/** What the Worker refuses in an upload name (worker/routes/admin/upload.ts). */
const BAD_CHARS = /[/\\\u0000-\u001f\u007f]/g;
const MAX_NAME = 200;
/** A short extension at the end of the name, kept when a long name is trimmed. */
const EXTENSION = /\.[^.\s]{1,10}$/;

/** The first characters of `s` (whole code points, never half a surrogate pair) that fit in `max` UTF-16 units. */
function fit(s: string, max: number): string {
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * A file name the upload endpoint accepts: 1–200 characters, no "/", "\" or control characters, not "." or "..".
 * Those characters become "-"; a long name is trimmed and keeps its extension. Everything else (unicode, apostrophes,
 * commas, spaces) is kept. The Worker prefixes a random suffix, so equal names never collide.
 */
export function safeUploadName(name: string): string {
  const clean = name.replace(BAD_CHARS, '-');
  if (clean === '' || clean === '.' || clean === '..') return 'upload';
  if (clean.length <= MAX_NAME) return clean;
  const ext = EXTENSION.exec(clean)?.[0] ?? '';
  return fit(clean.slice(0, clean.length - ext.length), MAX_NAME - ext.length) + ext;
}
