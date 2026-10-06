import './admin.css';
import { parseStation, type Station, type StationsFile, type Track } from '../radio/schema.js';
import { ApiError, api, audioDuration } from './api.js';
import { slugify } from './names.js';
import { mustWarnBeforeLeaving } from './leave.js';
import { fillMissingLengths, isMp3, mp3DurationOfBlob } from './lengths.js';
import { UploadQueue, type QueueItem } from './queue.js';
import { tagsFromBlob } from './tags.js';
import { firstProblem, type Field, type Problem } from './validate.js';
import { watchdog } from './watchdog.js';

/*
 * Radio admin. Claude drives this page through a browser extension, so:
 * - no alert/confirm/prompt (native dialogs block it). The one native prompt kept is beforeunload, which appears only
 *   when leaving would lose unsaved edits, queued uploads or a save in flight: never navigate or reload the tab then;
 * - the file inputs are real, visually hidden (never display:none) and labelled, and each station keeps the same
 *   input element for the whole session, so a reference to it stays valid through a long upload;
 * - the upload queue and its rows live outside render(), and a finished track updates the table in place.
 */

const MAX_UPLOAD = 30 * 1024 * 1024;
/** An upload with no progress (and no answer) for this long is aborted, and its row offers Retry. */
const STALL_MS = 120_000;
const MAX_STATIONS = 20;
const SESSION_EXPIRED = 'Your session expired. Sign in again.';

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'children'>> & {
  class?: string;
  attrs?: Record<string, string>;
};
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, attrs, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const [k, v] of Object.entries(attrs ?? {})) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

