import type { Page, Request, Route } from '@playwright/test';
import { expect, test } from './fixtures';
import type { Station, StationsFile } from '../../src/radio/schema';

// Every admin API call is routed (the local Worker's admin routes need a real admin session), so no real uploads happen in e2e.

const MEDIA = 'https://aglow-music.example';
const fixture = (): StationsFile => ({
  version: 7,
  stations: [
    {
      id: 'christmas-classics',
      name: 'Christmas Classics',
      description: '',
      tracks: [
        { id: 't1', url: `${MEDIA}/tracks/christmas-classics/aaaa1111-sleigh.mp3`, title: 'Sleigh Ride', artist: 'The Ronettes', credit: '', duration: 182 },
        { id: 't2', url: `${MEDIA}/tracks/christmas-classics/bbbb2222-blue.mp3`, title: 'Blue Christmas', artist: 'Elvis Presley', credit: '', duration: 127 },
      ],
    },
  ],
});

interface Api {
  puts: { expectedVersion: number; stations: Station[] }[];
  gets: number;
  /** What the next PUT /api/admin/stations answers (null: success, echoing version + 1). */
  putStatus: { status: number; error: string } | null;
}

/** A signed-in admin over a routed API. */
async function admin(page: Page, data: StationsFile = fixture()): Promise<Api> {
  const state: Api = { puts: [], gets: 0, putStatus: null };
  await page.route('**/api/admin/session', (r) => r.fulfill({ json: { admin: true, name: null } }));
  await page.route('**/api/admin/stations', async (r) => {
    if (r.request().method() === 'GET') {
      state.gets++;
      return r.fulfill({ json: data });
    }
    const body = r.request().postDataJSON() as Api['puts'][number];
    state.puts.push(body);
    if (state.putStatus) return r.fulfill({ status: state.putStatus.status, json: { error: state.putStatus.error } });
    return r.fulfill({ json: { version: body.expectedVersion + 1 } });
  });
  await page.goto('/admin.html');
  await expect(page.getByRole('button', { name: /Christmas Classics/ })).toBeVisible();
  return state;
}

/** Whether leaving the page now would make the browser ask first (the page's beforeunload decision). */
const leaveWarns = (page: Page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

test('admin page loads and asks for Google sign-in', async ({ page }) => {
  await page.route('**/api/admin/session', (r) => r.fulfill({ status: 401, json: { error: 'signed_out', message: 'Sign in first.' } }));
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name: 'Radio admin' })).toBeVisible();
  const google = page.getByRole('link', { name: 'Sign in with Google' });
  await expect(google).toBeFocused();
  await expect(google).toHaveAttribute('href', '/api/auth/google?return=%2Fadmin');
  await expect(google).not.toHaveAttribute('target', '_blank');
});

test('another Google account is told it is not authorized', async ({ page }) => {
  await page.route('**/api/admin/session', (r) => r.fulfill({ status: 403, json: { error: 'forbidden', message: 'This account is not the radio admin.' } }));
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use another account' })).toBeFocused();
});

test('the game bundle has no admin code (and the admin bundle does)', async ({ page }) => {
  await page.route('**/api/stations', (r) => r.fulfill({ status: 404, body: '' }));
  const scripts = new Map<string, string>();
  page.on('response', async (r) => {
    if (r.url().endsWith('.js')) scripts.set(r.url(), await r.text());
  });
  await page.goto('/?test');
  await page.waitForLoadState('networkidle');
  const game = [...scripts.values()].join('\n');
  expect(game.length).toBeGreaterThan(10_000);
  expect(game).not.toContain('/api/admin/');
  expect(game).not.toContain('handleUploadUrl');

  scripts.clear();
  await page.route('**/api/admin/session', (r) => r.fulfill({ status: 401, json: { error: 'signed_out', message: 'Sign in first.' } }));
  await page.goto('/admin.html');
  await page.waitForLoadState('networkidle');
  expect([...scripts.values()].join('\n')).toContain('/api/admin/');
});

