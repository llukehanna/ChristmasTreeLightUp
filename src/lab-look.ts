import './lab.css';
/**
 * LAB ONLY (career-overlay-lab, never merged): `?look=now|grow|big` picks how Career sits over the game, and a small
 * switcher at the bottom left flips it live. The choice is on body[data-look].
 */
const LOOKS = [
  ['now', 'Now (full page)'],
  ['grow', 'A · Growing panel'],
] as const;
export type Look = (typeof LOOKS)[number][0];

export const look = (): Look => (document.body.dataset.look as Look) || 'grow';

export function installLookSwitch(): void {
  const q = new URLSearchParams(location.search).get('look');
  document.body.dataset.look = LOOKS.some(([k]) => k === q) ? (q as string) : 'grow';
  const bar = document.createElement('div');
  bar.id = 'lab-look';
  bar.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:99;display:flex;gap:4px;padding:4px;border-radius:12px;background:rgba(10,4,3,.82);border:1px solid rgba(236,196,116,.35);font:500 12px Inter,system-ui,sans-serif;backdrop-filter:blur(8px)';
  const paint = (): void => {
    for (const b of bar.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.k === document.body.dataset.look;
      b.style.background = on ? 'linear-gradient(#f6dc9c,#e2b866)' : 'transparent';
      b.style.color = on ? '#3a1408' : '#f4e6cf';
    }
  };
  for (const [k, label] of LOOKS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.k = k;
    b.textContent = label;
    b.style.cssText = 'border:0;border-radius:9px;padding:6px 10px;cursor:pointer;font:inherit';
    b.addEventListener('click', () => {
      document.body.dataset.look = k;
      const u = new URL(location.href);
      u.searchParams.set('look', k);
      history.replaceState(history.state, '', u);
      paint();
      b.blur();
    });
    bar.append(b);
  }
  document.body.append(bar);
  paint();
}

/** The sheet's Career button: the page that opens next came from the leaderboard card (the big look swaps in place). */
addEventListener(
  'click',
  (e) => {
    const t = e.target instanceof Element ? e.target.closest('.acct-sheet [data-act="career"]') : null;
    if (!t) return;
    // The card's size: the Career panel widens out of it and narrows back into it.
    const r = t.closest('.acct-sheet')!.getBoundingClientRect();
    document.body.style.setProperty('--from-w', `${r.width}px`);
    document.body.style.setProperty('--from-h', `${r.height}px`);
    // A copy of the card's content (less its switch, which Career has in the same place) to fade out in the panel.
    const inner = t.closest('.acct-sheet')!.querySelector('.acct-inner');
    if (inner) {
      const ghost = document.createElement('div');
      ghost.className = 'acct-sheet acct-list lab-ghost';
      const copy = inner.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.acct-tabs').forEach((n) => n.remove());
      ghost.append(copy);
      const top = inner.querySelector('.acct-body')?.scrollTop ?? 0;
      (window as unknown as { __labGhost?: { el: HTMLElement; top: number } }).__labGhost = { el: ghost, top };
    }
    document.body.classList.add('lab-from-sheet');
    setTimeout(() => document.body.classList.remove('lab-from-sheet'), 1500);
  },
  true,
);

/** LAB: the account chip warms Career's code and data, so swapping from the leaderboard draws it at once. */
addEventListener(
  'click',
  (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('#account-chip')) return;
    void Promise.all([import('./career'), import('./api/client')]).then(([kit, { api }]) =>
      kit.prewarmCareer({ name: 'Luke' }, () => api.cachedCareer()),
    );
  },
  true,
);