const fmt = (s: number): string => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}` : '–');
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ---------- state (outlives every render) ----------

const root = document.getElementById('admin') as HTMLElement;
let file: StationsFile = { version: 0, stations: [] };
/** The list has been loaded from the server at least once. */
let loaded = false;
let selected: string | null = null;
/** Bumped on every edit; `savedAt` is its value at the last load or successful save. */
let edits = 0;
let savedAt = 0;
let saving = false;
/** A "Fill in missing lengths" run is in flight. */
let filling = false;
let screen: 'boot' | 'login' | 'editor' = 'boot';
let creating = false;
let deleting: string | null = null;

const dirty = (): boolean => edits !== savedAt;
const current = (): Station | undefined => file.stations.find((s) => s.id === selected);
const stationById = (id: string): Station | undefined => file.stations.find((s) => s.id === id);

// ---------- persistent elements ----------

const subtitle = h('span', { class: 'sub' });
const saveBtn = h('button', { class: 'primary', textContent: 'Save', onclick: () => void save() });
const signOutBtn = h('button', { textContent: 'Sign out', onclick: () => void signOut() });
/** Shown only while some track has no length (they were saved as 0:00 by an older upload). */
const fillBtn = h('button', { textContent: 'Fill in missing lengths', onclick: () => void fillLengths() });
fillBtn.hidden = true;
const header = h('header', {}, h('div', { class: 'wm' }, h('span', { class: 'dot' }), 'Aglow'), subtitle, h('div', { class: 'spacer' }), fillBtn, saveBtn, signOutBtn);
/** Errors and notices (the toast is for success). */
const msgBox = h('div', { class: 'msg', attrs: { role: 'alert' } });
const toastEl = h('div', { class: 'toast', attrs: { role: 'status', 'aria-live': 'polite' } });
document.body.append(toastEl);

const uploadSummary = h('p', { class: 'summary', id: 'upload-summary', attrs: { role: 'status' } });
const uploadList = h('ul', { class: 'uploads', attrs: { 'aria-label': 'Uploads' } });
const clearBtn = h('button', { textContent: 'Clear finished', onclick: () => clearFinished() });
const uploadsPanel = h(
  'section',
  { class: 'upload-panel', attrs: { 'aria-label': 'Upload queue' } },
  h('div', { class: 'upload-head' }, h('h2', { textContent: 'Uploads' }), uploadSummary, h('div', { class: 'spacer' }), clearBtn),
  uploadList,
);
const rows = new Map<number, { row: HTMLElement; state: HTMLElement; retry: HTMLButtonElement }>();

/** One track input and one cover input per station, created once and re-attached by every render. */
const inputs = new Map<string, { tracks: HTMLInputElement; cover: HTMLInputElement }>();

// Per render: the parts a finished upload or an edit updates in place.
let tableHost: HTMLElement | null = null;
let coverSlot: HTMLElement | null = null;
const navNames = new Map<string, HTMLElement>();
const navCounts = new Map<string, HTMLElement>();

// ---------- messages ----------

let toastTimer = 0;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 4000);
}

function showMessage(text: string, ...actions: HTMLElement[]): void {
  msgBox.replaceChildren(h('span', { textContent: text }), ...actions);
  msgBox.classList.add('on');
}
function clearMessage(): void {
  msgBox.replaceChildren();
  msgBox.classList.remove('on');
}

function refreshHeader(): void {
  const busy = queue.busy;
  saveBtn.disabled = saving || busy || filling || !dirty();
  saveBtn.textContent = saving ? 'Saving…' : 'Save';
  saveBtn.title = busy ? 'Wait for the uploads to finish' : filling ? 'Wait for the lengths to be filled in' : '';
  const missing = file.stations.reduce((n, s) => n + s.tracks.filter((t) => t.duration === 0).length, 0);
  fillBtn.hidden = missing === 0 && !filling;
  fillBtn.disabled = filling;
  fillBtn.textContent = filling ? 'Filling in lengths…' : `Fill in missing lengths (${missing})`;
  subtitle.textContent = `Radio admin · v${file.version}${dirty() ? ' · unsaved changes' : ''}`;
}

function touch(): void {
  edits++;
  refreshHeader();
}

// ---------- session ----------

/** A 401 from any admin call: back to sign-in, keeping everything in memory. */
function expired(): void {
  queue.pause();
  if (screen !== 'login') renderLogin(SESSION_EXPIRED);
}
const isExpired = (e: unknown): boolean => e instanceof ApiError && e.status === 401;
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function boot(): Promise<void> {
  try {
    const { admin } = await api.session();
    if (admin) await loadAndRender();
    else renderLogin();
  } catch (e) {
    renderFatal(errText(e));
  }
}

function renderFatal(text: string): void {
  screen = 'boot';
  root.replaceChildren(
    h('div', { class: 'card' }, h('p', { class: 'err', textContent: text }), h('button', { textContent: 'Try again', onclick: () => void boot() })),
  );
}

function renderLogin(message = ''): void {
  screen = 'login';
  const input = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', attrs: { 'aria-label': 'Password' } });
  const submit = h('button', { type: 'submit', class: 'primary', textContent: 'Sign in' });
  const err = h('p', { class: 'err', textContent: message, attrs: { role: 'alert' } });
  const form = h(
    'form',
    { class: 'card login' },
    h('div', { class: 'wm' }, h('span', { class: 'dot' }), 'Aglow'),
    h('h1', { textContent: 'Radio admin' }),
    input,
    submit,
    err,
    h('p', { class: 'note', textContent: 'Too many failed attempts pause sign-in for everyone for up to 15 minutes.' }),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void (async () => {
      submit.disabled = true;
      err.textContent = '';
      try {
        await api.login(input.value);
      } catch (x) {
        err.textContent = errText(x);
        submit.disabled = false;
        input.select();
        return;
      }
      await afterLogin();
    })();
  });
  root.replaceChildren(form);
  input.focus();
}

async function afterLogin(): Promise<void> {
  // Signing in again after an expired session keeps unsaved edits and finished uploads: never load() over them.
  if (loaded && (dirty() || queue.busy)) {
    render();
    queue.resume();
    refreshUploads();
  } else {
    await loadAndRender();
    queue.resume();
  }
}

async function signOut(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // the cookie is cleared by the response; a failed call still leaves the user on the sign-in screen
  }
  renderLogin();
}

async function loadAndRender(): Promise<void> {
  try {
    file = await api.load();
  } catch (e) {
    if (isExpired(e)) expired();
    else if (screen === 'editor') showMessage(errText(e));
    else renderFatal(errText(e));
    return;
  }
  loaded = true;
  savedAt = edits;
  creating = false;
  deleting = null;
  selected = selected && stationById(selected) ? selected : (file.stations[0]?.id ?? null);
  clearMessage();
  render();
}

// ---------- saving ----------

async function save(): Promise<void> {
  if (saving || queue.busy || !dirty()) return;
  const problem = firstProblem(file.stations);
  if (problem) {
    showProblem(problem);
    return;
  }
  saving = true;
  clearMessage();
  refreshHeader();
  const sentAt = edits;
  try {
    const r = await api.save(file.version, file.stations);
    file.version = r.version;
    savedAt = sentAt; // edits made while the save was in flight stay unsaved
    toast('Saved. Live in the game within a minute');
  } catch (e) {
    if (isExpired(e)) expired();
    else if (e instanceof ApiError && e.status === 409) showConflict(e.message);
    else showMessage(`${errText(e)} Your edits are still here, so you can save again.`);
  } finally {
    saving = false;
    refreshHeader();
  }
}

function showConflict(text: string): void {
  const reload = h('button', {
    textContent: 'Reload',
    onclick: () =>
      showMessage(
        'Reloading discards your unsaved edits here.',
        h('button', {
          class: 'danger',
          textContent: 'Reload and discard edits',
          onclick: () => {
            // A reload would also drop the tracks still uploading (they land in the list it replaces).
            if (queue.busy) showMessage('Uploads are still running. Wait for them to finish, then reload.', reload);
            else void loadAndRender();
          },
        }),
        h('button', { textContent: 'Cancel', onclick: () => showConflict(text) }),
      ),
  });
  showMessage(text, reload);
}

/** Selects the station with the problem, focuses the field, and says what's wrong. */
function showProblem(p: Problem): void {
  if (stationById(p.stationId)) selected = p.stationId;
  render();
  showMessage(p.message);
  const sel = p.field ? `[data-field="${p.field}"]${p.track !== undefined ? `[data-track="${p.track}"]` : ':not([data-track])'}` : null;
  const el = sel ? root.querySelector<HTMLElement>(sel) : null;
  el?.focus();
}

// ---------- lengths ----------

/**
 * Looks up the length of every track saved as 0:00 from the public media host (a range request each, 4 at a time),
 * fills them into the list and marks it unsaved; one Save then keeps them all. A track that can't be read stays 0.
 */
async function fillLengths(): Promise<void> {
  if (filling) return;
  const owner = new Map<Track, Station>();
  for (const s of file.stations) for (const t of s.tracks) if (t.duration === 0) owner.set(t, s);
  if (!owner.size) return;
  filling = true;
  clearMessage();
  refreshHeader();
  try {
    const { found, failed } = await fillMissingLengths([...owner.keys()], (t, seconds) => {
      const s = owner.get(t);
      const i = s && file.stations.includes(s) ? s.tracks.indexOf(t) : -1;
      if (!s || i < 0) return; // the list was reloaded or the track removed meanwhile
      t.duration = seconds;
      touch();
      if (s.id === selected && screen === 'editor') tableHost?.querySelectorAll('tbody tr')[i]?.querySelector('.dur')?.replaceChildren(fmt(seconds));
    });
    if (failed) {
      showMessage(`Filled in ${plural(found, 'length')}; ${failed} could not be read and stay blank.${found ? ' Save to keep the rest.' : ''}`);
    } else if (found) toast(`Filled in ${plural(found, 'length')}. Save to keep them.`);
  } finally {
    filling = false;
    refreshHeader();
  }
}

// ---------- uploads ----------

interface Job {
  kind: 'track' | 'cover';
  stationId: string;
  file: File;
}
type Result = { kind: 'track'; track: Track } | { kind: 'cover'; url: string };

/** One upload, aborted as "Upload stalled" when neither progress nor an answer arrives for STALL_MS. */
async function upload(folder: 'tracks' | 'covers', job: Job, onProgress: (pct: number) => void): Promise<{ url: string }> {
  const ctl = new AbortController();
  const dog = watchdog(STALL_MS, () => ctl.abort(new Error('Upload stalled')));
  try {
    return await api.uploadFile(
      folder,
      job.stationId,
      job.file,
      (pct) => {
        dog.poke();
        onProgress(pct);
      },
      ctl.signal,
    );
  } finally {
    dog.stop();
  }
}

/**
 * A track's length in seconds. MP3s are measured from their own bytes, which works in a hidden tab; the browser's
 * decoder (which a hidden tab throttles into a timeout) is only the fallback for other formats and unreadable MP3s.
 */
async function trackLength(f: File): Promise<number> {
  if (isMp3(f)) {
    const seconds = await mp3DurationOfBlob(f);
    if (seconds > 0) return seconds;
  }
  return audioDuration(f);
}

async function runJob(job: Job, onProgress: (pct: number) => void): Promise<Result> {
  if (job.file.size > MAX_UPLOAD) throw new Error('The file is too large (30 MB max)');
  if (job.file.size === 0) throw new Error('The file is empty');
  if (job.kind === 'cover') {
    const { url } = await upload('covers', job, onProgress);
    return { kind: 'cover', url };
  }
  const [{ url }, duration, tags] = await Promise.all([upload('tracks', job, onProgress), trackLength(job.file), tagsFromBlob(job.file, job.file.name)]);
  const title = tags.title.trim().slice(0, 200) || 'Untitled';
  return { kind: 'track', track: { id: crypto.randomUUID(), url, title, artist: tags.artist.trim().slice(0, 200), credit: '', duration } };
}

const queue = new UploadQueue<Job, Result>({
  run: runJob,
  onComplete: (item, result) => landed(item.job, result),
  onChange: (item) => {
    updateRow(item);
    refreshUploads();
    refreshHeader();
  },
  requeueOn: (e) => {
    if (!isExpired(e)) return false;
    expired();
    return true;
  },
});

function enqueue(kind: Job['kind'], stationId: string, files: readonly File[]): void {
  if (!files.length) return;
  queue.add(files.map((f) => ({ kind, stationId, file: f })));
}

/** A finished upload, in queue order: add the track (or set the cover) and update the page in place. */
function landed(job: Job, result: Result): void {
  const s = stationById(job.stationId);
  if (!s) return; // the station was deleted meanwhile; the stored file is never referenced
  if (result.kind === 'cover') {
    s.cover = result.url;
    touch();
    if (s.id === selected) renderCoverSlot(s);
    return;
  }
  s.tracks.push(result.track);
  touch();
  navCounts.get(s.id)?.replaceChildren(`${s.id} · ${plural(s.tracks.length, 'track')}`);
  if (s.id === selected && screen === 'editor') appendTrackRow(s, s.tracks.length - 1);
}

function stateText(item: QueueItem<Job>): string {
  if (item.state === 'uploading') return `${Math.round(item.pct)}%`;
  if (item.state === 'failed') return `failed: ${item.error}`;
  return item.state;
}

function updateRow(item: QueueItem<Job>): void {
  let r = rows.get(item.id);
  if (!r) {
    const name = item.job.file.name;
    const where = stationById(item.job.stationId)?.name ?? item.job.stationId;
    const state = h('span', { class: 'state' });
    const retry = h('button', { class: 'small', textContent: 'Retry', attrs: { 'aria-label': `Retry ${name}` }, onclick: () => queue.retry(item.id) });
    const row = h(
      'li',
      { class: 'up' },
      h('span', { class: 'name', textContent: item.job.kind === 'cover' ? `Cover: ${name}` : name }),
      h('span', { class: 'where', textContent: where }),
      state,
      retry,
    );
    r = { row, state, retry };
    rows.set(item.id, r);
    uploadList.append(row);
  }
  r.state.textContent = stateText(item);
  r.row.dataset.state = item.state;
  r.retry.hidden = item.state !== 'failed';
}

function refreshUploads(): void {
  const c = queue.counts();
  const total = c.queued + c.uploading + c.done + c.failed;
  const failed = c.failed ? `, ${c.failed} failed` : '';
  if (total === 0) uploadSummary.textContent = 'No uploads yet.';
  else if (queue.paused && queue.busy) uploadSummary.textContent = `Paused until you sign in again: ${c.queued} queued${failed}.`;
  else if (queue.busy) uploadSummary.textContent = `Uploading: ${c.done} done, ${c.uploading} uploading, ${c.queued} queued${failed}.`;
  else uploadSummary.textContent = `All uploads finished: ${c.done} done${failed}.`;
  uploadsPanel.dataset.busy = String(queue.busy);
  clearBtn.disabled = queue.clearable === 0;
}

function clearFinished(): void {
  queue.clearFinished();
  const keep = new Set(queue.items.map((i) => i.id));
  for (const [id, r] of rows) {
    if (keep.has(id)) continue;
    r.row.remove();
    rows.delete(id);
  }
  refreshUploads();
}

function stationInputs(stationId: string): { tracks: HTMLInputElement; cover: HTMLInputElement } {
  let pair = inputs.get(stationId);
  if (pair) return pair;
  const make = (label: string, accept: string, multiple: boolean, kind: Job['kind']): HTMLInputElement => {
    const input = h('input', { type: 'file', accept, multiple, class: 'vh', attrs: { 'aria-label': label } });
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.value = ''; // so the same names can be chosen again
      enqueue(kind, stationId, files);
    });
    return input;
  };
  pair = {
    tracks: make('Upload tracks', 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.m4a,.aac,.ogg', true, 'track'),
    cover: make('Upload cover', 'image/jpeg,image/png,image/webp', false, 'cover'),
  };
  inputs.set(stationId, pair);
  return pair;
}

// ---------- rendering ----------

function render(): void {
  screen = 'editor';
  navNames.clear();
  navCounts.clear();
  tableHost = null;
  coverSlot = null;
  const s = current();
  const main = h('main', {}, s ? stationEditor(s) : h('p', { class: 'empty', textContent: 'Create a station to start uploading music.' }), uploadsPanel);
  root.replaceChildren(header, msgBox, h('div', { class: 'layout' }, stationNav(), main));
  refreshHeader();
  refreshUploads();
}

function stationNav(): HTMLElement {
  const items = file.stations.map((s) => {
    const name = h('b', { textContent: s.name || s.id });
    const count = h('small', { textContent: `${s.id} · ${plural(s.tracks.length, 'track')}` });
    navNames.set(s.id, name);
    navCounts.set(s.id, count);
    const b = h('button', { class: `station${s.id === selected ? ' on' : ''}`, onclick: () => select(s.id) }, name, count);
    if (s.id === selected) b.setAttribute('aria-current', 'true');
    return b;
  });
  return h('nav', { class: 'stations', attrs: { 'aria-label': 'Stations' } }, ...items, creating ? newStationForm() : h('button', { class: 'add', textContent: '+ New station', onclick: () => ((creating = true), render()) }));
}

function select(id: string): void {
  selected = id;
  deleting = null;
  render();
}

function newStationForm(): HTMLElement {
  const input = h('input', { maxLength: 60, placeholder: 'e.g. Christmas Jazz', attrs: { 'aria-label': 'New station name' } });
  const preview = h('small', { class: 'dim' });
  const err = h('p', { class: 'err', attrs: { role: 'alert' } });
  input.addEventListener('input', () => {
    preview.textContent = input.value.trim() ? `id: ${slugify(input.value)}` : '';
  });
  const form = h(
    'form',
    { class: 'new-station' },
    input,
    preview,
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary', textContent: 'Create' }), h('button', { type: 'button', textContent: 'Cancel', onclick: () => ((creating = false), render()) })),
    err,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    const id = slugify(name);
    let problem = '';
    if (!name) problem = 'Give the station a name.';
    else if (file.stations.length >= MAX_STATIONS) problem = `There can be at most ${MAX_STATIONS} stations.`;
    else if (stationById(id)) problem = `A station with the id "${id}" already exists.`;
    else if (!parseStation({ id, name, description: '', tracks: [] })) problem = `"${id}" is reserved for the radio's own sources. Pick another name.`;
    if (problem) {
      err.textContent = problem;
      input.focus();
      return;
    }
    file.stations.push({ id, name, description: '', tracks: [] });
    selected = id;
    creating = false;
    touch();
    render();
  });
  queueMicrotask(() => input.focus());
  return form;
}