test('create a station, edit a track, save; a conflict offers a reload', async ({ page }) => {
  const api = await admin(page);
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled(); // nothing changed yet

  // 1. A new station through the inline form.
  await page.getByRole('button', { name: '+ New station' }).click();
  await page.getByLabel('New station name').fill('Christmas Jazz');
  await expect(page.getByText('id: christmas-jazz')).toBeVisible(); // the preview
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('button', { name: /Christmas Jazz/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.meta-row .id')).toHaveText('id: christmas-jazz');
  await expect(page.getByText('No tracks yet.')).toBeVisible();

  // A second station with the same id is refused in the page.
  await page.getByRole('button', { name: '+ New station' }).click();
  await page.getByLabel('New station name').fill('christmas  JAZZ!');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.new-station .err')).toHaveText('A station with the id "christmas-jazz" already exists.');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // 2. Edit a track title.
  await page.getByRole('button', { name: /Christmas Classics/ }).click();
  await page.getByLabel('Track 2 title').fill('Blue Christmas (Live)');
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v7 · unsaved changes');

  // 3. Save: the PUT carries the version that was loaded.
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved. Live in the game within a minute' })).toBeVisible();
  expect(api.puts).toHaveLength(1);
  expect(api.puts[0].expectedVersion).toBe(7);
  expect(api.puts[0].stations.map((s) => s.id)).toEqual(['christmas-classics', 'christmas-jazz']);
  expect(api.puts[0].stations[0].tracks[1].title).toBe('Blue Christmas (Live)');
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v8');
  await expect(save).toBeDisabled();

  // 4. Somebody else saved first: the server's message, and a reload behind an in-page confirm.
  api.putStatus = { status: 409, error: 'Stations changed somewhere else. Reload to get the latest, then redo your change.' };
  await page.getByLabel('Track 1 artist').fill('Ronettes');
  await save.click();
  const msg = page.locator('.msg');
  await expect(msg).toContainText('Stations changed somewhere else. Reload to get the latest, then redo your change.');
  expect(api.puts.at(-1)?.expectedVersion).toBe(8);
  await expect(save).toBeEnabled(); // the edits are kept
  await msg.getByRole('button', { name: 'Reload' }).click();
  await expect(msg).toContainText('Reloading discards your unsaved edits here.');
  const getsBefore = api.gets;
  await msg.getByRole('button', { name: 'Reload and discard edits' }).click();
  await expect(page.getByLabel('Track 1 artist')).toHaveValue('The Ronettes');
  expect(api.gets).toBe(getsBefore + 1);
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v7');
  await expect(msg).toBeHidden();
});

test('other save failures keep the edits; invalid fields are pointed at before sending', async ({ page }) => {
  const api = await admin(page);
  expect(await leaveWarns(page)).toBe(false); // nothing to lose yet
  await page.getByLabel('Track 1 title').fill('   ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.msg')).toHaveText('Christmas Classics, track 1: the title is empty. Every track needs a title.');
  await expect(page.getByLabel('Track 1 title')).toBeFocused();
  expect(api.puts).toHaveLength(0);

  await page.getByLabel('Track 1 title').fill('Sleigh Ride');
  api.putStatus = { status: 503, error: 'Could not save. Try again.' };
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.msg')).toContainText('Could not save. Try again.');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(await leaveWarns(page)).toBe(true); // unsaved edits
  api.putStatus = null;
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v8');
  expect(await leaveWarns(page)).toBe(false);
});

test('an expired session goes back to sign-in and keeps the unsaved edits', async ({ page }) => {
  const api = await admin(page);
  await page.getByLabel('Track 1 title').fill('Sleigh Ride (Mono)');
  api.putStatus = { status: 401, error: 'Not signed in' };
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toHaveText('Your session expired. Sign in again.');
  // Leaving would lose the edits: Google opens in a new tab, and Continue checks again.
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('target', '_blank');
  const gets = api.gets;
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Track 1 title')).toHaveValue('Sleigh Ride (Mono)');
  expect(api.gets).toBe(gets); // no load() over the edits
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v7 · unsaved changes');
});

test('a 403 mid-session says Not authorized; another account signs in in a new tab and the edits are kept', async ({ page }) => {
  const api = await admin(page);
  let signOuts = 0;
  await page.route('**/api/auth/signout', (r) => {
    signOuts++;
    return r.fulfill({ json: {} });
  });
  await page.getByLabel('Track 1 title').fill('Sleigh Ride (Mono)');
  api.putStatus = { status: 403, error: 'forbidden' };
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
  await page.getByRole('button', { name: 'Use another account' }).click();
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('target', '_blank');
  expect(signOuts).toBe(1);
  expect(await leaveWarns(page)).toBe(true);
  const gets = api.gets;
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Track 1 title')).toHaveValue('Sleigh Ride (Mono)');
  expect(api.gets).toBe(gets);
});

test('delete a station with an in-page confirm', async ({ page }) => {
  const api = await admin(page);
  await page.getByRole('button', { name: 'Delete station' }).click();
  const confirm = page.getByRole('group', { name: 'Confirm delete' });
  await expect(confirm).toContainText('Delete "Christmas Classics" and its 2 tracks?');
  await expect(confirm).toContainText('copies may stay cached at the edge for up to a week');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: /Christmas Classics/ })).toBeVisible();
  await page.getByRole('button', { name: 'Delete station' }).click();
  await page.getByRole('group', { name: 'Confirm delete' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Create a station to start uploading music.')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v8');
  expect(api.puts[0].stations).toEqual([]);
});

