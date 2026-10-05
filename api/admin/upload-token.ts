import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { adminJson, readTextCapped, requireAdmin } from '../_lib/http.js';

const AUDIO = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg'];
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BODY = 16 * 1024;
/** tracks/<station-id>/<file> or covers/<station-id>/<file>; the station id follows the schema's id rule. */
const UPLOAD_PATH = /^(tracks|covers)\/[a-z0-9][a-z0-9-]{0,63}\/[^/\\\u0000-\u001f\u007f]{1,200}$/;

class PathRejected extends Error {}

/** Blob client-upload handshake. Token requests need a session; completion callbacks are verified by the SDK's signature check. */
export async function POST(req: Request): Promise<Response> {
  const text = await readTextCapped(req, MAX_BODY);
  if (text === null) return adminJson({ error: 'Request too large' }, { status: 413 });
  let body: HandleUploadBody;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('bad body');
    body = parsed as HandleUploadBody;
  } catch {
    return adminJson({ error: 'Invalid request' }, { status: 400 });
  }
  if (body.type !== 'blob.upload-completed') {
    const denied = requireAdmin(req);
    if (denied) return denied;
  }
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (typeof pathname !== 'string' || !UPLOAD_PATH.test(pathname) || /(^|\/)\.\.?(\/|$)/.test(pathname)) {
          throw new PathRejected('Uploads must go to tracks/<station>/<file> or covers/<station>/<file>');
        }
        return {
          allowedContentTypes: pathname.startsWith('covers/') ? IMAGES : AUDIO,
          maximumSizeInBytes: 30 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do: the admin saves the track into the station list itself.
      },
    });
    return adminJson(json);
  } catch (e) {
    return adminJson({ error: e instanceof PathRejected ? e.message : 'Upload request refused' }, { status: 400 });
  }
}