function stationEditor(s: Station): HTMLElement {
  const field = (key: 'name' | 'description', label: string, max: number, placeholder = ''): HTMLElement => {
    const input = h('input', { value: s[key], maxLength: max, placeholder });
    input.dataset.field = key satisfies Field;
    input.addEventListener('input', () => {
      s[key] = input.value;
      if (key === 'name') navNames.get(s.id)?.replaceChildren(input.value || s.id);
      touch();
    });
    return h('label', {}, label, input);
  };
  const { tracks: trackInput, cover: coverInput } = stationInputs(s.id);
  coverSlot = h('div', { class: 'cover' });
  renderCoverSlot(s, coverInput);

  const meta = h('div', { class: 'meta-row' }, h('span', { class: 'id', textContent: `id: ${s.id}` }), coverSlot, deleteControl(s));
  tableHost = h('div', { class: 'table-wrap' });
  renderTable(s);

  const drop = h(
    'div',
    { class: 'drop' },
    h('label', { class: 'button' }, 'Choose audio files', trackInput),
    h('span', { textContent: ' or drop them here. MP3 or M4A, up to 30 MB each. Title and artist come from the tags, else from "Title - Artist" in the file name.' }),
  );
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    enqueue('track', s.id, Array.from(e.dataTransfer?.files ?? []));
  });

  return h(
    'section',
    { class: 'editor', attrs: { 'aria-label': s.name || s.id } },
    h('div', { class: 'fields' }, field('name', 'Name', 60), field('description', 'Description', 200, 'Shown under the station name')),
    meta,
    tableHost,
    drop,
  );
}