// ---------- uploads (routed: no storage is touched) ----------

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
/** A few KB that start with an ID3v2.3 tag carrying a title and an artist. */
function taggedMp3(title: string, artist: string): Buffer {
  const frame = (id: string, text: string) => [...ascii(id), 0, 0, 0, text.length + 1, 0, 0, 0, ...ascii(text)];
  const body = [...frame('TIT2', title), ...frame('TPE1', artist), ...new Array<number>(16).fill(0)];
  return Buffer.from([...ascii('ID3'), 3, 0, 0, 0, 0, 0, body.length, ...body, ...new Array<number>(4000).fill(0x55)]);
}
const mp3 = (name: string, buffer = Buffer.alloc(3000, 0x55)) => ({ name, mimeType: 'audio/mpeg', buffer });

interface Upload {
  folder: string | null;
  station: string | null;
  name: string | null;
  type: string | undefined;
}
/** Routes PUT /api/admin/upload. `hold(name)` delays that file's answer until `release(name)`. */
async function uploads(page: Page) {
  const seen: Upload[] = [];
  const held = new Map<string, () => void>();
  const holding = new Set<string>();
  const failing = new Map<string, { status: number; error: string }>();
  await page.route(/\/api\/admin\/upload\?/, async (route: Route, req: Request) => {
    const q = new URL(req.url()).searchParams;
    const name = q.get('name') ?? '';
    seen.push({ folder: q.get('folder'), station: q.get('station'), name, type: req.headers()['content-type'] });
    if (holding.has(name)) await new Promise<void>((r) => held.set(name, r));
    const fail = failing.get(name);
    if (fail) return route.fulfill({ status: fail.status, json: { error: fail.error } });
    const key = `${q.get('folder')}/${q.get('station')}/0123abcd-${name}`;
    return route.fulfill({ json: { url: `${MEDIA}/${key.split('/').map(encodeURIComponent).join('/')}`, key, size: 3000 } });
  });
  return {
    seen,
    failing,
    hold: (name: string) => holding.add(name),
    release: (name: string) => {
      holding.delete(name);
      held.get(name)?.();
    },
  };
}