function renderCoverSlot(s: Station, coverInput = stationInputs(s.id).cover): void {
  if (!coverSlot) return;
  const kids: (Node | string)[] = [];
  if (s.cover) kids.push(h('img', { src: s.cover, alt: '', width: 36, height: 36 }));
  kids.push(h('label', { class: 'button' }, s.cover ? 'Replace cover' : 'Add cover', coverInput));
  if (s.cover) {
    kids.push(
      h('button', {
        textContent: 'Remove cover',
        onclick: () => {
          delete s.cover;
          touch();
          renderCoverSlot(s);
        },
      }),
    );
  }
  coverSlot.replaceChildren(...kids);
}

function deleteControl(s: Station): HTMLElement {
  if (deleting !== s.id) {
    return h('button', { class: 'danger-quiet', textContent: 'Delete station', onclick: () => ((deleting = s.id), render()) });
  }
  return h(
    'div',
    { class: 'confirm', attrs: { role: 'group', 'aria-label': 'Confirm delete' } },
    h('span', { textContent: `Delete "${s.name || s.id}" and its ${plural(s.tracks.length, 'track')}? The files are removed from storage when you save, but copies may stay cached at the edge for up to a week.` }),
    h('button', {
      class: 'danger',
      textContent: 'Delete',
      onclick: () => {
        if (queue.items.some((i) => i.job.stationId === s.id && (i.state === 'queued' || i.state === 'uploading'))) {
          showMessage(`Wait for the uploads to "${s.name || s.id}" to finish, then delete it.`);
          return;
        }
        file.stations = file.stations.filter((x) => x.id !== s.id);
        selected = file.stations[0]?.id ?? null;
        deleting = null;
        touch();
        render();
      },
    }),
    h('button', { textContent: 'Cancel', onclick: () => ((deleting = null), render()) }),
  );
}

const HEADINGS = ['#', 'Title', 'Artist', 'Credit', 'Length', ''];

function renderTable(s: Station, focus?: { act: string; row: number }): void {
  if (!tableHost) return;
  if (!s.tracks.length) {
    tableHost.replaceChildren(h('p', { class: 'empty', textContent: 'No tracks yet.' }));
    return;
  }
  const body = h('tbody', {}, ...s.tracks.map((_, i) => trackRow(s, i)));
  tableHost.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ...HEADINGS.map((x) => h('th', { textContent: x })))), body));
  if (focus) {
    const row = Math.min(focus.row, s.tracks.length - 1);
    tableHost.querySelector<HTMLElement>(`button[data-act="${focus.act}"][data-row="${row}"]`)?.focus();
  }
}

/** A finished upload: one more row, without touching the others (so focus and typing are undisturbed). */
function appendTrackRow(s: Station, i: number): void {
  const body = tableHost?.querySelector('tbody');
  if (body) body.append(trackRow(s, i));
  else renderTable(s);
}

function trackRow(s: Station, i: number): HTMLElement {
  const t = s.tracks[i];
  const n = i + 1;
  const move = (d: number): void => {
    const j = i + d;
    if (j < 0 || j >= s.tracks.length) return;
    [s.tracks[i], s.tracks[j]] = [s.tracks[j], s.tracks[i]];
    touch();
    renderTable(s, { act: d < 0 ? 'up' : 'down', row: j });
  };
  const cell = (key: 'title' | 'artist' | 'credit', label: string, placeholder: string, max: number): HTMLElement => {
    const input = h('input', { value: t[key], placeholder, maxLength: max, attrs: { 'aria-label': `Track ${n} ${label}` } });
    input.dataset.field = key satisfies Field;
    input.dataset.track = String(i);
    input.addEventListener('input', () => {
      t[key] = input.value;
      touch();
    });
    return h('td', { class: key }, input);
  };
  const button = (act: string, text: string, label: string, onclick: () => void): HTMLButtonElement => {
    const b = h('button', { class: 'small', textContent: text, title: label, attrs: { 'aria-label': label }, onclick });
    b.dataset.act = act;
    b.dataset.row = String(i);
    return b;
  };
  return h(
    'tr',
    {},
    h('td', { class: 'num', textContent: String(n) }),
    cell('title', 'title', 'Title', 200),
    cell('artist', 'artist', 'Artist', 200),
    cell('credit', 'credit', 'Credit line (needed for CC-BY music)', 500),
    h('td', { class: 'dur', textContent: fmt(t.duration) }),
    h(
      'td',
      { class: 'actions' },
      button('up', '↑', `Move track ${n} up`, () => move(-1)),
      button('down', '↓', `Move track ${n} down`, () => move(1)),
      button('remove', '✕', `Remove track ${n}`, () => {
        s.tracks.splice(i, 1);
        touch();
        navCounts.get(s.id)?.replaceChildren(`${s.id} · ${plural(s.tracks.length, 'track')}`);
        renderTable(s, { act: 'remove', row: i });
      }),
    ),
  );
}

// A file dropped anywhere but the drop zone would otherwise replace the page (and everything unsaved) with the file.
for (const type of ['dragover', 'drop'] as const) addEventListener(type, (e) => e.preventDefault());

// Closing or reloading the tab would lose unsaved edits, queued uploads or a save in flight: the browser asks first.
addEventListener('beforeunload', (e) => {
  if (!mustWarnBeforeLeaving({ dirty: dirty(), busy: queue.busy, saving })) return;
  e.preventDefault();
  e.returnValue = ''; // older browsers only prompt when this is set
});

refreshUploads();
void boot();