test('uploads join one queue, land in the order they were added, and the file input survives', async ({ page }) => {
  await admin(page);
  const up = await uploads(page);
  const input = page.getByLabel('Upload tracks');
  await expect(input).toHaveAttribute('type', 'file');
  await page.evaluate(() => {
    (window as unknown as { pinned: Element | null }).pinned = document.querySelector('input[aria-label="Upload tracks"]');
  });

  // Batch 1: the first file finishes last.
  up.hold('Jingle Bells - Frank Sinatra.mp3');
  await input.setInputFiles([
    mp3('Jingle Bells - Frank Sinatra.mp3'),
    { name: 'tagged.mp3', mimeType: 'audio/mpeg', buffer: taggedMp3('Silver Bells', 'Bing Crosby') },
    mp3('Linus And Lucy.mp3'),
  ]);
  await expect(input).toHaveValue(''); // reset so the same names can be picked again
  const summary = page.locator('#upload-summary');
  await expect(summary).toHaveText('Uploading: 2 done, 1 uploading, 0 queued.');
  await expect(page.getByText('No tracks yet.')).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(2); // the later two wait for the first
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear finished' })).toBeDisabled(); // the two done files are still held
  expect(await leaveWarns(page)).toBe(true); // uploads running

  // Batch 2 joins while batch 1 is still running, through the same element.
  up.failing.set('broken.mp3', { status: 413, error: 'The file is too large (30 MB max)' });
  await input.setInputFiles([mp3('Feliz Navidad - José Feliciano.mp3'), mp3('broken.mp3')]);
  await expect(page.locator('.up', { hasText: 'broken.mp3' })).toContainText('failed: The file is too large (30 MB max)');
  up.release('Jingle Bells - Frank Sinatra.mp3');
  await expect(summary).toHaveText('All uploads finished: 4 done, 1 failed.');

  const titles = await page.locator('tbody tr td.title input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(titles).toEqual(['Sleigh Ride', 'Blue Christmas', 'Jingle Bells', 'Silver Bells', 'Linus And Lucy', 'Feliz Navidad']);
  await expect(page.getByLabel('Track 4 artist')).toHaveValue('Bing Crosby'); // from the ID3 tag
  await expect(page.getByLabel('Track 6 artist')).toHaveValue('José Feliciano');
  await expect(page.getByRole('button', { name: /Christmas Classics/ })).toContainText('6 tracks');
  expect(await page.evaluate(() => (window as unknown as { pinned: Element | null }).pinned === document.querySelector('input[aria-label="Upload tracks"]'))).toBe(true);
  expect(up.seen[0]).toEqual({ folder: 'tracks', station: 'christmas-classics', name: 'Jingle Bells - Frank Sinatra.mp3', type: 'audio/mpeg' });

  // Retry the failed one; clearing finished rows keeps nothing but what still matters.
  up.failing.delete('broken.mp3');
  await page.getByRole('button', { name: 'Retry broken.mp3' }).click();
  await expect(summary).toHaveText('All uploads finished: 5 done.');
  await expect(page.locator('tbody tr')).toHaveCount(7);
  await page.getByRole('button', { name: 'Clear finished' }).click();
  await expect(page.locator('.up')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test('an upload with no progress for 2 minutes fails as stalled, and Retry sends it again', async ({ page }) => {
  await page.clock.install();
  await admin(page);
  let calls = 0;
  await page.route(/\/api\/admin\/upload\?/, async (route) => {
    calls++;
    if (calls === 1) return; // never answered
    return route.fulfill({ json: { url: `${MEDIA}/tracks/christmas-classics/0123abcd-late.mp3`, key: 'k', size: 3000 } });
  });
  await page.getByLabel('Upload tracks').setInputFiles([mp3('Late - Somebody.mp3')]);
  const row = page.locator('.up', { hasText: 'Late - Somebody.mp3' });
  await expect(row).toContainText('0%');
  await page.clock.fastForward(119_000);
  await expect(row).toContainText('0%');
  await page.clock.fastForward(2_000);
  await expect(row).toContainText('failed: Upload stalled');
  await page.getByRole('button', { name: 'Retry Late - Somebody.mp3' }).click();
  await expect(row).toContainText('done');
  expect(calls).toBe(2);
  await expect(page.getByLabel('Track 3 title')).toHaveValue('Late');
});

test('an upload that fails with a 503 is retried once by itself; a 413 is not', async ({ page }) => {
  await admin(page);
  const calls: Record<string, number> = {};
  await page.route(/\/api\/admin\/upload\?/, (route) => {
    const name = new URL(route.request().url()).searchParams.get('name') ?? '';
    calls[name] = (calls[name] ?? 0) + 1;
    if (name === 'flaky.mp3' && calls[name] === 1) return route.fulfill({ status: 503, json: { error: 'Upload failed. Try again.' } });
    if (name === 'big.mp3') return route.fulfill({ status: 413, json: { error: 'The file is too large (30 MB max)' } });
    return route.fulfill({ json: { url: `${MEDIA}/tracks/christmas-classics/0123abcd-${name}`, key: 'k', size: 3000 } });
  });
  await page.getByLabel('Upload tracks').setInputFiles([mp3('flaky.mp3'), mp3('big.mp3')]);
  await expect(page.locator('.up', { hasText: 'big.mp3' })).toContainText('failed: The file is too large (30 MB max)');
  await expect(page.locator('.up', { hasText: 'flaky.mp3' })).toContainText('done'); // after its automatic retry
  expect(calls).toEqual({ 'flaky.mp3': 2, 'big.mp3': 1 });
  await expect(page.getByLabel('Track 3 title')).toHaveValue('flaky');
});

test('a 401 on an upload while only uploads are pending keeps the queue, and Continue resumes it', async ({ page }) => {
  const api = await admin(page);
  const up = await uploads(page);
  up.failing.set('One.mp3', { status: 401, error: 'signed_out' });
  up.hold('Two.mp3');
  up.hold('Three.mp3');
  await page.getByLabel('Upload tracks').setInputFiles([mp3('One.mp3'), mp3('Two.mp3'), mp3('Three.mp3'), mp3('Four.mp3')]);
  await expect(page.getByRole('alert')).toHaveText('Your session expired. Sign in again.');
  // No edits yet, but leaving would lose the queued files: Google opens in a new tab.
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('target', '_blank');
  expect(await leaveWarns(page)).toBe(true);
  up.release('Two.mp3');
  up.release('Three.mp3');
  up.failing.delete('One.mp3');
  const gets = api.gets;
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#upload-summary')).toHaveText('All uploads finished: 4 done.');
  const titles = await page.locator('tbody tr td.title input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(titles).toEqual(['Sleigh Ride', 'Blue Christmas', 'One', 'Two', 'Three', 'Four']);
  // Three uploads run at once, so each batch's requests can reach the route in any order.
  const seen = up.seen.map((s) => s.name);
  expect(seen.slice(0, 3).sort()).toEqual(['One.mp3', 'Three.mp3', 'Two.mp3']);
  expect(seen.slice(3).sort()).toEqual(['Four.mp3', 'One.mp3']);
  expect(api.gets).toBe(gets); // no load() over the queue
});

test('a second 403 leaves the Not authorized card alone, and one arriving after "Use another account" is ignored', async ({ page }) => {
  await admin(page);
  const up = await uploads(page);
  let signOuts = 0;
  await page.route('**/api/auth/signout', (r) => {
    signOuts++;
    return r.fulfill({ json: {} });
  });
  for (const name of ['One.mp3', 'Two.mp3', 'Three.mp3']) up.failing.set(name, { status: 403, error: 'forbidden' });
  up.hold('Two.mp3');
  up.hold('Three.mp3');
  await page.getByLabel('Upload tracks').setInputFiles([mp3('One.mp3'), mp3('Two.mp3'), mp3('Three.mp3')]);
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
  const back = page.getByRole('link', { name: 'Back to Aglow' });
  await back.focus();
  up.release('Two.mp3');
  await expect.poll(() => up.seen.length).toBe(3);
  await page.waitForTimeout(200);
  await expect(back).toBeFocused(); // not re-rendered
  await page.getByRole('button', { name: 'Use another account' }).click();
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
  expect(signOuts).toBe(1);
  up.release('Three.mp3');
  await page.waitForTimeout(300);
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
});

test('back from a failed sign-in, /admin says so and drops ?auth=failed from the address', async ({ page }) => {
  await page.route('**/api/admin/session', (r) => r.fulfill({ status: 401, json: { error: 'signed_out', message: 'Sign in first.' } }));
  await page.goto('/admin?auth=failed');
  await expect(page.getByRole('alert')).toHaveText("Sign-in didn't finish. Try again.");
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/auth/google?return=%2Fadmin');
});

test('after a conflict, Reload is refused while uploads are running', async ({ page }) => {
  const api = await admin(page);
  const up = await uploads(page);
  api.putStatus = { status: 409, error: 'Stations changed somewhere else. Reload to get the latest, then redo your change.' };
  await page.getByLabel('Track 1 title').fill('Sleigh Ride!');
  await page.getByRole('button', { name: 'Save' }).click();
  const msg = page.locator('.msg');
  await expect(msg).toContainText('Stations changed somewhere else.');
  up.hold('Slow.mp3');
  await page.getByLabel('Upload tracks').setInputFiles([mp3('Slow.mp3')]);
  await msg.getByRole('button', { name: 'Reload' }).click();
  const gets = api.gets;
  await msg.getByRole('button', { name: 'Reload and discard edits' }).click();
  await expect(msg).toContainText('Uploads are still running. Wait for them to finish, then reload.');
  expect(api.gets).toBe(gets);
  up.release('Slow.mp3');
  await expect(page.locator('#upload-summary')).toHaveText('All uploads finished: 1 done.');
  await msg.getByRole('button', { name: 'Reload' }).click();
  await msg.getByRole('button', { name: 'Reload and discard edits' }).click();
  await expect(page.getByLabel('Track 1 title')).toHaveValue('Sleigh Ride');
  expect(api.gets).toBe(gets + 1);
});

test('a cover uploads through its own labelled input', async ({ page }) => {
  await admin(page);
  const up = await uploads(page);
  await page.getByLabel('Upload cover').setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) });
  await expect(page.locator('.cover img')).toHaveAttribute('src', /covers\/christmas-classics\/0123abcd-art.png$/);
  await expect(page.getByLabel('Upload cover')).toHaveCount(1);
  expect(up.seen[0]).toMatchObject({ folder: 'covers', type: 'image/png' });
});

test('the Secret station: its own button creates it, labelled Secret mode only; a win ad-lib uploads to tracks/secret and is saved', async ({ page }) => {
  const api = await admin(page);
  const up = await uploads(page);
  await page.getByRole('button', { name: '+ Secret station' }).click();
  const nav = page.locator('nav .station', { hasText: 'Secret mode only' });
  await expect(nav).toHaveAttribute('aria-current', 'true');
  await expect(nav).toContainText('secret · 0 tracks');
  await expect(page.getByRole('button', { name: '+ Secret station' })).toHaveCount(0);
  await expect(page.getByText('Secret mode only. The game lists this station only while secret mode is on, and plays it when secret mode is switched on.')).toBeVisible();
  const pick = page.locator('.secret-panel label.button');
  await expect(pick).toHaveText('Add win ad-lib');

  await page.getByLabel('Upload win ad-lib').setInputFiles([mp3('Ad-lib.mp3')]);
  await expect(page.locator('.up', { hasText: 'Win ad-lib: Ad-lib.mp3' })).toContainText('done');
  expect(up.seen.at(-1)).toEqual({ folder: 'tracks', station: 'secret', name: 'Ad-lib.mp3', type: 'audio/mpeg' });
  await expect(pick).toHaveText('Replace win ad-lib');
  await expect(page.getByRole('button', { name: 'Remove win ad-lib' })).toBeVisible();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved. Live in the game within a minute' })).toBeVisible();
  expect(api.puts[0].stations.find((s) => s.id === 'secret')).toEqual({
    id: 'secret', name: 'Secret', description: '', tracks: [], winSound: `${MEDIA}/tracks/secret/0123abcd-Ad-lib.mp3`,
  });

  await page.getByRole('button', { name: 'Remove win ad-lib' }).click();
  await expect(pick).toHaveText('Add win ad-lib');
  await expect(page.locator('header .sub')).toContainText('unsaved changes');
});

// ---------- lengths (a routed fake media host: no real storage, no real music) ----------

/** MPEG-1 Layer III, 128 kbit/s: 16 000 audio bytes per second. Zeros after two frame headers. */
function silentMp3(seconds: number): Buffer {
  const b = Buffer.alloc(seconds * 16_000);
  for (const at of [0, 417]) b.set([0xff, 0xfb, 0x90, 0x00], at);
  return b;
}

test('"Fill in missing lengths" reads each 0:00 track by range request, marks the list unsaved, and one Save keeps them', async ({ page }) => {
  const track = (id: string, name: string, duration: number) => ({ id, url: `${MEDIA}/tracks/christmas-classics/${name}.mp3`, title: name, artist: '', credit: '', duration });
  const data: StationsFile = {
    version: 3,
    stations: [{ id: 'christmas-classics', name: 'Christmas Classics', description: '', tracks: [track('a', 'aaaa', 0), track('b', 'bbbb', 0), track('c', 'cccc', 61), track('d', 'dddd', 0)] }],
  };
  const files = new Map([
    ['aaaa', silentMp3(95)],
    ['cccc', silentMp3(10)],
    ['dddd', silentMp3(200)],
  ]);
  const ranges: (string | undefined)[] = [];
  // bbbb is missing from the host; the others answer with a 206 and Content-Range, like R2 does.
  await page.route(`${MEDIA}/**`, (route) => {
    const name = /\/([a-z]+)\.mp3$/.exec(route.request().url())?.[1] ?? '';
    const file = files.get(name);
    const range = route.request().headers()['range'];
    ranges.push(range);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range' };
    if (!file) return route.fulfill({ status: 404, headers: cors, body: 'missing' });
    const end = Math.min(65_535, file.length - 1);
    return route.fulfill({ status: 206, headers: { ...cors, 'Content-Range': `bytes 0-${end}/${file.length}` }, body: file.subarray(0, end + 1) });
  });
  const api = await admin(page, data);
  const fill = page.getByRole('button', { name: /Fill in missing lengths/ });
  await expect(fill).toHaveText('Fill in missing lengths (3)');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  await fill.click();
  await expect(page.locator('.msg')).toHaveText('Filled in 2 lengths; 1 could not be read and stay blank. Save to keep the rest.');
  await expect(page.locator('tbody tr td.dur')).toHaveText(['1:35', '–', '1:01', '3:20']); // c was never asked
  expect(ranges.every((r) => r === 'bytes=0-65535')).toBe(true);
  expect(ranges).toHaveLength(3);
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v3 · unsaved changes');
  await expect(fill).toHaveText('Fill in missing lengths (1)'); // the track that failed is still offered

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('header .sub')).toHaveText('Radio admin · v4');
  expect(api.puts).toHaveLength(1);
  expect(api.puts[0].stations[0].tracks.map((t) => t.duration)).toEqual([95, 0, 61, 200]);
});

test('an uploaded MP3 gets its length from its own bytes, even when the browser could not load it', async ({ page }) => {
  await admin(page);
  await uploads(page);
  // Not decodable audio (frame headers over zeros), so only the byte reader can know it is 75 s long.
  await page.getByLabel('Upload tracks').setInputFiles([{ name: 'Silent Night.mp3', mimeType: 'audio/mpeg', buffer: silentMp3(75) }]);
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('tbody tr td.dur').last()).toHaveText('1:15');
});

test('phone width: no horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await admin(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  // The track table scrolls inside its own container instead.
  const wrap = await page.locator('.table-wrap').evaluate((e) => e.scrollWidth > e.clientWidth);
  expect(wrap).toBe(true);
  // The header stays stuck to the top while the page scrolls.
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  expect((await page.locator('header').boundingBox())?.y).toBe(0);
});

// The real Worker, nothing routed: fake Google, then the real requireAdmin (200 for the admin, 403 for anyone else).
test('the admin signs in with (fake) Google and gets the editor; another account is not authorized', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'desktop only');
  const as = (email: string) => context.addCookies([{ name: 'aglow_fake_as', value: email, url: 'http://localhost:4173' }]);
  await as('admin@example.com');
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Radio admin' })).toBeVisible();
  await as('someone@example.com');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
});

// The real Worker, nothing routed: the admin imports this device's history (fake Google). The times are slow on purpose
// (50 minutes) so the shared e2e board's top runs, which other tests check, don't change.
test("the admin imports this device's history once", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'desktop only');
  await context.addCookies([{ name: 'aglow_fake_as', value: 'admin@example.com', url: 'http://localhost:4173' }]);
  await page.addInitScript(() => {
    if (localStorage.getItem('aglow.stats')) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('aglow.stats', JSON.stringify({ v: 1, solved: 3, totalSeconds: 9300, bestSeconds: 3000, bestScore: -250000, streak: 1, longestStreak: 2, lastSolvedDay: today }));
  });
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  const card = page.getByRole('region', { name: "Import this device's history" });
  await expect(card.getByLabel('Games solved')).toHaveValue('3');
  await expect(card.getByLabel('Best time (m:ss)')).toHaveValue('50:00');
  await expect(card.getByLabel('Average time (m:ss.t)')).toHaveValue('51:40.0');
  await expect(card.getByLabel('Current streak (days)')).toHaveValue('1');
  await expect(card.getByLabel('Longest streak (days)')).toHaveValue('2');
  await expect(card).toContainText(/Your account already has [\d,]+ played games?/);

  // Before anything is sent, the card says what it will create, and follows edits.
  const preview = card.locator('.preview');
  await expect(preview).toHaveText(/^Will add 3 runs: best 50:00\.0, average 51:40\.0, streak 1 day, longest streak 2 days, last played \d{4}-\d{2}-\d{2}\.$/);
  await card.getByLabel('Average time (m:ss.t)').fill('40:00.0');
  await expect(preview).toHaveText("Average time can't be faster than the best time.");
  await expect(card.getByRole('button', { name: 'Import 3 runs' })).toBeDisabled();
  await card.getByLabel('Average time (m:ss.t)').fill('51:40.0');
  await expect(preview).toContainText('Will add 3 runs');

  await card.getByRole('button', { name: 'Import 3 runs' }).click();
  await expect(card.getByRole('status')).toHaveText('Imported 3 runs from this device.');
  await expect(card.getByRole('button', { name: 'Imported' })).toBeDisabled();

  // The account has them: ranked, marked imported, the best exactly 50:00.
  const stats = await page.evaluate(async () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return (await (await fetch(`/api/me/stats?today=${today}&tz=${d.getTimezoneOffset()}`)).json()) as { imported: number };
  });
  expect(stats.imported).toBeGreaterThanOrEqual(3);
  const mine = (await (await page.request.get('/api/me/games')).json()) as { games: { imported: boolean; ms: number }[] };
  const fromDevice = mine.games.filter((g) => g.imported);
  expect(fromDevice.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...fromDevice.map((g) => g.ms))).toBe(3_000_000);

  // This device stays marked as imported.
  await page.reload();
  await expect(card.getByRole('button', { name: 'Imported' })).toBeDisabled();
  await expect(card.getByRole('status')).toHaveText("This device's history was imported (3 runs).");
});

// The card at phone width (the phone project only runs the account flows, so this sets the width itself). It imports
// nothing: the grid of fields and the long preview line must fit 375 px, with the Import button in view.
test("the import card fits a phone-width screen and its errors match the card's other errors", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'sets its own width');
  await page.setViewportSize({ width: 375, height: 812 });
  await context.addCookies([{ name: 'aglow_fake_as', value: 'admin@example.com', url: 'http://localhost:4173' }]);
  await page.addInitScript(() => {
    if (localStorage.getItem('aglow.stats')) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('aglow.stats', JSON.stringify({ v: 1, solved: 1500, totalSeconds: 1500 * 3100, bestSeconds: 3000, bestScore: -250000, streak: 12, longestStreak: 120, lastSolvedDay: today }));
  });
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  const card = page.getByRole('region', { name: "Import this device's history" });
  const button = card.getByRole('button', { name: 'Import 1,500 runs' });
  await expect(button).toBeVisible();
  // A typed average keeps its hundredths in the longest preview line.
  await card.getByLabel('Average time (m:ss.t)').fill('51:40.45');
  await expect(card.locator('.preview')).toContainText('average 51:40.45,');
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  const box = await card.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await card.locator('.preview').evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);

  // The invalid-form message and the server-error line are one colour. The button stays focusable and says why it is off.
  await card.getByLabel('Average time (m:ss.t)').fill('40:00.0');
  const colour = (sel: string) => card.locator(sel).evaluate((n) => getComputedStyle(n).color);
  expect(await colour('.preview.bad')).toBe(await colour('.err'));
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).toHaveAccessibleDescription(/Average time can't be faster than the best time\./);
});
